// revise-scaffold — revise a PROPOSED outline (pre-page-creation) from an author instruction.
//
// The preserve path for the scaffold review step: given the current proposal and an instruction,
// rewrite the outline to honour the ask while keeping what already works. Brief and spine are
// always in context — the opposite of spine-to-objectives, which drafts fresh.
//
//   client → POST { bookId, scaffold, instruction } → verify edit access → { structure, pages, threads }
//
// Synchronous. The client updates the review draft in place. Needs ANTHROPIC_API_KEY.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { callClaude, textFromClaude, type CallMeta } from "../_shared/claude.ts";
import { getActiveModels } from "../_shared/model-config.ts";
import { extractJsonBlock } from "../_shared/json.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

interface Brief {
  scope?: { band?: string; word_target?: number };
  genre?: string;
  audience?: string;
  premise?: string;
  tone?: string[];
  success_criteria?: string;
}

interface ScaffoldPage { pageType: "section" | "text"; title: string; objective?: string }
interface ScaffoldThread {
  name: string;
  description: string;
  setupPageIndex: number | null;
  payoffPageIndex: number | null;
  targetDistance: number | null;
}
interface Scaffold { structure: string; pages: ScaffoldPage[]; threads?: ScaffoldThread[] }

const SYSTEM = `You are a book architect revising an EXISTING outline (objectives only — no prose). The author's INSTRUCTION is the primary directive: do what it asks while PRESERVING what already works. Brief and spine stay in context throughout.

You may change objectives, re-order pages, add or cut pages, and re-anchor threads as needed — but be surgical: change only what the instruction requires.

The outline is an ordered list of pages:
- "section" pages are chapter/part dividers (a title; an objective is optional).
- "text" pages are where prose will go; each MUST have a concise objective.

Also maintain THREADS — foreshadowing, planted questions, setups that pay off. Anchor each to pages by 0-based index in "pages".

Output JSON ONLY (no prose, no fences), exactly:
{
  "structure": "<the structure>",
  "pages": [
    { "pageType": "section", "title": "...", "objective": "" },
    { "pageType": "text", "title": "...", "objective": "..." }
  ],
  "threads": [
    { "name": "...", "description": "...",
      "setupPageIndex": <index>, "payoffPageIndex": <index>,
      "targetDistance": <approx words> }
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

function bookContext(bookName: string, brief: Brief | null, spine: string | null): string {
  return `BOOK: ${bookName}` +
    (spine ? `\n\nBOOK SPINE (the throughline — the outline must realize this):\n${spine}` : "") +
    `\n\nBRIEF:\n${briefContext(brief)}`;
}

// deno-lint-ignore no-explicit-any
const textOf = (data: any): string => textFromClaude(data).trim();

function parseScaffold(text: string): Scaffold {
  let parsed: Scaffold;
  try {
    parsed = JSON.parse(extractJsonBlock(text));
  } catch (e) {
    throw new Error(`Could not parse scaffold JSON: ${(e as Error).message}`);
  }
  if (!Array.isArray(parsed.pages) || parsed.pages.length === 0) {
    throw new Error("Scaffold has no pages.");
  }

  parsed.pages = parsed.pages
    .filter((p) => p && (p.pageType === "section" || p.pageType === "text") && typeof p.title === "string")
    .map((p) => ({ pageType: p.pageType, title: p.title.trim(), objective: (p.objective ?? "").trim() }));

  const MAX_PAGES = 150;
  if (parsed.pages.length > MAX_PAGES) parsed.pages = parsed.pages.slice(0, MAX_PAGES);

  const n = parsed.pages.length;
  const validIndex = (v: unknown): number | null =>
    typeof v === "number" && Number.isInteger(v) && v >= 0 && v < n ? v : null;
  const threads: ScaffoldThread[] = (Array.isArray(parsed.threads) ? parsed.threads : [])
    .filter((t): t is ScaffoldThread => !!t && typeof (t as ScaffoldThread).name === "string" && !!(t as ScaffoldThread).name.trim())
    .map((t) => ({
      name: t.name.trim(),
      description: typeof t.description === "string" ? t.description.trim() : "",
      setupPageIndex: validIndex(t.setupPageIndex),
      payoffPageIndex: validIndex(t.payoffPageIndex),
      targetDistance: typeof t.targetDistance === "number" && t.targetDistance > 0 ? Math.round(t.targetDistance) : null,
    }));

  return { structure: String(parsed.structure ?? "").trim(), pages: parsed.pages, threads };
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

    const { bookId, scaffold, instruction } = (await req.json().catch(() => ({}))) as {
      bookId?: number;
      scaffold?: Scaffold;
      instruction?: string;
    };
    if (!bookId) return json({ error: "bookId is required" }, 400);
    const instr = (instruction ?? "").trim();
    if (!instr) return json({ error: "An instruction is required" }, 400);
    if (!scaffold?.pages?.length) return json({ error: "A scaffold with pages is required" }, 400);

    const { data: book, error: bookError } = await userClient
      .from("books").select("id, name, brief, spine, owner_id").eq("id", bookId).single();
    if (bookError || !book) return json({ error: "Book not found" }, 404);

    const { data: access } = await userClient
      .from("book_access").select("id").eq("book_id", bookId).eq("user_id", user.id).eq("status", "accepted").maybeSingle();
    if (book.owner_id !== user.id && !access) return json({ error: "Access denied" }, 403);

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);

    const brief = book.brief as Brief | null;
    const spine = (book.spine as { text?: string } | null)?.text?.trim() || null;
    const meta: CallMeta = { fn: "revise-scaffold", bookId, userId: user.id };
    const { high: model } = await getActiveModels();

    const data = await callClaude(apiKey, {
      model,
      max_tokens: 8000,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{
        role: "user",
        content:
          `${bookContext(book.name, brief, spine)}\n\nCURRENT OUTLINE (JSON):\n${JSON.stringify({
            structure: scaffold.structure ?? "",
            pages: scaffold.pages,
            threads: scaffold.threads ?? [],
          })}\n\nAUTHOR'S INSTRUCTION:\n${instr}\n\nReturn the revised outline. JSON only.`,
      }],
    }, meta);

    const text = textOf(data);
    if (!text) return json({ error: "Claude returned no revised outline." }, 502);
    const revised = parseScaffold(text);
    return json(revised);
  } catch (e) {
    console.error("revise-scaffold error:", e);
    return json({ error: String((e as Error)?.message ?? e).slice(0, 500) }, 500);
  }
});
