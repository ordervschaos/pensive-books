// revise-outline — the structural "book doctor": instruction/evaluation → a reviewable revision plan
// (the structural-revise transform, parallel to revise-prose). Applied by build-revision.
//
// Given a book's current objective tree + a developmental editor's evaluation, Claude
// proposes a REVISION PLAN: the book's new page structure (keep / revise / retarget / add,
// in final order) plus which existing pages to delete. NO prose is written and NOTHING is
// mutated — the plan is RETURNED so the author reviews it (the high-value gate), and the
// client applies it on confirm (ReviseStructure.tsx).
//
//   client → POST { bookId, evaluation } → verify edit access → Claude → RevisionPlan
//
// Needs the ANTHROPIC_API_KEY secret (shared with evaluate-book / generate-unit / scaffold).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { callClaude as callClaudeApi } from "../_shared/claude.ts";

const MODEL = "claude-opus-4-7";

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

// The evaluation shape (book_evaluations.result), as produced by evaluate-book.
interface EvalIssue {
  severity?: string;
  note: string;
  evidence?: string;
  suggestion?: string;
  page_ref?: { id: number | null; title?: string; index?: number | null } | null;
}
interface EvalSection {
  id: string;
  title: string;
  stance?: string;
  assessment?: string;
  issues?: EvalIssue[];
}
interface EvalResult {
  verdict: { genre_contract?: string; stance?: string; letter?: string; priorities?: string[] };
  sections: EvalSection[];
}

interface PageRow {
  id: number;
  page_index: number;
  page_type: string | null;
  title: string | null;
  metadata: { objective?: string; summary?: string } | null;
}

// Open/planned threads, fed in so restructuring keeps their setup→payoff anchors intact.
interface ThreadLite {
  name: string;
  status: string;
  setup_page_id: number | null;
  payoff_page_id: number | null;
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

    const { bookId, evaluation, instruction, ctx, planOnly } = (await req.json().catch(() => ({}))) as {
      bookId?: number;
      evaluation?: EvalResult;
      instruction?: string;
      planOnly?: boolean; // outline-only: change objectives/structure, never propose prose rewrites
      ctx?: {
        pageCtx?: { id: number; summary: boolean; full: boolean }[] | null;
        threadIds?: number[] | null; // null=all, []=none, [ids]=subset
      };
    };
    // Brief and bible are always included; only page depth and thread selection are variable.
    const threadIdFilter = ctx?.threadIds ?? null;
    const pageCtxArr = ctx?.pageCtx ?? null;
    if (!bookId) return json({ error: "bookId is required" }, 400);
    const hasEval = !!evaluation?.verdict && Array.isArray(evaluation.sections);
    const instr = (instruction ?? "").trim();
    if (!hasEval && !instr) {
      return json({ error: "An instruction or a valid evaluation is required" }, 400);
    }

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
      .select("id, page_index, page_type, title, metadata")
      .eq("book_id", bookId)
      .eq("archived", false)
      .order("page_index", { ascending: true });
    if (pagesError) throw new Error(`fetch pages: ${pagesError.message}`);
    if (!pages || pages.length === 0) return json({ error: "Book has no pages to revise" }, 400);

