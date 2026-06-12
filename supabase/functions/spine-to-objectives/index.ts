// spine-to-objectives — propose a book's objective tree (the spine→objectives edge of the ladder).
//
// From the book SPINE (the throughline) — falling back to the brief if no spine is set — Claude
// designs the chapter/page outline: section (chapter) + text pages, each with a title and an
// OBJECTIVE (what it must achieve) — NO prose. This is the one one-to-many transform: it mints the
// page units everything below renders 1:1. The
// proposal is a REVIEWABLE artifact (the author reviews the plan, the high-value step, and the
// client creates the pages on confirm), so it's persisted as a book_generations task row instead
// of returned inline — a refresh resumes the loader, and the proposal survives until applied.
//
//   client → POST { bookId }
//     → verify edit access
//     → INSERT book_generations { kind:'scaffold', status:'running' }   ← returned in ~1s
//     → background: Claude → UPDATE row { status:'ready', result:{structure,pages,threads} }
//     → client watches book_generations via Realtime
//
// Needs the ANTHROPIC_API_KEY secret (shared with the other AI steps).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { runInBackground, serviceClient } from "../_shared/task.ts";
import { callClaude as callClaudeApi, type CallMeta } from "../_shared/claude.ts";
import { getActiveModels } from "../_shared/model-config.ts";
import { type Foundations, settledContext } from "../_shared/foundations-core.ts";
import { canonContext, type CanonPacket } from "../_shared/canon-core.ts";
import { type Delta } from "../_shared/page-state.ts";

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
      .select("id, name, subtitle, brief, spine, foundations, canon, owner_id")
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

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);

    const bookName = book.name;
    const brief = book.brief as Brief | null;
    const spine = (book.spine as { text?: string } | null)?.text?.trim() || null;
    const foundations = (book.foundations as Foundations | null) ?? null;
    const canon = (book.canon as CanonPacket | null) ?? null;

    // Insert the task row (service role; the client watches it over Realtime), then hand the
    // proposal to the background and return the row immediately.
    const service = serviceClient();
    const { data: gen, error: insertError } = await service
      .from("book_generations")
      .insert({ book_id: bookId, created_by: user.id, kind: "scaffold", scope: "book", status: "running", input: {} })
      .select()
      .single();
    if (insertError || !gen) return json({ error: "Could not start scaffold" }, 500);

    runInBackground(service, "book_generations", gen.id, "spine-to-objectives", async () => {
      const meta: CallMeta = { fn: "spine-to-objectives", bookId, taskTable: "book_generations", taskId: gen.id, userId: user.id };
      const { high: model } = await getActiveModels();
      // Self-critique loop (Self-Refine): a single forward pass gives the modal, predictable outline.
      // Pressure-test the PLAN against story craft, then revise once — errors here compound into every
      // page, so a dollar of quality at the outline is worth ~10 at the prose.
      const draft = await draftScaffold(apiKey, model, bookName, brief, spine, foundations, canon, meta);
      const critique = await critiqueScaffold(apiKey, model, bookName, brief, spine, draft, { ...meta, fn: "spine-critique" });
      const revised = await reviseScaffold(apiKey, model, bookName, brief, spine, foundations, canon, draft, critique, { ...meta, fn: "spine-revise" });
      return { status: "ready", result: { ...revised, critique } };
    });

    return json({ status: "running", generation: gen }, 202);
  } catch (e) {
    console.error("spine-to-objectives error:", e);
    return json({ error: String((e as Error)?.message ?? e).slice(0, 500) }, 500);
  }
});

