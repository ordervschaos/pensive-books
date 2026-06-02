// evaluate-book — "The editor's read".
//
// Runs a developmental fiction edit against the embedded rubric using Claude, and
// stores the result in book_evaluations. Long job (~30-90s), so it returns a
// `pending` row immediately and finishes in the background (EdgeRuntime.waitUntil):
//
//   client → POST { bookId }
//     → verify caller can edit the book
//     → INSERT book_evaluations row (status:'pending')   ← returned in ~1s
//     → background: fetch manuscript → Claude → UPDATE row (status:'done'|'error')
//     → client learns via Realtime on book_evaluations
//
// Needs the ANTHROPIC_API_KEY secret:  supabase secrets set ANTHROPIC_API_KEY=...
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { EDITOR_SYSTEM, FICTION_RUBRIC } from "./rubric.ts";
import { captureException, isBillingError } from "../_shared/sentry.ts";

const MODEL = "claude-opus-4-8";
// brief.scope.band values that mean non-fiction (mirrors apps/web/src/lib/brief.ts).
const NONFICTION_BANDS = new Set(["essay", "guide", "nonfiction_book", "comprehensive"]);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

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

    const { bookId } = await req.json().catch(() => ({}));
    if (!bookId) return json({ error: "bookId is required" }, 400);

    // Book + access check (owner or accepted collaborator).
    const { data: book, error: bookError } = await userClient
      .from("books")
      .select("id, name, subtitle, author, brief, owner_id")
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

    // Fiction only for now — refuse non-fiction by the brief's scope band.
    const band = (book.brief as Brief | null)?.scope?.band;
    if (band && NONFICTION_BANDS.has(band)) {
      return json({ error: "The non-fiction rubric isn't available yet." }, 400);
    }

    // Service-role client for writes + manuscript read (bypasses RLS; reliable in background).
    const service = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);

    const { data: evalRow, error: insertError } = await service
      .from("book_evaluations")
      .insert({
        book_id: book.id,
        created_by: user.id,
        kind: "fiction",
        model: MODEL,
        status: "pending",
        brief_snapshot: book.brief ?? null,
      })
      .select()
      .single();
    if (insertError || !evalRow) return json({ error: "Could not start evaluation" }, 500);

    // Hand the slow work to the background; respond now with the pending row.
    const work = runEvaluation(service, apiKey, evalRow.id, book);
    if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(work);

    return json({ status: "pending", evaluation: evalRow }, 202);
  } catch (e) {
    console.error("evaluate-book error:", e);
    return json({ error: "Internal server error" }, 500);
  }
});

interface Brief {
  scope?: { band?: string; word_target?: number };
  genre?: string;
  audience?: string;
  premise?: string;
  tone?: string[];
  success_criteria?: string;
}
interface BookRow {
  id: number;
  name: string;
  subtitle: string | null;
  author: string | null;
  brief: Brief | null;
}

async function runEvaluation(
  service: ReturnType<typeof createClient>,
  apiKey: string,
  evalId: number,
  book: BookRow
) {
  try {
    const { data: pages, error: pagesError } = await service
      .from("pages")
      .select("id, title, content, html_content, page_index, page_type")
      .eq("book_id", book.id)
      .eq("archived", false)
      .order("page_index", { ascending: true });
    if (pagesError) throw new Error(`fetch pages: ${pagesError.message}`);
    if (!pages || pages.length === 0) throw new Error("Book has no pages to evaluate.");

    const { manuscript, wordCount } = buildManuscript(book, pages);
    const result = await callClaude(apiKey, book, manuscript);

    const { error: updateError } = await service
      .from("book_evaluations")
      .update({ status: "done", result, word_count: wordCount })
      .eq("id", evalId);
    if (updateError) throw new Error(`save result: ${updateError.message}`);
  } catch (e) {
    console.error(`evaluate-book run ${evalId} failed:`, e);
    const billing = isBillingError(e);
    await captureException(e, { function: "evaluate-book", book_id: String(book.id), billing: String(billing) });
    const userMsg = billing
      ? "AI credits exhausted — the team has been notified."
      : String((e as Error)?.message ?? e).slice(0, 1000);
    await service
      .from("book_evaluations")
      .update({ status: "error", error: userMsg })
      .eq("id", evalId);
  }
}