    // Tracked threads — fed in so the plan doesn't orphan a setup or its payoff when restructuring.
    const { data: threads } = await userClient
      .from("book_threads")
      .select("name, status, setup_page_id, payoff_page_id")
      .eq("book_id", bookId)
      .neq("status", "closed");

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);

    // Build page context map from pageCtxArr
    const pageCtxMap = new Map<number, { summary: boolean; full: boolean }>();
    for (const pc of pageCtxArr ?? []) {
      pageCtxMap.set(pc.id, { summary: !!pc.summary, full: !!pc.full });
    }

    // Fetch prose content for pages where full=true
    const fullPageIds = [...pageCtxMap.entries()].filter(([, e]) => e.full).map(([id]) => id);
    const contentMap = new Map<number, string>();
    if (fullPageIds.length > 0) {
      const { data: fullPages } = await userClient
        .from("pages").select("id, content").in("id", fullPageIds);
      for (const fp of fullPages ?? []) {
        const text = tiptapToText(fp.content).trim();
        if (text) contentMap.set(fp.id, text);
      }
    }

    const allThreads: ThreadLite[] = (threads as ThreadLite[] | null) ?? [];
    const filteredThreads = threadIdFilter !== null
      ? allThreads.filter(t => threadIdFilter.includes(t.id))
      : allThreads;

    const plan = await callClaude(
      apiKey,
      book.name,
      book.brief as Brief | null,
      (book.bible as { text?: string } | null)?.text?.trim() || null,
      pages as PageRow[],
      filteredThreads,
      hasEval ? evaluation! : null,
      instr || null,
      pageCtxMap,
      contentMap,
      bookId,
      user.id,
      planOnly === true,
    );
    return json(plan);
  } catch (e) {
    console.error("revise-outline error:", e);
    return json({ error: String((e as Error)?.message ?? e).slice(0, 500) }, 500);
  }
});

// ── Prompt ───────────────────────────────────────────────────────────────────
const SYSTEM = `You are a book doctor revising an EXISTING book based on the author's instruction and/or a developmental editor's evaluation. You work in OBJECTIVES (what each page must achieve), not prose.

You are given: the brief, the bible, the CURRENT outline (each page with its real [id], type, title, and objective), and — depending on the request — an author's instruction and/or a full editorial evaluation. The AUTHOR'S INSTRUCTION, when present, is the primary directive: do what it asks. The evaluation is the editor's diagnosis to act on. Diagnose the STRUCTURAL changes needed — fulfilling the author's intent, plus problems the evaluation raises (passive protagonist, missing obligatory/“fix these first” scenes, abandoned setups, a sagging middle, redundancy) — and fix them at the level of objectives and structure.

Produce a REVISION PLAN: the book's NEW page list in final reading order, plus the existing pages to delete. For each page entry use one op:
- "keep":     unchanged. (ref = its id; carry its title/objective forward)
- "revise":   keep the page and its objective, but its prose needs fixing per the evaluation. (ref = id)
- "retarget": change the page's objective. Set "objective" to the NEW objective and "rebuild" to
              "rewrite" (the objective changed materially → write fresh prose) or "revise" (a minor
              shift → adapt the existing prose). (ref = id)
- "add":      a NEW page (ref = null). Give pageType, a title, and an objective. Use this for the
              missing beats/scenes the evaluation calls for.
Reorder simply by placing entries in the desired final order.
Separately, list in "deletes" any existing pages to remove (cut redundant/abandoned material).

Rules:
- Use ONLY the real [id]s given. Every existing page MUST appear either in "pages" (with its ref)
  or in "deletes" — never drop a page silently.
- "section" pages are chapter/part dividers; "text" pages carry prose. Keep an objective on every
  text page.
- Be surgical: mark "keep" for what works; change only what the evaluation flags. Do not rewrite
  the whole book if the notes don't demand it.
- Address the verdict's "priorities" (fix these first) — those are the highest-leverage changes.
- TRACKED THREADS (if any) are promises the book must keep. Do NOT delete a page that sets up or
  pays off an open thread without relocating that beat — never orphan a setup or its payoff.

Output JSON ONLY (no prose, no fences), exactly:
{
  "summary": "<2-3 sentences: what this revision changes and why>",
  "pages": [
    { "ref": <id|null>, "op": "keep|revise|retarget|add", "pageType": "section|text", "title": "...", "objective": "...", "rebuild": "rewrite|revise", "why": "<one line tied to the evaluation>" }
  ],
  "deletes": [ { "ref": <id>, "why": "..." } ]
}`;

