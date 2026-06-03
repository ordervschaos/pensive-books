// scan-threads — rolling per-page thread scan using Haiku.
//
// Instead of one large Opus call over the full book, we loop page-by-page with a cheap Haiku
// call per page. Each call sees the current page prose + the full thread registry accumulated
// so far, and returns:
//   - new_threads:        a fresh promise planted on this page (becomes the first promise anchor)
//   - promise_reinforced: an existing thread deepened on this page (adds a promise anchor)
//   - resolved:           an existing thread paid off on this page (adds a resolution anchor)
//
// Threads are NEVER removed from the registry after closing — a thread can be resolved more than
// once. The output is an ordered list of AnchorEvent[], one per anchor to be inserted. The client
// reviews and applies them; nothing is written to book_threads or book_thread_anchors here.
//
// Needs the ANTHROPIC_API_KEY secret (shared with other AI functions).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { cumulativeWordOffsets, tiptapToText } from "../_shared/words.ts";
import { captureException, isBillingError } from "../_shared/sentry.ts";

const SCAN_MODEL = "claude-haiku-4-5-20251001";
const PER_PAGE_PROSE_CAP = 6000; // chars — Haiku context is smaller than Opus

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

interface PageRow {
  id: number;
  page_index: number;
  page_type: string | null;
  title: string | null;
  content: unknown;
}

interface ThreadRow {
  id: number;
  name: string;
  description: string | null;
  author_locked: boolean;
}

interface ExistingAnchorRow {
  thread_id: number;
  role: string;
}

// An anchor event: one notable moment to be stored as a book_thread_anchors row.
export interface AnchorEvent {
  threadKey: string;         // "db:42" for existing threads, "new:0" for newly found
  threadName: string;
  threadDescription: string;
  role: "promise" | "resolution";
  pageId: number;
  wordOffset: number;
  sequence: number;          // nth anchor of this role for this thread (server-computed)
  note: string;
  isNewThread: boolean;      // true = also create a book_threads row for this key
}

export interface ThreadScan {
  summary: string;
  events: AnchorEvent[];
  scanId?: number | null;
}