// ── Manuscript assembly ──────────────────────────────────────────────────────
function buildManuscript(book: BookRow, pages: PageRow[]) {
  const head = [
    `TITLE: ${book.name}${book.subtitle ? ` — ${book.subtitle}` : ""}`,
    book.author ? `AUTHOR: ${book.author}` : null,
    briefContext(book.brief),
    "",
    "MANUSCRIPT (each page is marked with its real id — cite issues using ONLY these ids):",
  ].filter(Boolean).join("\n");

  let wordCount = 0;
  const body = pages
    .map((p) => {
      const text = pageText(p);
      wordCount += countWords(text);
      const kind = p.page_type === "section" ? " (section divider)" : "";
      return `\n[id=${p.id} · #${p.page_index} · "${p.title ?? "Untitled"}"${kind}]\n${text}`;
    })
    .join("\n");

  return { manuscript: `${head}\n${body}`, wordCount };
}

function briefContext(brief: Brief | null): string | null {
  if (!brief) return null;
  const lines: string[] = ["AUTHOR'S BRIEF (the contract to judge against):"];
  const b = brief.scope?.band;
  const wt = brief.scope?.word_target;
  if (b || wt) lines.push(`- Scope: ${[b, wt ? `≈${wt.toLocaleString()} words` : null].filter(Boolean).join(" · ")}`);
  if (brief.genre) lines.push(`- Genre: ${brief.genre}`);
  if (brief.audience) lines.push(`- Audience: ${brief.audience}`);
  if (brief.premise) lines.push(`- Premise: ${brief.premise}`);
  if (brief.tone?.length) lines.push(`- Tone: ${brief.tone.join(", ")}`);
  if (brief.success_criteria) lines.push(`- Success looks like: ${brief.success_criteria}`);
  return lines.length > 1 ? lines.join("\n") : null;
}

interface PageRow {
  id: number;
  title: string | null;
  content: unknown;
  html_content: string | null;
  page_index: number;
  page_type: string | null;
}

// Tiptap JSON → plain text, with html_content as fallback.
function pageText(p: PageRow): string {
  const fromJson = tiptapToText(p.content).trim();
  if (fromJson) return fromJson;
  if (p.html_content) return p.html_content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return "";
}

function tiptapToText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as { type?: string; text?: string; content?: unknown[] };
  if (n.type === "text") return n.text ?? "";
  if (n.type === "hardBreak") return "\n";
  let out = "";
  for (const child of n.content ?? []) out += tiptapToText(child);
  if (["paragraph", "heading", "blockquote", "listItem", "codeBlock"].includes(n.type ?? "")) {
    out += "\n\n";
  }
  return out;
}

function countWords(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

// ── Claude call ──────────────────────────────────────────────────────────────
async function callClaude(apiKey: string, book: BookRow, manuscript: string) {
  // 120s hard cap: if Claude hangs or is slow the Supabase wall-clock limit would kill the
  // worker silently (no catch, row stays pending forever). Aborting here gives the catch block
  // enough time to write an "error" row and report to Sentry before the worker exits.
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal: AbortSignal.timeout(120_000),
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 32000,
      thinking: { type: "adaptive" }, // Opus 4.8: adaptive is the only mode; high effort is default
      // Rubric is stable across books → cache it so re-runs are cheap.
      system: [
        { type: "text", text: EDITOR_SYSTEM },
        { type: "text", text: FICTION_RUBRIC, cache_control: { type: "ephemeral" } },
      ],
      messages: [
        {
          role: "user",
          content: `Evaluate this manuscript and return the JSON object per the output contract — JSON only, no prose, no fences.\n\n${manuscript}`,
        },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    let parsed: { error?: { type?: string; message?: string } } = {};
    try { parsed = JSON.parse(body); } catch { /* ignore */ }
    const msg = parsed.error?.message ?? body;
    const err = new Error(`Claude API ${res.status}: ${msg.slice(0, 500)}`);
    if (parsed.error?.message?.toLowerCase().includes("credit balance")) (err as Error & { billing?: boolean }).billing = true;
    throw err;
  }

  const data = await res.json();
  const text = (data.content ?? [])
    .filter((b: { type: string }) => b.type === "text")
    .map((b: { text: string }) => b.text)
    .join("")
    .trim();
  if (!text) throw new Error("Claude returned no text content.");

  return parseResult(text);
}

// Defensive parse — model is told "JSON only", but strip fences / slice to the
// outermost object just in case, then sanity-check the shape.
function parseResult(text: string) {
  let raw = text.trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) raw = fence[1].trim();
  else {
    const first = raw.indexOf("{");
    const last = raw.lastIndexOf("}");
    if (first !== -1 && last > first) raw = raw.slice(first, last + 1);
  }
  let result: { verdict?: unknown; sections?: unknown };
  try {
    result = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Could not parse model output as JSON: ${(e as Error).message}`);
  }
  if (!result.verdict || !Array.isArray(result.sections)) {
    throw new Error("Model output missing verdict/sections.");
  }
  return result;
}