// Plan-only variant: the author is reshaping the OUTLINE, not reworking prose. The model changes
// objectives + structure and never rewrites a word — pages whose objective changes are left for the
// author to re-render (they get flagged "out of sync"). No "revise", no "rebuild".
const SYSTEM_PLAN_ONLY = `You are a book architect revising an EXISTING book's OUTLINE based on the author's instruction. You work purely in the PLAN: each page's objective (what it must achieve) and the book's structure (which pages exist, and in what order). You do NOT touch prose — pages whose objective changes will be re-rendered later by the author.

You are given: the brief, the bible, the CURRENT outline (each page with its real [id], type, title, and objective), and the author's instruction (the primary directive). Make the structural and objective changes the instruction asks for, and only those.

Produce a REVISION PLAN: the book's NEW page list in final reading order, plus the existing pages to delete. For each page entry use one op:
- "keep":     unchanged. (ref = its id; carry its title/objective forward)
- "retarget": change the page's objective. Set "objective" to the NEW objective. (ref = id)
- "add":      a NEW page (ref = null). Give pageType, a title, and an objective.
Reorder simply by placing entries in the desired final order. Separately, list in "deletes" any existing pages to remove.

NEVER use a "revise" op and NEVER rewrite or adapt prose — this step changes the plan only.

Rules:
- Use ONLY the real [id]s given. Every existing page MUST appear either in "pages" (with its ref) or in "deletes" — never drop a page silently.
- "section" pages are chapter/part dividers; "text" pages carry prose. Keep an objective on every text page.
- Be surgical: mark "keep" for what already fits; change only what the instruction requires.
- TRACKED THREADS (if any) are promises the book must keep. Do NOT delete a page that sets up or pays off an open thread without relocating that beat — never orphan a setup or its payoff.

Output JSON ONLY (no prose, no fences), exactly:
{
  "summary": "<2-3 sentences: what this outline revision changes and why>",
  "pages": [
    { "ref": <id|null>, "op": "keep|retarget|add", "pageType": "section|text", "title": "...", "objective": "...", "why": "<one line>" }
  ],
  "deletes": [ { "ref": <id>, "why": "..." } ]
}`;

function briefContext(brief: Brief | null): string {
  if (!brief) return "(no brief set — infer a sensible neutral voice)";
  const lines: string[] = [];
  if (brief.scope?.band) lines.push(`- Scope: ${brief.scope.band}${brief.scope.word_target ? ` (≈${brief.scope.word_target} words)` : ""}`);
  if (brief.genre) lines.push(`- Genre: ${brief.genre}`);
  if (brief.audience) lines.push(`- Audience: ${brief.audience}`);
  if (brief.premise) lines.push(`- Premise: ${brief.premise}`);
  if (brief.tone?.length) lines.push(`- Tone: ${brief.tone.join(", ")}`);
  if (brief.success_criteria) lines.push(`- Success looks like: ${brief.success_criteria}`);
  return lines.length ? lines.join("\n") : "(brief is empty — infer a sensible neutral voice)";
}

// Minimal Tiptap JSON → plain text (mirrors evaluate-book).
function tiptapToText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as { type?: string; text?: string; content?: unknown[] };
  if (n.type === "text") return n.text ?? "";
  if (n.type === "hardBreak") return "\n";
  let out = "";
  for (const child of n.content ?? []) out += tiptapToText(child);
  if (["paragraph", "heading", "blockquote", "listItem", "codeBlock"].includes(n.type ?? "")) out += "\n\n";
  return out;
}

// Current book as an id-tagged outline the model edits against.
// pageCtxMap: per-page extras { summary, full }. contentMap: prose for full pages.
function outlineContext(
  pages: PageRow[],
  pageCtxMap: Map<number, { summary: boolean; full: boolean }>,
  contentMap: Map<number, string>
): string {
  return pages
    .map((p) => {
      const obj = p.metadata?.objective?.trim();
      const ex = pageCtxMap.get(p.id) ?? { summary: false, full: false };
      let line = p.page_type === "section"
        ? `[id=${p.id}] # ${p.title || "(untitled section)"}${obj ? ` -- ${obj}` : ""}`
        : `[id=${p.id}] - "${p.title || "(untitled)"}"${obj ? ` -- ${obj}` : ""}`;
      if (ex.summary && p.page_type !== "section") {
        const sum = p.metadata?.summary?.trim();
        if (sum) line += `\n  [summary: ${sum}]`;
      }
      if (ex.full && p.page_type !== "section") {
        const prose = contentMap.get(p.id);
        if (prose) line += `\n  [content:\n${prose.slice(0, 3000)}\n  ]`;
      }
      return line;
    })
    .join("\n");
}