// In-memory state during the rolling loop.
interface RegistryEntry {
  key: string;           // "db:42" or "new:0"
  dbId: number | null;
  name: string;
  description: string;
  authorLocked: boolean;
  promiseCount: number;      // total promise anchors emitted this scan (for sequence numbering)
  resolutionCount: number;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: "Unauthorized" }, 401);

    const { bookId } = (await req.json().catch(() => ({}))) as { bookId?: number };
    if (!bookId) return json({ error: "bookId is required" }, 400);

    const { data: book, error: bookError } = await userClient
      .from("books")
      .select("id, name, owner_id")
      .eq("id", bookId)
      .single();
    if (bookError || !book) return json({ error: "Book not found" }, 404);

    const { data: access } = await userClient
      .from("book_access")
      .select("id")
      .eq("book_id", bookId)
      .eq("user_id", user.id)
      .eq("status", "accepted")
      .maybeSingle();
    if (book.owner_id !== user.id && !access) return json({ error: "Access denied" }, 403);

    const { data: pages, error: pagesError } = await userClient
      .from("pages")
      .select("id, page_index, page_type, title, content")
      .eq("book_id", bookId)
      .eq("archived", false)
      .order("page_index", { ascending: true });
    if (pagesError) throw new Error(`fetch pages: ${pagesError.message}`);
    if (!pages || pages.length === 0) return json({ error: "Book has no pages to scan" }, 400);

    const { data: threads } = await userClient
      .from("book_threads")
      .select("id, name, description, author_locked")
      .eq("book_id", bookId);
    const existingThreads = (threads as ThreadRow[] | null) ?? [];
    const existingIds = existingThreads.map((t) => t.id);

    // Count existing anchors per thread+role to set starting sequence numbers for new anchors.
    const existingCounts = new Map<string, number>(); // "db:${id}:${role}" → count
    if (existingIds.length > 0) {
      const { data: anchors } = await userClient
        .from("book_thread_anchors")
        .select("thread_id, role")
        .in("thread_id", existingIds);
      for (const a of (anchors as ExistingAnchorRow[] | null) ?? []) {
        const k = `db:${a.thread_id}:${a.role}`;
        existingCounts.set(k, (existingCounts.get(k) ?? 0) + 1);
      }
    }

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);

    const pageRows = pages as PageRow[];
    const { positions, total } = cumulativeWordOffsets(pageRows);

    // Build the initial registry from existing threads.
    const registry: RegistryEntry[] = existingThreads.map((t) => ({
      key: `db:${t.id}`,
      dbId: t.id,
      name: t.name,
      description: t.description ?? "",
      authorLocked: t.author_locked,
      promiseCount: existingCounts.get(`db:${t.id}:promise`) ?? 0,
      resolutionCount: existingCounts.get(`db:${t.id}:resolution`) ?? 0,
    }));

    // Raw events collected during the loop (word offsets resolved after).
    interface RawEvent {
      threadKey: string;
      name: string;
      description: string;
      role: "promise" | "resolution";
      pageId: number;
      note: string;
      isNewThread: boolean;
    }
    const rawEvents: RawEvent[] = [];
    let newThreadCounter = 0;

    for (const page of pageRows) {
      if (page.page_type === "section") continue;
      const prose = tiptapToText(page.content).trim();
      if (!prose) continue;

      let result: PageResult;
      try {
        result = await callHaiku(apiKey, page, prose, registry);
      } catch (e) {
        // A single page failure is non-fatal: log and continue the loop.
        console.error(`scan-threads: page ${page.id} skipped:`, e);
        continue;
      }

      for (const nt of result.new_threads) {
        const key = `new:${newThreadCounter++}`;
        const entry: RegistryEntry = {
          key,
          dbId: null,
          name: nt.name,
          description: nt.description,
          authorLocked: false,
          promiseCount: 0,
          resolutionCount: 0,
        };
        registry.push(entry);
        rawEvents.push({ threadKey: key, name: nt.name, description: nt.description, role: "promise", pageId: page.id, note: nt.note, isNewThread: true });
        entry.promiseCount++;
      }

      for (const pr of result.promise_reinforced) {
        const entry = registry.find((e) => e.key === pr.thread_key);
        if (!entry || entry.authorLocked) continue;
        rawEvents.push({ threadKey: entry.key, name: entry.name, description: entry.description, role: "promise", pageId: page.id, note: pr.note, isNewThread: false });
        entry.promiseCount++;
      }

      for (const res of result.resolved) {
        const entry = registry.find((e) => e.key === res.thread_key);
        if (!entry || entry.authorLocked) continue;
        rawEvents.push({ threadKey: entry.key, name: entry.name, description: entry.description, role: "resolution", pageId: page.id, note: res.note, isNewThread: false });
        entry.resolutionCount++;
        // Entry stays in the registry — a thread can be resolved multiple times.
      }
    }

    // Resolve word offsets and compute sequence numbers (server-side, never trusted from AI).
    // Sequence for each anchor = (existing anchors of that role for this thread) + (prior events
    // of same role for same thread in this scan).
    const seqCounters = new Map<string, number>(); // "${threadKey}:${role}" → next seq
    // Seed with existing counts for db: threads.
    for (const entry of registry) {
      if (entry.dbId !== null) {
        seqCounters.set(`db:${entry.dbId}:promise`, existingCounts.get(`db:${entry.dbId}:promise`) ?? 0);
        seqCounters.set(`db:${entry.dbId}:resolution`, existingCounts.get(`db:${entry.dbId}:resolution`) ?? 0);
      }
    }

    const events: AnchorEvent[] = rawEvents.map((e) => {
      const seqKey = `${e.threadKey}:${e.role}`;
      const seq = seqCounters.get(seqKey) ?? 0;
      seqCounters.set(seqKey, seq + 1);
      const pos = positions.get(e.pageId);
      return {
        threadKey: e.threadKey,
        threadName: e.name,
        threadDescription: e.description,
        role: e.role,
        pageId: e.pageId,
        wordOffset: pos?.start ?? 0,
        sequence: seq,
        note: e.note,
        isNewThread: e.isNewThread,
      };
    });

    const newCount = new Set(rawEvents.filter((e) => e.isNewThread).map((e) => e.threadKey)).size;
    const resolvedCount = rawEvents.filter((e) => e.role === "resolution").length;
    const reinforcedCount = rawEvents.filter((e) => e.role === "promise" && !e.isNewThread).length;
    const summary = buildSummary(newCount, resolvedCount, reinforcedCount, total);

    // Persist the scan diff so a refresh can resume review without re-running the AI loop.
    const { data: scanRow, error: scanInsertError } = await userClient
      .from("book_thread_scans")
      .insert({
        book_id: bookId,
        status: "pending_review",
        summary,
        changes: events,
        model: SCAN_MODEL,
      })
      .select("id")
      .single();
    if (scanInsertError) throw new Error(`save scan: ${scanInsertError.message}`);

    return json({ summary, events, scanId: scanRow.id });
  } catch (e) {
    console.error("scan-threads error:", e);
    const billing = isBillingError(e);
    await captureException(e, { function: "scan-threads", billing: String(billing) });
    const userMsg = billing
      ? "AI credits exhausted — the team has been notified."
      : String((e as Error)?.message ?? e).slice(0, 500);
    return json({ error: userMsg }, billing ? 503 : 500);
  }
});

// ── Per-page Haiku prompt ─────────────────────────────────────────────────────

