// revise-beats — the beat-sheet doctor. Instruction and/or a knowledge-base LENS → a reviewable
// revision plan that restructures the book AT THE BEAT LAYER. Parallel to revise-outline, but:
//   - it reasons in BEATS (each page carries its objective AND its beat), not objectives alone;
//   - it can be driven by a structural lens (Save the Cat / Story Circle / …), not just an eval;
//   - it is always PLAN-ONLY — it never proposes prose. Applied by build-revision (plan_only), which
//     writes the new beats/objectives/structure and leaves downstream prose to go stale.
//
//   client → POST { bookId, instruction?, lens? } → verify edit access → Claude → RevisionPlan(+beat)
//
// NOTHING is mutated here — the plan is RETURNED for the author to review (the high-value gate), then
// the client opens a book_revisions row (source:'beats', plan_only) and kicks build-revision.
// Needs the ANTHROPIC_API_KEY secret.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { type Brief, briefContext } from "../_shared/brief.ts";
import { corsHeaders, json } from "../_shared/cors.ts";
import { callLLM as callLLMApi, textFromLLM } from "../_shared/llm.ts";
import { getActiveModels } from "../_shared/model-config.ts";
import { extractJsonBlock } from "../_shared/json.ts";
import { sanitizePlan, type RevisionPlan } from "../_shared/revision-plan.ts";
import { settledContext, type Foundations } from "../_shared/foundations-core.ts";
import { lensBlock } from "../_shared/lens.ts";

interface PageRow {
  id: number;
  page_index: number;
  page_type: string | null;
  title: string | null;
  metadata: { objective?: string; beat?: string } | null;
}
interface ThreadLite {
  id: number; name: string; status: string; setup_page_id: number | null; payoff_page_id: number | null;
}

const SYSTEM = `You are a book doctor revising a book's BEAT SHEET — the ordered spine of beats that decides whether the story actually works. Beats are the load-bearing layer: they determine whether the outline (and even the premise) holds. Prose is replaceable and is NOT your concern here.

You work in two coupled layers per page:
- OBJECTIVE — what the page must achieve (its contract).
- BEAT — the concrete dramatic unit that fulfills it (what happens, to whom, the turn/change).

You are given: the brief, the spine, the settled FOUNDATIONS (argument, ending, cast with want/wound/lie, tentpoles), the CURRENT BEAT SHEET (each page with its real [id], type, title, objective, beat), any tracked threads, the author's INSTRUCTION, and — optionally — a STRUCTURAL LENS to diagnose against.

Diagnose what the beat sheet needs and produce a REVISION PLAN: the book's NEW page list in final reading order, plus existing pages to delete. You may:
- rewrite a beat (keep the page; supply a stronger "beat"),
- retarget an objective (op "retarget"; supply the new "objective" AND a "beat" that fulfills it),
- ADD a page (op "add") — including a CHARACTER-INTRODUCTION beat where a character currently appears with no proper introduction, or a missing structural beat (a real midpoint, an escalation, a payoff),
- DELETE a page (list it in "deletes") — cut redundant, inert, or pace-killing beats,
- REORDER — place entries in the desired final order (this is how you fix pacing/sequence),
- mark a section "add"/"delete" to add or remove a CHAPTER/part.

Rules:
- Use ONLY the real [id]s given. Every existing page MUST appear in "pages" (with its ref) or in "deletes" — never drop a page silently.
- "section" pages are chapter/part dividers; "text" pages carry a beat. Give every text page an objective AND a beat.
- Be SURGICAL. Mark "keep" (carry title/objective/beat forward) for beats that already work; change only what the instruction/lens demands. Do not rewrite the whole sheet unless asked.
- The BRIEF, SPINE, and pinned FOUNDATIONS win over any lens. A lens is a diagnostic frame to find what's MISSING or SAGGING — never a template to force the book into. Respect pinned cast lines and the settled ending.
- TRACKED THREADS are promises the book must keep: do NOT delete or move a page that sets up or pays off an open thread without relocating that beat — never orphan a setup or its payoff.
- This is PLAN-ONLY: never write prose, never use a "revise" op, never set "rebuild".
- Note PACE in each changed entry's "why" (e.g. "the middle sags — cut to the turn", "introduce Mara before she acts").

Output JSON ONLY (no prose, no fences), exactly:
{
  "summary": "<2-3 sentences: what this beat revision changes and why>",
  "pages": [
    { "ref": <id|null>, "op": "keep|retarget|add", "pageType": "section|text", "title": "...", "objective": "...", "beat": "...", "why": "<one line: the structural/pace reason>" }
  ],
  "deletes": [ { "ref": <id>, "why": "..." } ]
}`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } },
    );
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: "Unauthorized" }, 401);

    const { bookId, instruction, lens } = (await req.json().catch(() => ({}))) as {
      bookId?: number; instruction?: string; lens?: string;
    };
    if (!bookId) return json({ error: "bookId is required" }, 400);
    const instr = (instruction ?? "").trim();
    const lensId = (lens ?? "").trim() || null;
    if (!instr && !lensId) return json({ error: "An instruction or a structural lens is required" }, 400);

    const { data: book, error: bookError } = await userClient
      .from("books").select("id, name, brief, spine, foundations, owner_id").eq("id", bookId).single();
    if (bookError || !book) return json({ error: "Book not found" }, 404);

    const { data: access } = await userClient
      .from("book_access").select("id").eq("book_id", bookId).eq("user_id", user.id).eq("status", "accepted").maybeSingle();
    if (book.owner_id !== user.id && !access) return json({ error: "Access denied" }, 403);

    const { data: pages, error: pagesError } = await userClient
      .from("pages").select("id, page_index, page_type, title, metadata")
      .eq("book_id", bookId).eq("archived", false).order("page_index", { ascending: true });
    if (pagesError) throw new Error(`fetch pages: ${pagesError.message}`);
    if (!pages || pages.length === 0) return json({ error: "Book has no pages to revise" }, 400);

    const { data: threads } = await userClient
      .from("book_threads").select("id, name, status, setup_page_id, payoff_page_id")
      .eq("book_id", bookId).neq("status", "closed");

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);

    const plan = await callLLM(
      apiKey, book.name, book.brief as Brief | null,
      (book.spine as { text?: string } | null)?.text ?? null,
      (book.foundations as Foundations | null) ?? null,
      pages as PageRow[], (threads as ThreadLite[] | null) ?? [],
      instr || null, lensId, bookId, user.id,
    );
    return json(plan);
  } catch (e) {
    console.error("revise-beats error:", e);
    return json({ error: String((e as Error)?.message ?? e).slice(0, 500) }, 500);
  }
});