// Tracked threads as a compact digest, anchored to page ids the model can keep intact.
function threadsContext(threads: ThreadLite[]): string {
  return threads
    .map((t) => {
      const setup = t.setup_page_id != null ? ` setup@page ${t.setup_page_id}` : "";
      const payoff = t.payoff_page_id != null ? ` payoff@page ${t.payoff_page_id}` : "";
      return `- "${t.name}" (${t.status})${setup}${payoff}`;
    })
    .join("\n");
}

// The evaluation as a compact digest (verdict + priorities + per-section issues with page ids).
function evalContext(ev: EvalResult): string {
  const v = ev.verdict ?? {};
  const head = [
    v.genre_contract ? `Genre contract: ${v.genre_contract}` : "",
    v.stance ? `Stance: ${v.stance}` : "",
    v.letter ? `Editorial letter: ${v.letter}` : "",
    v.priorities?.length ? `Fix these first:\n${v.priorities.map((p, i) => `  ${i + 1}. ${p}`).join("\n")}` : "",
  ].filter(Boolean).join("\n");

  const sections = (ev.sections ?? [])
    .map((s) => {
      const issues = (s.issues ?? [])
        .map((is) => {
          const sev = is.severity ? `[${is.severity}] ` : "";
          const page = is.page_ref?.id != null ? ` (page id ${is.page_ref.id})` : "";
          const sug = is.suggestion ? `  → ${is.suggestion}` : "";
          return `  - ${sev}${is.note}${page}${sug}`;
        })
        .join("\n");
      return `## ${s.title}${s.stance ? ` — ${s.stance}` : ""}${s.assessment ? `\n${s.assessment}` : ""}${issues ? `\n${issues}` : ""}`;
    })
    .join("\n\n");

  return `${head}\n\n${sections}`.trim();
}

export interface PlanPage {
  ref: number | null;
  op: "keep" | "revise" | "retarget" | "add";
  pageType: "section" | "text";
  title: string;
  objective: string;
  rebuild?: "rewrite" | "revise";
  why?: string;
}
export interface RevisionPlan {
  summary: string;
  pages: PlanPage[];
  deletes: { ref: number; why?: string }[];
  planOnly?: boolean; // outline-only revision: the apply path changes the plan and writes no prose
}

async function callClaude(
  apiKey: string,
  bookName: string,
  brief: Brief | null,
  bible: string | null,
  pages: PageRow[],
  threads: ThreadLite[],
  evaluation: EvalResult | null,
  instruction: string | null,
  pageCtxMap: Map<number, { summary: boolean; full: boolean }>,
  contentMap: Map<number, string>,
  bookId: number,
  userId?: string | null,
  planOnly = false,
): Promise<RevisionPlan> {
  const data = await callClaudeApi(apiKey, {
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: [{ type: "text", text: planOnly ? SYSTEM_PLAN_ONLY : SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content:
          `BOOK: ${bookName}\n\nBRIEF (the voice contract):\n${briefContext(brief)}` +
          (bible ? `\n\nBOOK BIBLE (established facts):\n${bible}` : "") +
          `\n\nCURRENT OUTLINE (edit against these real ids):\n${outlineContext(pages, pageCtxMap, contentMap)}` +
          (threads.length ? `\n\nTRACKED THREADS (keep their setups & payoffs intact):\n${threadsContext(threads)}` : "") +
          (instruction ? `\n\nAUTHOR'S INSTRUCTION (primary directive):\n${instruction}` : "") +
          (evaluation ? `\n\nEDITOR'S EVALUATION:\n${evalContext(evaluation)}` : "") +
          `\n\nProduce the revision plan. JSON only.`,
      },
    ],
  }, { fn: "revise-outline", bookId, userId: userId ?? null });

  const text = (data.content ?? [])
    .filter((b: { type: string }) => b.type === "text")
    .map((b: { text: string }) => b.text)
    .join("")
    .trim();
  if (!text) throw new Error("Claude returned no text content.");
  return parsePlan(text, pages, planOnly);
}