// ── Prompt ───────────────────────────────────────────────────────────────────
const SYSTEM = `You are a book architect. Given the book's SPINE (its throughline) — or, if no spine
is set, the author's brief — design the book's chapters and pages as OBJECTIVES, not prose. The
outline must realize the spine: every page serves the book-level aim.

Choose a structure appropriate to the genre and scope (e.g. Save the Cat or the Hero's
Journey for commercial fiction; the Fichtean curve for thrillers; a five-part arc for
self-help; a curated arc for memoir). Lay the book out as an ordered list of pages:
- "section" pages are chapter/part dividers (a title; an objective is optional).
- "text" pages are where prose will go; each MUST have a concise objective stating what
  that page must achieve (the beat it delivers, in one sentence).

Keep the size proportional to the scope: a short story is a handful of text pages; a novel
is chapters (section pages) each followed by several text pages.

Also plan the book's THREADS — the promises it will make and keep: foreshadowing, planted
questions, setups that want a payoff. A good book seeds a thread early and lands it later, at a
deliberate DISTANCE. For each thread, name it, say what it promises, and anchor it to the pages
that should SET IT UP and PAY IT OFF — referenced by their 0-based index in the "pages" array.
Estimate the setup→payoff distance in words ("targetDistance") from the scope and where the
pages fall. Plan only a handful of real threads; don't over-seed.

Output JSON ONLY (no prose, no fences), exactly:
{
  "structure": "<the structure you chose>",
  "pages": [
    { "pageType": "section", "title": "Chapter 1 — ...", "objective": "" },
    { "pageType": "text", "title": "...", "objective": "..." }
  ],
  "threads": [
    { "name": "...", "description": "what it promises / how it pays off",
      "setupPageIndex": <index into pages[]>, "payoffPageIndex": <index into pages[]>,
      "targetDistance": <approx words from setup to payoff> }
  ]
}`;

// Appended for pin-driven-flow books (docs/pinned_method.md §3.4): the outline also plans each
// page's narrative DELTA and places the tentpole moments. Pinned foundations are hard constraints.
const FOUNDATIONS_ADDENDUM = `

This book has SETTLED FOUNDATIONS (argument, ending, cast, tentpole moments — given in the input).
Honor them as hard constraints: anything marked PINNED is the author's and must survive verbatim
into the plan; KILLED directions must not appear.

Two additions to your output:

1. Each "text" page also gets "delta" — what this page CHANGES in the narrative state (1–3 entries,
   coarse). A page that changes nothing is a dead page; don't plan one. Each entry:
   { "type": "character" | "thread" | "value" | "world",
     "subject": "<character name / thread name / value name / world fact>",
     "from": "<state before (optional)>", "to": "<state after>" }

2. Top-level "tentpolePlacements": place EVERY non-killed tentpole moment on exactly ONE text page
   (the page whose objective realizes that moment). Pinned tentpoles MUST all be placed.
   [{ "tentpoleId": "<the tentpole's [id] from the input>", "pageIndex": <index into pages[]> }]`;

function briefContext(brief: Brief | null): string {
  if (!brief) return "(no brief set — infer a sensible book from a neutral premise)";
  const lines: string[] = [];
  if (brief.scope?.band) lines.push(`- Scope: ${brief.scope.band}${brief.scope.word_target ? ` (≈${brief.scope.word_target} words)` : ""}`);
  if (brief.genre) lines.push(`- Genre: ${brief.genre}`);
  if (brief.audience) lines.push(`- Audience: ${brief.audience}`);
  if (brief.premise) lines.push(`- Premise: ${brief.premise}`);
  if (brief.tone?.length) lines.push(`- Tone: ${brief.tone.join(", ")}`);
  if (brief.success_criteria) lines.push(`- Success looks like: ${brief.success_criteria}`);
  return lines.length ? lines.join("\n") : "(brief is empty — infer a sensible book)";
}

interface ScaffoldPage { pageType: "section" | "text"; title: string; objective?: string; delta?: Delta[] }
// A planned thread anchored to pages by their index in pages[] (no page ids exist yet — the
// client maps index → created page id when it writes the scaffold).
interface ScaffoldThread {
  name: string;
  description: string;
  setupPageIndex: number | null;
  payoffPageIndex: number | null;
  targetDistance: number | null;
}
// New-flow only: which text page realizes each tentpole moment (page ids minted client-side).
interface TentpolePlacement { tentpoleId: string; pageIndex: number }
interface Scaffold { structure: string; pages: ScaffoldPage[]; threads: ScaffoldThread[]; tentpolePlacements?: TentpolePlacement[] }

