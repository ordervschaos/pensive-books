// scan-threads — reconcile a book's narrative threads against its current prose.
//
// Threads (foreshadowing / open loops / setups) are AI-extracted by default but author-editable.
// This is the "explicit scan pass": the author triggers it, we read the WHOLE book + the existing
// thread rows, and Claude proposes a DIFF — what got set up, advanced, closed, or is newly opened —
// reconciled against what's already tracked. Like replan-from-notes, NOTHING is written here: the
// diff is RETURNED, the author reviews it, and the client applies it to book_threads on confirm.
//
//   client → POST { bookId } → verify edit access → Claude → ThreadScan { summary, changes[] }
//
// The model picks page anchors (real ids from the outline) and the semantics; the SERVER computes
// word offsets and distances from those ids — never trust the model with the arithmetic. Threads
// the author has marked `author_locked` are shown to the model as fixed and excluded from the diff.
//
// Needs the ANTHROPIC_API_KEY secret (shared with evaluate-book / generate-unit / scaffold).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { cumulativeWordOffsets, tiptapToText } from "../_shared/words.ts";

const MODEL = "claude-opus-4-7";
const PER_PAGE_PROSE_CAP = 8000; // chars; very long pages are truncated to bound the prompt

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

interface Brief {
  scope?: { band?: string; word_target?: number };
  genre?: string;
  audience?: string;
  premise?: string;
  tone?: string[];
  success_criteria?: string;
}

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
  status: "planned" | "open" | "closed";
  setup_page_id: number | null;
  payoff_page_id: number | null;
  target_distance: number | null;
  author_locked: boolean;
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
      .select("id, name, brief, bible, owner_id")
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
      .select("id, name, description, status, setup_page_id, payoff_page_id, target_distance, author_locked")
      .eq("book_id", bookId);

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);

    const pageRows = pages as PageRow[];
    const { positions, total } = cumulativeWordOffsets(pageRows);

    const scan = await callClaude(
      apiKey,
      book.name,
      book.brief as Brief | null,
      (book.bible as { text?: string } | null)?.text?.trim() || null,
      pageRows,
      positions,
      (threads as ThreadRow[] | null) ?? [],
      total
    );

    // The model returns page-id anchors + semantics; the SERVER resolves word offsets and
    // distances from the offset map, and flags drift on still-open threads past their budget.
    const resolved = resolveOffsets(scan, positions, total);

    // Persist the diff immediately so this paid scan survives a refresh: the client resumes the
    // review from the newest pending_review row (see book_thread_scans). Returns scanId so the
    // client can mark it applied/dismissed once the author acts on it.
    const { data: scanRow, error: scanInsertError } = await userClient
      .from("book_thread_scans")
      .insert({
        book_id: bookId,
        status: "pending_review",
        summary: resolved.summary,
        changes: resolved.changes,
        model: MODEL,
      })
      .select("id")
      .single();
    if (scanInsertError) throw new Error(`save scan: ${scanInsertError.message}`);

    return json({ ...resolved, scanId: scanRow.id });
  } catch (e) {
    console.error("scan-threads error:", e);
    return json({ error: String((e as Error)?.message ?? e).slice(0, 500) }, 500);
  }
});

// ── Prompt ───────────────────────────────────────────────────────────────────
const SYSTEM = `You are a story-continuity editor tracking a book's narrative THREADS — the promises it makes and must keep: foreshadowing, planted questions, open loops, setups that want a payoff.

You are given the brief, the bible, the book's pages (each with a real [id], its cumulative WORD-OFFSET — the manuscript words before it begins — and its prose), and the threads ALREADY TRACKED. Your job is to RECONCILE: compare the tracked threads against what the prose actually does now, and propose a DIFF.

For each change, choose an action:
- "new":     a thread the prose opens that is NOT yet tracked. (threadId = null)
- "advance": a tracked thread the prose develops but does NOT yet resolve. (threadId = its id)
- "close":   a tracked (or newly-found) thread the prose PAYS OFF. Set the payoff page. (threadId = id, or null if also new)
- "update":  correct a tracked thread's name/description/setup page to match the prose. (threadId = id)

Anchor every thread to real page [id]s: setupPageId = where it is planted; payoffPageId = where it lands (null if still open). Use ONLY ids from the list. Do NOT compute word distances — that is done for you from the page ids.

A thread is "planned" if it is tracked but the prose has not seeded it yet; "open" once the prose plants the setup; "closed" once paid off. Set "status" to the thread's state AFTER this change.

Be conservative: only flag a real promise the reader is meant to remember — not ordinary description. Do not duplicate a thread already tracked; reconcile to it via its id. Threads marked LOCKED are author-owned — do NOT propose changes to them.

Output JSON ONLY (no prose, no fences), exactly:
{
  "summary": "<2-3 sentences: the state of the book's threads and what this scan changes>",
  "changes": [
    { "action": "new|advance|close|update", "threadId": <id|null>, "name": "...", "description": "...", "status": "planned|open|closed", "setupPageId": <id|null>, "payoffPageId": <id|null>, "why": "<one line of evidence from the prose>" }
  ]
}`;