// Parse + sanitize the model's plan, enforcing the safety guardrails:
//  - only real ids; coerce shapes; default unknown ops to "keep".
//  - every existing page must be carried (in pages[]) or deleted — any the model omitted
//    are appended as "keep" so a page is NEVER silently dropped.
//  - de-duplicate refs (first wins).
function parsePlan(text: string, existing: PageRow[], planOnly = false): RevisionPlan {
  let raw = text.trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) raw = fence[1].trim();
  else {
    const first = raw.indexOf("{");
    const last = raw.lastIndexOf("}");
    if (first !== -1 && last > first) raw = raw.slice(first, last + 1);
  }

  let parsed: Partial<RevisionPlan>;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Could not parse revision plan JSON: ${(e as Error).message}`);
  }
  if (!Array.isArray(parsed.pages)) throw new Error("Revision plan has no pages.");

  const byId = new Map(existing.map((p) => [p.id, p]));
  const validIds = new Set(existing.map((p) => p.id));
  const ops = new Set(["keep", "revise", "retarget", "add"]);

  const seen = new Set<number>();
  const pages: PlanPage[] = [];
  for (const entry of parsed.pages) {
    const p = entry as Partial<PlanPage>;
    let op = ops.has(p.op as string) ? (p.op as PlanPage["op"]) : "keep";
    // Plan-only edits the outline, never prose: a "revise" (prose-fix, no objective change) has no
    // place here, so collapse it to a no-op "keep". rebuild hints are dropped below.
    if (planOnly && op === "revise") op = "keep";
    if (op === "add") {
      if (typeof p.title !== "string" || !p.title.trim()) continue;
      pages.push({
        ref: null,
        op: "add",
        pageType: p.pageType === "section" ? "section" : "text",
        title: p.title.trim(),
        objective: (p.objective ?? "").trim(),
        why: typeof p.why === "string" ? p.why.trim() : "",
      });
      continue;
    }
    // existing-page op: must reference a real, not-yet-seen id
    const ref = typeof p.ref === "number" ? p.ref : null;
    if (ref == null || !validIds.has(ref) || seen.has(ref)) continue;
    seen.add(ref);
    const cur = byId.get(ref)!;
    pages.push({
      ref,
      op,
      pageType: cur.page_type === "section" ? "section" : "text",
      title: typeof p.title === "string" && p.title.trim() ? p.title.trim() : (cur.title ?? ""),
      objective: (p.objective ?? cur.metadata?.objective ?? "").trim(),
      rebuild: planOnly ? undefined : p.rebuild === "rewrite" ? "rewrite" : p.rebuild === "revise" ? "revise" : undefined,
      why: typeof p.why === "string" ? p.why.trim() : "",
    });
  }

  // Deletes: only real ids, not already carried.
  const deletes: { ref: number; why?: string }[] = [];
  const deletedIds = new Set<number>();
  for (const d of Array.isArray(parsed.deletes) ? parsed.deletes : []) {
    const ref = typeof (d as { ref?: number }).ref === "number" ? (d as { ref: number }).ref : null;
    if (ref == null || !validIds.has(ref) || seen.has(ref) || deletedIds.has(ref)) continue;
    deletedIds.add(ref);
    deletes.push({ ref, why: typeof (d as { why?: string }).why === "string" ? (d as { why: string }).why.trim() : "" });
  }

  // Guardrail: any existing page neither carried nor deleted is appended as keep.
  for (const p of existing) {
    if (!seen.has(p.id) && !deletedIds.has(p.id)) {
      pages.push({
        ref: p.id,
        op: "keep",
        pageType: p.page_type === "section" ? "section" : "text",
        title: p.title ?? "",
        objective: (p.metadata?.objective ?? "").trim(),
        why: "",
      });
    }
  }

  return { summary: String(parsed.summary ?? "").trim(), pages, deletes, planOnly: planOnly || undefined };
}