const PAGE_SYSTEM = `You track narrative threads — the promises a book makes and must keep (foreshadowing, setups, planted questions, open loops that want a payoff).

You are given ONE PAGE of prose and the current THREAD REGISTRY.

Identify on this page:
1. new_threads: a fresh narrative promise this page opens (only if genuinely distinct from every thread in the registry)
2. promise_reinforced: this page deepens an existing thread's setup without paying it off yet
3. resolved: this page pays off an existing thread (partially or fully)

Output JSON only — no prose, no markdown fences:
{
  "new_threads": [{ "name": "...", "description": "what it promises the reader", "note": "exact moment or line that plants it" }],
  "promise_reinforced": [{ "thread_key": "...", "note": "how this page deepens the setup" }],
  "resolved": [{ "thread_key": "...", "note": "how this page pays it off" }]
}

Rules:
- thread_key must match exactly a key in the registry (e.g. "db:42" or "new:0")
- Only flag promises the reader is meant to carry forward — not ordinary scene-setting or description
- If nothing notable happens on this page, return all three arrays empty`;

interface PageResult {
  new_threads: { name: string; description: string; note: string }[];
  promise_reinforced: { thread_key: string; note: string }[];
  resolved: { thread_key: string; note: string }[];
}

async function callHaiku(
  apiKey: string,
  page: PageRow,
  prose: string,
  registry: RegistryEntry[]
): Promise<PageResult> {
  const registryDigest = registry.length === 0
    ? "(none yet)"
    : registry
        .map((e) => `- [${e.key}] "${e.name}": ${e.description || "(no description)"}`)
        .join("\n");

  const capped = prose.length > PER_PAGE_PROSE_CAP
    ? prose.slice(0, PER_PAGE_PROSE_CAP) + "…"
    : prose;

  const userMsg =
    `THREAD REGISTRY:\n${registryDigest}\n\n` +
    `PAGE [id=${page.id}] "${page.title || "(untitled)"}":\n${capped}\n\nJSON only.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: SCAN_MODEL,
      max_tokens: 1024,
      system: PAGE_SYSTEM,
      messages: [{ role: "user", content: userMsg }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    let parsed: { error?: { message?: string } } = {};
    try { parsed = JSON.parse(body); } catch { /* ignore */ }
    const msg = parsed.error?.message ?? body;
    const err = new Error(`Claude API ${res.status}: ${msg.slice(0, 500)}`);
    if (parsed.error?.message?.toLowerCase().includes("credit balance"))
      (err as Error & { billing?: boolean }).billing = true;
    throw err;
  }

  const data = await res.json();
  const text = (data.content ?? [])
    .filter((b: { type: string }) => b.type === "text")
    .map((b: { text: string }) => b.text)
    .join("")
    .trim();

  return parsePageResult(text, new Set(registry.map((e) => e.key)));
}

function parsePageResult(text: string, validKeys: Set<string>): PageResult {
  let raw = text.trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) raw = fence[1].trim();
  else {
    const first = raw.indexOf("{");
    const last = raw.lastIndexOf("}");
    if (first !== -1 && last > first) raw = raw.slice(first, last + 1);
  }

  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(raw); }
  catch { return { new_threads: [], promise_reinforced: [], resolved: [] }; }

  const new_threads: PageResult["new_threads"] = [];
  for (const nt of Array.isArray(parsed.new_threads) ? parsed.new_threads : []) {
    const n = nt as Record<string, unknown>;
    if (typeof n.name === "string" && n.name.trim()) {
      new_threads.push({
        name: n.name.trim(),
        description: typeof n.description === "string" ? n.description.trim() : "",
        note: typeof n.note === "string" ? n.note.trim() : "",
      });
    }
  }

  const promise_reinforced: PageResult["promise_reinforced"] = [];
  for (const pr of Array.isArray(parsed.promise_reinforced) ? parsed.promise_reinforced : []) {
    const p = pr as Record<string, unknown>;
    if (typeof p.thread_key === "string" && validKeys.has(p.thread_key)) {
      promise_reinforced.push({
        thread_key: p.thread_key,
        note: typeof p.note === "string" ? p.note.trim() : "",
      });
    }
  }

  const resolved: PageResult["resolved"] = [];
  for (const res of Array.isArray(parsed.resolved) ? parsed.resolved : []) {
    const r = res as Record<string, unknown>;
    if (typeof r.thread_key === "string" && validKeys.has(r.thread_key)) {
      resolved.push({
        thread_key: r.thread_key,
        note: typeof r.note === "string" ? r.note.trim() : "",
      });
    }
  }

  return { new_threads, promise_reinforced, resolved };
}

function buildSummary(newCount: number, resolvedCount: number, reinforcedCount: number, totalWords: number): string {
  const kw = Math.round(totalWords / 1000);
  const parts: string[] = [];
  if (newCount > 0) parts.push(`${newCount} new thread${newCount !== 1 ? "s" : ""} found`);
  if (resolvedCount > 0) parts.push(`${resolvedCount} resolution${resolvedCount !== 1 ? "s" : ""} logged`);
  if (reinforcedCount > 0) parts.push(`${reinforcedCount} promise${reinforcedCount !== 1 ? "s" : ""} deepened`);
  if (parts.length === 0) return `No thread activity found across ${kw}k words.`;
  return `Scanned ${kw}k words: ${parts.join(", ")}.`;
}