function briefContext(brief: Brief | null): string {
  if (!brief) return "(no brief set)";
  const lines: string[] = [];
  if (brief.scope?.band) lines.push(`- Scope: ${brief.scope.band}${brief.scope.word_target ? ` (≈${brief.scope.word_target} words)` : ""}`);
  if (brief.genre) lines.push(`- Genre: ${brief.genre}`);
  if (brief.audience) lines.push(`- Audience: ${brief.audience}`);
  if (brief.premise) lines.push(`- Premise: ${brief.premise}`);
  if (brief.tone?.length) lines.push(`- Tone: ${brief.tone.join(", ")}`);
  if (brief.success_criteria) lines.push(`- Success looks like: ${brief.success_criteria}`);
  return lines.length ? lines.join("\n") : "(brief is empty)";
}

// The book as id-tagged pages with their word-offset and prose, in reading order.
function bookContext(pages: PageRow[], positions: Map<number, { start: number; count: number }>): string {
  return pages
    .map((p) => {
      const pos = positions.get(p.id);
      const at = pos ? `word ${pos.start}` : "word ?";
      if (p.page_type === "section") return `\n[id=${p.id}] # ${p.title || "(untitled section)"}  (@${at})`;
      const prose = tiptapToText(p.content).trim();
      const body = prose ? prose.slice(0, PER_PAGE_PROSE_CAP) : "(no prose yet)";
      return `[id=${p.id}] "${p.title || "(untitled)"}"  (@${at}, ${pos?.count ?? 0} words)\n${body}`;
    })
    .join("\n\n");
}

// Existing threads as a digest the model reconciles against.
function threadsContext(threads: ThreadRow[]): string {
  if (!threads.length) return "(none tracked yet — this is the first scan)";
  return threads
    .map((t) => {
      const lock = t.author_locked ? " [LOCKED — do not change]" : "";
      const setup = t.setup_page_id != null ? ` setup@page ${t.setup_page_id}` : "";
      const payoff = t.payoff_page_id != null ? ` payoff@page ${t.payoff_page_id}` : "";
      return `- [id=${t.id}] "${t.name}" (${t.status})${setup}${payoff}${lock}${t.description ? ` — ${t.description}` : ""}`;
    })
    .join("\n");
}

// ── Output contract (shared with the client applier) ──────────────────────────
export interface ThreadChange {
  action: "new" | "advance" | "close" | "update";
  threadId: number | null;
  name: string;
  description: string;
  status: "planned" | "open" | "closed";
  setupPageId: number | null;
  payoffPageId: number | null;
  why: string;
  // server-resolved (not from the model):
  setupWordOffset: number | null;
  payoffWordOffset: number | null;
  distance: number | null;     // payoff − setup, or (current end − setup) if still open
}
export interface ThreadScan {
  summary: string;
  changes: ThreadChange[];
}

