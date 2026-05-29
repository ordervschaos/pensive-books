// replan-from-notes — the "book doctor" (v2 / structural revision step 1).
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
  metadata: { objective?: string } | null;
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

    const { bookId, evaluation, instruction } = (await req.json().catch(() => ({}))) as {
      bookId?: number;
      evaluation?: EvalResult;
      instruction?: string;
    };
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

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);

    const plan = await callClaude(
      apiKey,
      book.name,
      book.brief as Brief | null,
      (book.bible as { text?: string } | null)?.text?.trim() || null,
      pages as PageRow[],
      hasEval ? evaluation! : null,
      instr || null
    );
    return json(plan);
  } catch (e) {
    console.error("replan-from-notes error:", e);
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

Output JSON ONLY (no prose, no fences), exactly:
{
  "summary": "<2-3 sentences: what this revision changes and why>",
  "pages": [
    { "ref": <id|null>, "op": "keep|revise|retarget|add", "pageType": "section|text", "title": "...", "objective": "...", "rebuild": "rewrite|revise", "why": "<one line tied to the evaluation>" }
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

// Current book as an id-tagged outline the model edits against.
function outlineContext(pages: PageRow[]): string {
  return pages
    .map((p) => {
      const obj = p.metadata?.objective?.trim();
      if (p.page_type === "section") return `[id=${p.id}] # ${p.title || "(untitled section)"}${obj ? ` — ${obj}` : ""}`;
      return `[id=${p.id}] - "${p.title || "(untitled)"}"${obj ? ` — ${obj}` : ""}`;
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
}

async function callClaude(
  apiKey: string,
  bookName: string,
  brief: Brief | null,
  bible: string | null,
  pages: PageRow[],
  evaluation: EvalResult | null,
  instruction: string | null
): Promise<RevisionPlan> {
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
            `BOOK: ${bookName}\n\nBRIEF (the voice contract):\n${briefContext(brief)}` +
            (bible ? `\n\nBOOK BIBLE (established facts):\n${bible}` : "") +
            `\n\nCURRENT OUTLINE (edit against these real ids):\n${outlineContext(pages)}` +
            (instruction ? `\n\nAUTHOR'S INSTRUCTION (primary directive):\n${instruction}` : "") +
            (evaluation ? `\n\nEDITOR'S EVALUATION:\n${evalContext(evaluation)}` : "") +
            `\n\nProduce the revision plan. JSON only.`,
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
  return parsePlan(text, pages);
}

// Parse + sanitize the model's plan, enforcing the safety guardrails:
//  - only real ids; coerce shapes; default unknown ops to "keep".
//  - every existing page must be carried (in pages[]) or deleted — any the model omitted
//    are appended as "keep" so a page is NEVER silently dropped.
//  - de-duplicate refs (first wins).
function parsePlan(text: string, existing: PageRow[]): RevisionPlan {
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
    const op = ops.has(p.op as string) ? (p.op as PlanPage["op"]) : "keep";
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
      rebuild: p.rebuild === "rewrite" ? "rewrite" : p.rebuild === "revise" ? "revise" : undefined,
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

  return { summary: String(parsed.summary ?? "").trim(), pages, deletes };
}