// The current beat sheet as an id-tagged document the model edits against.
function beatSheetContext(pages: PageRow[]): string {
  return pages
    .map((p) => {
      if (p.page_type === "section") return `[id=${p.id}] # ${p.title || "(untitled section)"}`;
      const obj = p.metadata?.objective?.trim();
      const beat = p.metadata?.beat?.trim();
      let line = `[id=${p.id}] - "${p.title || "(untitled)"}"`;
      if (obj) line += `\n  objective: ${obj}`;
      line += beat ? `\n  beat: ${beat}` : `\n  beat: (none yet)`;
      return line;
    })
    .join("\n");
}

function threadsContext(threads: ThreadLite[]): string {
  return threads
    .map((t) => {
      const setup = t.setup_page_id != null ? ` setup@page ${t.setup_page_id}` : "";
      const payoff = t.payoff_page_id != null ? ` payoff@page ${t.payoff_page_id}` : "";
      return `- "${t.name}" (${t.status})${setup}${payoff}`;
    })
    .join("\n");
}

async function callLLM(
  apiKey: string, bookName: string, brief: Brief | null, spineText: string | null,
  foundations: Foundations | null, pages: PageRow[], threads: ThreadLite[],
  instruction: string | null, lensId: string | null, bookId: number, userId: string,
): Promise<RevisionPlan> {
  const { high: model } = await getActiveModels();
  const settled = foundations ? settledContext(foundations).trim() : "";
  const lens = lensBlock(lensId);
  const data = await callLLMApi(apiKey, {
    model,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content:
          `BOOK: ${bookName}\n\nBRIEF (the voice contract):\n${briefContext(brief, { scope: "full", success: true, none: "(no brief set — infer a sensible neutral voice)", empty: "(brief is empty — infer a sensible neutral voice)" })}` +
          (spineText?.trim() ? `\n\nSPINE (the book in one arc):\n${spineText.trim()}` : "") +
          (settled ? `\n\nFOUNDATIONS (settled — pinned lines are immutable):\n${settled}` : "") +
          `\n\nCURRENT BEAT SHEET (edit against these real ids):\n${beatSheetContext(pages)}` +
          (threads.length ? `\n\nTRACKED THREADS (keep their setups & payoffs intact):\n${threadsContext(threads)}` : "") +
          (instruction ? `\n\nAUTHOR'S INSTRUCTION (primary directive):\n${instruction}` : "") +
          (lens ? `\n\n${lens}` : "") +
          `\n\nProduce the beat revision plan. JSON only.`,
      },
    ],
  }, { fn: "revise-beats", bookId, userId });

  const text = textFromLLM(data).trim();
  if (!text) throw new Error("Claude returned no text content.");
  let parsed: Partial<RevisionPlan>;
  try {
    parsed = JSON.parse(extractJsonBlock(text));
  } catch (e) {
    throw new Error(`Could not parse revision plan JSON: ${(e as Error).message}`);
  }
  // plan_only: the beat sheet is never a prose rewrite.
  return sanitizePlan(parsed, pages, true);
}