async function callClaude(
  apiKey: string,
  bookName: string,
  brief: Brief | null,
  bible: string | null,
  pages: PageRow[],
  positions: Map<number, { start: number; count: number }>,
  threads: ThreadRow[],
  totalWords: number
): Promise<RawScan> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [
        {
          role: "user",
          content:
            `BOOK: ${bookName} (${totalWords} words)\n\nBRIEF:\n${briefContext(brief)}` +
            (bible ? `\n\nBOOK BIBLE:\n${bible}` : "") +
            `\n\nTHREADS ALREADY TRACKED:\n${threadsContext(threads)}` +
            `\n\nTHE BOOK (pages with [id], word-offset, and prose):\n${bookContext(pages, positions)}` +
            `\n\nReconcile the threads against the prose. JSON only.`,
        },
      ],
    }),
  });

  if (!res.ok) throw new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 500)}`);

  const data = await res.json();
  const text = (data.content ?? [])
    .filter((b: { type: string }) => b.type === "text")
    .map((b: { text: string }) => b.text)
    .join("")
    .trim();
  if (!text) throw new Error("Claude returned no text content.");
  return parseScan(text, new Set(threads.map((t) => t.id)), new Set(threads.filter((t) => t.author_locked).map((t) => t.id)));
}

interface RawChange {
  action: "new" | "advance" | "close" | "update";
  threadId: number | null;
  name: string;
  description: string;
  status: "planned" | "open" | "closed";
  setupPageId: number | null;
  payoffPageId: number | null;
  why: string;
}
interface RawScan {
  summary: string;
  changes: RawChange[];
}

function parseScan(text: string, validThreadIds: Set<number>, lockedIds: Set<number>): RawScan {
  let raw = text.trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) raw = fence[1].trim();
  else {
    const first = raw.indexOf("{");
    const last = raw.lastIndexOf("}");
    if (first !== -1 && last > first) raw = raw.slice(first, last + 1);
  }

  let parsed: Partial<RawScan>;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Could not parse thread scan JSON: ${(e as Error).message}`);
  }
  const actions = new Set(["new", "advance", "close", "update"]);
  const statuses = new Set(["planned", "open", "closed"]);

  const changes: RawChange[] = [];
  for (const entry of Array.isArray(parsed.changes) ? parsed.changes : []) {
    const c = entry as Partial<RawChange>;
    if (!c.name || typeof c.name !== "string" || !c.name.trim()) continue;
    const action = actions.has(c.action as string) ? (c.action as RawChange["action"]) : "new";
    // threadId must reference a real existing thread; otherwise treat as new.
    let threadId = typeof c.threadId === "number" && validThreadIds.has(c.threadId) ? c.threadId : null;
    // Safety net: never touch a locked thread, whatever the model said.
    if (threadId != null && lockedIds.has(threadId)) continue;
    const isNew = action === "new" || threadId == null;
    if (isNew) threadId = null;
    changes.push({
      action: isNew ? "new" : action,
      threadId,
      name: c.name.trim(),
      description: typeof c.description === "string" ? c.description.trim() : "",
      status: statuses.has(c.status as string) ? (c.status as RawChange["status"]) : "open",
      setupPageId: typeof c.setupPageId === "number" ? c.setupPageId : null,
      payoffPageId: typeof c.payoffPageId === "number" ? c.payoffPageId : null,
      why: typeof c.why === "string" ? c.why.trim() : "",
    });
  }
  return { summary: String(parsed.summary ?? "").trim(), changes };
}

// Resolve page-id anchors → word offsets + distance, server-side. Page ids not in the offset
// map (e.g. hallucinated) resolve to null so the arithmetic stays trustworthy.
function resolveOffsets(
  scan: RawScan,
  positions: Map<number, { start: number; count: number }>,
  total: number
): ThreadScan {
  const offsetOf = (pageId: number | null): number | null =>
    pageId != null && positions.has(pageId) ? positions.get(pageId)!.start : null;

  const changes: ThreadChange[] = scan.changes.map((c) => {
    const setupWordOffset = offsetOf(c.setupPageId);
    const payoffWordOffset = offsetOf(c.payoffPageId);
    // Distance: setup→payoff if closed; otherwise setup→end-of-book (how long it's been open).
    let distance: number | null = null;
    if (setupWordOffset != null) {
      const end = payoffWordOffset != null ? payoffWordOffset : total;
      distance = Math.max(0, end - setupWordOffset);
    }
    return {
      ...c,
      // a payoff page implies the thread is closed even if the model mislabeled status
      status: c.payoffPageId != null ? "closed" : c.status,
      setupWordOffset,
      payoffWordOffset,
      distance,
    };
  });

  return { summary: scan.summary, changes };
}