function textOf(data: { content?: Array<{ type: string; text?: string }> }): string {
  return (data.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("")
    .trim();
}

// The brief/spine context block, shared by the draft and revise prompts.
function bookContext(bookName: string, brief: Brief | null, spine: string | null, foundations: Foundations | null, canon: CanonPacket | null): string {
  return `BOOK: ${bookName}` +
    (spine ? `\n\nBOOK SPINE (the throughline — the outline must realize this):\n${spine}` : "") +
    `\n\nBRIEF:\n${briefContext(brief)}` +
    (canon ? `\n\nCANON (settled facts from the previous book — honor, never contradict, never retell):\n${canonContext(canon)}` : "") +
    (foundations ? `\n\nSETTLED FOUNDATIONS (pinned items are immutable constraints):\n${settledContext(foundations)}` : "");
}

async function draftScaffold(apiKey: string, model: string, bookName: string, brief: Brief | null, spine: string | null, foundations: Foundations | null, canon: CanonPacket | null, meta: CallMeta): Promise<Scaffold> {
  const data = await callClaudeApi(apiKey, {
    model,
    max_tokens: 8000,
    system: [{ type: "text", text: SYSTEM + (foundations ? FOUNDATIONS_ADDENDUM : ""), cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: `${bookContext(bookName, brief, spine, foundations, canon)}\n\nDesign the outline. JSON only.` }],
  }, meta);
  const text = textOf(data);
  if (!text) throw new Error("Claude returned no text content.");
  return parseScaffold(text);
}

const CRITIQUE_SYSTEM = `You are a tough developmental story editor pressure-testing a book's OUTLINE (objectives only — no prose has been written yet). Flaws in the PLAN compound into every page, so your job is to find them now.

Judge the outline on three axes ONLY:
1. PLOT LOGIC — does each beat CAUSE the next ("therefore"/"but", not "and then")? Does tension escalate? Is there a soft or sagging middle? Any unmotivated turns, coincidences, or conveniences?
2. CHARACTER ARC — is the protagonist's surface WANT and deeper NEED legible? Do they change across the outline? Are the stakes personal, not merely external?
3. GENRE CONTRACT — does the outline deliver the obligatory scenes the genre/premise promises? What is the reader owed that's missing?

Output 4–8 SPECIFIC, actionable notes: name the page/section, what's wrong, and what it needs. No praise padding — if an axis is genuinely strong, say so in one line and move on. Plain text, terse, no preamble.`;

async function critiqueScaffold(apiKey: string, model: string, bookName: string, brief: Brief | null, spine: string | null, draft: Scaffold, meta: CallMeta): Promise<string> {
  const outline = draft.pages
    .map((p, i) => (p.pageType === "section" ? `\n[${i}] # ${p.title}${p.objective ? ` — ${p.objective}` : ""}` : `[${i}] - ${p.title}${p.objective ? ` — ${p.objective}` : ""}`))
    .join("\n");
  const threads = draft.threads.length
    ? "\n\nTHREADS:\n" + draft.threads.map((t) => `- ${t.name}: ${t.description} (setup ${t.setupPageIndex} → payoff ${t.payoffPageIndex})`).join("\n")
    : "";
  const data = await callClaudeApi(apiKey, {
    model,
    max_tokens: 2000,
    system: [{ type: "text", text: CRITIQUE_SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{
      role: "user",
      content: `BOOK: ${bookName}\n\nBRIEF:\n${briefContext(brief)}` +
        (spine ? `\n\nSPINE:\n${spine}` : "") +
        `\n\nOUTLINE (structure: ${draft.structure}):${outline}${threads}\n\nCritique this outline.`,
    }],
  }, meta);
  return textOf(data);
}

const REVISE_INSTRUCTION = `

You are REVISING an existing outline to address an editor's critique. Apply EVERY note that improves plot logic, character arc, or genre delivery — change objectives, re-order or add/cut pages, and re-anchor threads as needed. Preserve what already works; this is a revision, not a fresh start. Output the full improved outline as JSON ONLY, in the exact schema above.`;

async function reviseScaffold(apiKey: string, model: string, bookName: string, brief: Brief | null, spine: string | null, foundations: Foundations | null, canon: CanonPacket | null, draft: Scaffold, critique: string, meta: CallMeta): Promise<Scaffold> {
  const data = await callClaudeApi(apiKey, {
    model,
    max_tokens: 8000,
    system: [{ type: "text", text: SYSTEM + (foundations ? FOUNDATIONS_ADDENDUM : "") + REVISE_INSTRUCTION, cache_control: { type: "ephemeral" } }],
    messages: [{
      role: "user",
      content: `${bookContext(bookName, brief, spine, foundations, canon)}\n\nDRAFT OUTLINE (JSON):\n${JSON.stringify({ structure: draft.structure, pages: draft.pages, threads: draft.threads, tentpolePlacements: draft.tentpolePlacements ?? [] })}\n\nEDITOR'S CRITIQUE TO ADDRESS:\n${critique}\n\nReturn the revised outline. JSON only.`,
    }],
  }, meta);
  const text = textOf(data);
  if (!text) throw new Error("Claude returned no revised outline.");
  return parseScaffold(text);
}

function parseScaffold(text: string): Scaffold {
  let raw = text.trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) raw = fence[1].trim();
  else {
    const first = raw.indexOf("{");
    const last = raw.lastIndexOf("}");
    if (first !== -1 && last > first) raw = raw.slice(first, last + 1);
  }
  let parsed: Scaffold;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Could not parse scaffold JSON: ${(e as Error).message}`);
  }
  if (!Array.isArray(parsed.pages) || parsed.pages.length === 0) {
    throw new Error("Scaffold has no pages.");
  }
  // Sanitize: keep only valid page shapes (+ each text page's planned delta, new flow only).
  const DELTA_TYPES = new Set(["character", "thread", "value", "world"]);
  const cleanDelta = (raw: unknown): Delta[] | undefined => {
    if (!Array.isArray(raw)) return undefined;
    const out = raw
      .filter((d): d is Delta => !!d && typeof d === "object" && DELTA_TYPES.has((d as Delta).type) &&
        typeof (d as Delta).subject === "string" && !!(d as Delta).subject.trim() &&
        typeof (d as Delta).to === "string" && !!(d as Delta).to.trim())
      .map((d) => ({
        type: d.type, subject: d.subject.trim(), to: d.to.trim(),
        ...(typeof d.from === "string" && d.from.trim() ? { from: d.from.trim() } : {}),
      }));
    return out.length ? out : undefined;
  };
  parsed.pages = parsed.pages
    .filter((p) => p && (p.pageType === "section" || p.pageType === "text") && typeof p.title === "string")
    .map((p) => ({
      pageType: p.pageType, title: p.title.trim(), objective: (p.objective ?? "").trim(),
      ...(p.pageType === "text" ? (() => { const d = cleanDelta(p.delta); return d ? { delta: d } : {}; })() : {}),
    }));

  // Hard cap the proposal. A scaffold is objectives-only (no prose), so even a long novel needs at
  // most ~100-odd pages; anything past this is a runaway proposal the author shouldn't be asked to
  // review or create wholesale.
  const MAX_PAGES = 150;
  if (parsed.pages.length > MAX_PAGES) parsed.pages = parsed.pages.slice(0, MAX_PAGES);

  // Sanitize threads: must be named; page indices must point inside pages[] (else null).
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

  // Sanitize tentpole placements: must name a tentpole and point at a text page inside pages[].
  const tentpolePlacements: TentpolePlacement[] = (Array.isArray(parsed.tentpolePlacements) ? parsed.tentpolePlacements : [])
    .filter((tp): tp is TentpolePlacement =>
      !!tp && typeof (tp as TentpolePlacement).tentpoleId === "string" && !!(tp as TentpolePlacement).tentpoleId.trim() &&
      validIndex((tp as TentpolePlacement).pageIndex) != null &&
      parsed.pages[(tp as TentpolePlacement).pageIndex].pageType === "text")
    .map((tp) => ({ tentpoleId: tp.tentpoleId.trim(), pageIndex: tp.pageIndex }));

  return { structure: String(parsed.structure ?? "").trim(), pages: parsed.pages, threads, tentpolePlacements };
}
