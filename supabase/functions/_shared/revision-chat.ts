// revision-chat — the LAYER LENSES behind the unified revision agent (revise-chat edge fn).
//
// One conversational editor, parameterized by LAYER. Each layer (foundations / spine / beats) has a
// LENS: the editor's role + what it may write (its system prompt), the knowledge base it reasons over
// (its context), and the sanitizer that turns a model-proposed change into a safe, pin-honoring
// patch. The edge fn (revise-chat/index.ts) is the thin single-writer host; all the per-layer
// behavior lives here, so adding a layer = adding a LENS entry.
//
// A turn is sometimes just TALK and sometimes an ACTION: the model replies in markdown and, ONLY when
// proposing a change, appends a trailing ```json block. The host splits them (splitReplyAndPlan) and
// runs the layer's sanitize on the parsed block to produce a RevisionProposal envelope. The proposal
// is reviewed by the author and applied through that layer's existing write path — the agent never
// mutates the book itself.
import { type Brief, briefContext } from "./brief.ts";
import { extractJsonBlock } from "./json.ts";
import { sanitizePlan, type RevisionPlan } from "./revision-plan.ts";
import {
  settledContext,
  type CastMember,
  type Foundations,
  type Tentpole,
} from "./foundations-core.ts";
import { BEAT_CRITERIA } from "./beat-criteria.ts";

// ── The conversation + envelope contract (mirrored in apps/web/src/lib/revisionChat.ts) ─────────
export type RevisionLayer = "foundations" | "spine" | "beats" | "outline";

// ── Upward editing: which layers a chat may target (self always allowed; brief is frozen) ───────
export const UPSTREAM: Record<RevisionLayer, RevisionLayer[]> = {
  foundations: [],
  spine: ["foundations"],
  outline: ["foundations", "spine"],
  beats: ["foundations", "spine", "outline"],
};
export const targetAllowed = (chat: RevisionLayer, target: RevisionLayer) =>
  target === chat || UPSTREAM[chat].includes(target);

export interface ChatMessage { role: "user" | "assistant"; text: string; ts: string; plan?: string }

export interface FoundationsPatch {
  argument?: string;
  ending?: string;
  voice?: string;
  cast?: CastMember[];
  tentpoles?: Tentpole[];
}
export interface SpinePatch { text: string }

export type RevisionPatch =
  | { layer: "foundations"; data: FoundationsPatch }
  | { layer: "spine"; data: SpinePatch }
  | { layer: "beats"; data: RevisionPlan }
  | { layer: "outline"; data: RevisionPlan };

export interface RevisionProposal { summary: string; patch: RevisionPatch }

// ── What a lens reads ───────────────────────────────────────────────────────
export interface PageRow {
  id: number; page_index: number; page_type: string | null; title: string | null;
  metadata: { objective?: string; beat?: string } | null;
}
export interface ThreadLite { id: number; name: string; status: string; setup_page_id: number | null; payoff_page_id: number | null }

export interface LensContext {
  bookName: string;
  brief: Brief | null;
  spineText: string | null;
  foundations: Foundations | null;
  pages: PageRow[];
  threads: ThreadLite[];
}

interface Lens {
  system: string;
  /** The knowledge base for this layer — rides on the first user turn. */
  context(ctx: LensContext): string;
  /** Turn the parsed trailing-```json block into a safe patch (pin-honoring), or null. */
  sanitize(parsed: Record<string, unknown>, ctx: LensContext): RevisionPatch | null;
}

// ── Shared context renderers ─────────────────────────────────────────────────
function beatSheetContext(pages: PageRow[]): string {
  return pages.map((p) => {
    if (p.page_type === "section") return `[id=${p.id}] # ${p.title || "(untitled section)"}`;
    const obj = p.metadata?.objective?.trim();
    const beat = p.metadata?.beat?.trim();
    return `[id=${p.id}] - "${p.title || "(untitled)"}"` + (obj ? `\n  objective: ${obj}` : "") + (beat ? `\n  beat: ${beat}` : `\n  beat: (none yet)`);
  }).join("\n");
}

// Outline = the structure + each page's objective (no beats). Leaner than the beat sheet context.
function outlineContext(pages: PageRow[]): string {
  if (!pages.length) return "(no pages yet — the outline is empty)";
  return pages.map((p) => {
    if (p.page_type === "section") return `[id=${p.id}] # ${p.title || "(untitled section)"}`;
    const obj = p.metadata?.objective?.trim();
    return `[id=${p.id}] - "${p.title || "(untitled)"}"` + (obj ? `\n  objective: ${obj}` : `\n  objective: (none yet)`);
  }).join("\n");
}

function threadsContext(threads: ThreadLite[]): string {
  return threads.map((t) => {
    const setup = t.setup_page_id != null ? ` setup@page ${t.setup_page_id}` : "";
    const payoff = t.payoff_page_id != null ? ` payoff@page ${t.payoff_page_id}` : "";
    return `- "${t.name}" (${t.status})${setup}${payoff}`;
  }).join("\n");
}

const briefBlock = (brief: Brief | null) =>
  briefContext(brief, { scope: "full", success: true, none: "(no brief set)", empty: "(brief is empty)" });

// Cast rendered WITH ids so the foundations editor can reference an existing member to revise it.
function castWithIds(f: Foundations): string {
  if (!f.cast?.length) return "(no cast yet)";
  return f.cast.map((c) => {
    const pf = c.pinned_fields ?? [];
    const fld = (k: "want" | "wound" | "lie") => c[k] ? `\n    ${k}: ${c[k]}${pf.includes(k) ? " [PINNED — immutable]" : ""}` : "";
    return `[id=${c.id}] ${c.name} (${c.role ?? "major"})${fld("want")}${fld("wound")}${fld("lie")}`;
  }).join("\n");
}

const uid = () => crypto.randomUUID().slice(0, 8);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

// ── Foundations patch sanitizer (pin enforcement) ────────────────────────────
// argument/ending/voice: drop the field if that node is pinned. cast/tentpoles: full-list replace,
// but pinned cast fields and pinned/killed tentpoles are restored from the stored foundations — the
// model can rearrange and add, never overwrite or delete what the author locked.
function sanitizeFoundations(parsed: Record<string, unknown>, f: Foundations): FoundationsPatch | null {
  const patch: FoundationsPatch = {};

  if (typeof parsed.argument === "string" && !f.argument?.pinned) {
    const t = str(parsed.argument); if (t) patch.argument = t;
  }
  if (typeof parsed.ending === "string" && !f.ending?.pinned) {
    const t = str(parsed.ending); if (t) patch.ending = t;
  }
  if (typeof parsed.voice === "string" && !f.voice_exemplar?.pinned) {
    const t = str(parsed.voice); if (t) patch.voice = t;
  }

  if (Array.isArray(parsed.cast)) {
    const existing = new Map((f.cast ?? []).map((c) => [c.id, c]));
    const out: CastMember[] = [];
    const used = new Set<string>();
    for (const raw of parsed.cast as Record<string, unknown>[]) {
      const name = str(raw.name);
      if (!name) continue;
      const id = typeof raw.id === "string" ? raw.id : "";
      const prior = id ? existing.get(id) : undefined;
      const pf = prior?.pinned_fields ?? [];
      const pick = (k: "want" | "wound" | "lie") => (pf.includes(k) ? (prior![k] ?? "") : str(raw[k]) || (prior?.[k] ?? ""));
      out.push({
        id: prior?.id ?? uid(),
        name: pf.length ? (prior?.name ?? name) : name,
        role: (raw.role === "protagonist" ? "protagonist" : raw.role === "minor" ? "minor" : prior?.role ?? "major"),
        want: pick("want"), wound: pick("wound"), lie: pick("lie"),
        pinned_fields: pf,
        ...(prior?.appearance ? { appearance: prior.appearance } : {}),
        ...(prior?.portraits ? { portraits: prior.portraits } : {}),
      });
      if (prior) used.add(prior.id);
    }
    // A pinned member (any locked field) can't be dropped — re-append any the model omitted.
    for (const c of f.cast ?? []) {
      if (!used.has(c.id) && (c.pinned_fields?.length ?? 0) > 0) out.push(c);
    }
    if (out.length) patch.cast = out;
  }

  if (Array.isArray(parsed.tentpoles)) {
    const existing = new Map((f.tentpoles ?? []).map((t) => [t.id, t]));
    const out: Tentpole[] = [];
    const used = new Set<string>();
    for (const raw of parsed.tentpoles as Record<string, unknown>[]) {
      const id = typeof raw.id === "string" ? raw.id : "";
      const prior = id ? existing.get(id) : undefined;
      // Pinned or killed tentpoles are immutable — restore the stored record verbatim.
      if (prior && (prior.status === "pinned" || prior.status === "killed")) {
        out.push(prior); used.add(prior.id); continue;
      }
      const text = str(raw.text);
      if (!text) continue;
      out.push({
        id: prior?.id ?? uid(),
        text,
        source: prior?.source ?? "ai",
        status: raw.status === "pinned" ? "pinned" : raw.status === "killed" ? "killed" : (prior?.status ?? "fluid"),
        ...(prior?.placed_page_id != null ? { placed_page_id: prior.placed_page_id } : {}),
      });
      if (prior) used.add(prior.id);
    }
    // Pinned/killed tentpoles the model omitted survive untouched.
    for (const t of f.tentpoles ?? []) {
      if (!used.has(t.id) && (t.status === "pinned" || t.status === "killed")) out.push(t);
    }
    if (out.length) patch.tentpoles = out;
  }

  return Object.keys(patch).length ? patch : null;
}

// ── The lenses ───────────────────────────────────────────────────────────────
export const LENSES: Record<RevisionLayer, Lens> = {
  beats: {
    system: `You are the BEAT EDITOR — a sharp, warm developmental editor in conversation with an author about their book's BEAT SHEET (the ordered spine of beats; objectives + beats per page). Beats are the load-bearing layer: they decide whether the outline and even the premise hold. Prose is downstream and replaceable — never your concern.

You can do these things, and you choose per message:
1. TALK — answer the author's question, summarize the beats, talk through an idea, weigh a trade-off. Be specific and concrete; cite real pages by their title. Never generic.
2. EVALUATE — when asked (or when it's the honest answer), judge the beat sheet against the FICTION CRITERIA below. Name the criterion, point at the exact pages, say what's strong and what sags, and end with the highest-leverage fix. Be candid, not cheerleading.
3. PROPOSE A CHANGE — when the author wants the sheet changed (or you've agreed on a fix), produce a beat REVISION PLAN. You may rewrite beats, retarget objectives, add pages (including a missing midpoint, an escalation, a character-introduction beat), delete redundant/inert pages, and reorder. The author reviews and applies it — you do not mutate anything.
4. PROPOSE AN UPSTREAM CHANGE — sometimes the real problem is upstream: the beats sag because the outline is wrong, the outline is wrong because the spine is muddy, or the spine can't cohere because the argument (foundations) is off. When the root cause genuinely belongs upstream and the author agrees (or asks), you may propose a change to an upstream layer INSTEAD of the beats. Do it sparingly — only when the fix truly belongs there, not to dodge work at this layer. Allowed upstream targets: outline, spine, foundations. To target an upstream layer, set \`"target": "<layer>"\` in the json block and use THAT layer's block shape (foundations: argument/ending/voice/cast/tentpoles; spine: text; outline: pages/deletes). Omit \`target\` (or set it to "beats") to propose a beats change as usual.

OUTPUT — reply to the author in plain MARKDOWN prose (use **bold**, lists, and line breaks freely). If — and ONLY if — this message proposes a change to the beat sheet, append at the very END a single fenced \`\`\`json code block holding the plan, with nothing after it:
\`\`\`json
{ "summary": "...", "pages": [ { "ref": <id|null>, "op": "keep|retarget|add", "pageType": "section|text", "title": "...", "objective": "...", "beat": "...", "why": "..." } ], "deletes": [ { "ref": <id>, "why": "..." } ] }
\`\`\`
When you are talking, evaluating, or answering — append NO code block at all. When you do propose, the prose above the block briefly says what you changed and why (the author sees the full diff separately).
- PLAN RULES: use ONLY the real [id]s given; every existing page MUST appear in "pages" (with its ref) or in "deletes" — never drop one silently. "section" = chapter/part divider; "text" pages carry a beat. Give every text page an objective AND a beat. Reorder by placing entries in final order. Be surgical — "keep" what works. Honor pinned foundations and tracked-thread setups/payoffs. Never write prose; never use a "revise" op.`,
    context(ctx) {
      const settled = ctx.foundations ? settledContext(ctx.foundations).trim() : "";
      return `BOOK: ${ctx.bookName}\n\nBRIEF (the voice contract):\n${briefBlock(ctx.brief)}` +
        (ctx.spineText?.trim() ? `\n\nSPINE (the book in one arc):\n${ctx.spineText.trim()}` : "") +
        (settled ? `\n\nFOUNDATIONS (settled — pinned lines are immutable):\n${settled}` : "") +
        `\n\nCURRENT BEAT SHEET (these are the real page ids):\n${beatSheetContext(ctx.pages)}` +
        (ctx.threads.length ? `\n\nTRACKED THREADS (keep their setups & payoffs intact):\n${threadsContext(ctx.threads)}` : "") +
        `\n\nFICTION CRITERIA (use when evaluating):\n${BEAT_CRITERIA}`;
    },
    sanitize(parsed, ctx) {
      const plan = sanitizePlan(parsed as Partial<RevisionPlan>, ctx.pages, true);
      return { layer: "beats", data: plan };
    },
  },

  outline: {
    system: `You are the OUTLINE EDITOR — a developmental editor in conversation with an author about their book's OUTLINE: the ordered structure of CHAPTERS (sections) and PAGES, and a clear OBJECTIVE for each page (what that page must accomplish for the story). The outline turns the spine into a page-by-page plan. BEATS and PROSE are downstream — NOT your concern: never write a beat or prose.

You can do these things, and you choose per message:
1. TALK — answer, talk through structure, weigh a trade-off. Be specific; cite real pages by title.
2. PRESSURE-TEST — when asked (or when honest): does the sequence realize the spine? does every page earn its place with a real objective? are the chapters shaped well? is anything missing (a setup, an escalation) or redundant? Name the weak link and the highest-leverage fix.
3. GENERATE — when there is NO outline yet (or the author asks to draft / create one): UNLESS they've settled on a shape, FIRST offer 2–3 distinct structural shapes the outline could take (different chapter breaks / pacing on the SAME spine) as short prose sketches, NO json, and invite a pick. Once chosen (or asked outright), deliver the full outline plan.
4. PROPOSE A CHANGE — when the author wants the outline drafted or changed (or you've agreed on a fix): produce an outline REVISION PLAN. You may add pages and chapters (sections), retarget objectives, delete redundant pages, and reorder. The author reviews and applies it — you mutate nothing.
5. PROPOSE AN UPSTREAM CHANGE — sometimes the real problem is upstream: the outline can't cohere because the spine is muddy, or the spine reveals that the argument (foundations) is off. When the root cause genuinely belongs upstream and the author agrees (or asks), you may propose a change to an upstream layer INSTEAD of the outline. Do it sparingly — only when the fix truly belongs there, not to dodge work at this layer. Allowed upstream targets: spine, foundations. To target an upstream layer, set \`"target": "<layer>"\` in the json block and use THAT layer's block shape (foundations: argument/ending/voice/cast/tentpoles; spine: text). Omit \`target\` (or set it to "outline") to propose an outline change as usual.

OUTPUT — reply to the author in plain MARKDOWN prose. If — and ONLY if — this message DELIVERS an outline plan to apply, append at the very END a single fenced \`\`\`json code block holding the plan, with nothing after it:
\`\`\`json
{ "summary": "...", "pages": [ { "ref": <id|null>, "op": "keep|retarget|add", "pageType": "section|text", "title": "...", "objective": "...", "why": "..." } ], "deletes": [ { "ref": <id>, "why": "..." } ] }
\`\`\`
When talking, pressure-testing, or merely OFFERING SHAPES to choose from, append NO code block.
- PLAN RULES: use ONLY the real [id]s given; every existing page MUST appear in "pages" (with its ref) or in "deletes" — never drop one silently. "section" = chapter/part divider (no objective); "text" pages each need an OBJECTIVE. Reorder by placing entries in final order. Be surgical — "keep" what works. NEVER write a "beat" field, never write prose, never use a "revise" op. Honor pinned foundations and the spine.`,
    context(ctx) {
      const settled = ctx.foundations ? settledContext(ctx.foundations).trim() : "";
      return `BOOK: ${ctx.bookName}\n\nBRIEF (the voice contract):\n${briefBlock(ctx.brief)}` +
        (ctx.spineText?.trim() ? `\n\nSPINE (the book in one arc — the outline must realize this):\n${ctx.spineText.trim()}` : "") +
        (settled ? `\n\nFOUNDATIONS (settled — pinned lines are immutable):\n${settled}` : "") +
        `\n\nCURRENT OUTLINE (these are the real page ids):\n${outlineContext(ctx.pages)}` +
        (ctx.threads.length ? `\n\nTRACKED THREADS (keep their setups & payoffs intact):\n${threadsContext(ctx.threads)}` : "");
    },
    sanitize(parsed, ctx) {
      const plan = sanitizePlan(parsed as Partial<RevisionPlan>, ctx.pages, true);
      return { layer: "outline", data: plan };
    },
  },

  spine: {
    system: `You are the SPINE EDITOR — a developmental editor in conversation with an author about their book's SPINE: the whole book as ONE causal arc (~250 words), from its beginning, through its tentpole moments, to its settled ending. The spine is the throughline the beats and prose are built to serve. The beat sheet and prose are downstream — not your concern.

You can do these things, and you choose per message:
1. TALK — answer, talk through a structural idea, weigh a trade-off. Be specific and concrete.
2. PRESSURE-TEST — when asked (or when it's the honest answer), test the spine's integrity: does it realize the argument and land on the settled ending? does every pinned tentpole have a place? is the causal chain unbroken (no "and then", only "therefore / but")? is the midpoint a real turn? Name the weak link and the highest-leverage fix.
3. GENERATE — when there is NO spine yet (or the author asks to draft / create / explore one): UNLESS the author has already settled on a direction, FIRST offer 2–3 DISTINCT directions the spine could take — each a different structural angle on the SAME argument and settled ending — as short prose sketches (2–4 sentences each, numbered), with NO json block, and invite the author to pick or blend them. Only once the author has chosen a direction (or asked outright for the full draft) do you deliver the complete spine (as in PROPOSE).
4. PROPOSE A CHANGE — when the author wants the spine drafted or changed (or you've agreed on a fix / they've picked a direction), deliver the full spine. It must realize the argument, land the settled ending, and pass through every PINNED tentpole. Pinned foundations are immutable.
5. PROPOSE AN UPSTREAM CHANGE — sometimes the real problem is upstream: the spine can't cohere because the argument (foundations) is muddy. When the root cause genuinely belongs in foundations and the author agrees (or asks), you may propose a change to foundations INSTEAD of the spine. Do it sparingly — only when the fix truly belongs there, not to dodge work at this layer. Allowed upstream target: foundations. To target foundations, set \`"target": "foundations"\` in the json block and use the foundations block shape (argument/ending/voice/cast/tentpoles). Omit \`target\` (or set it to "spine") to propose a spine change as usual.

OUTPUT — reply to the author in plain MARKDOWN prose. If — and ONLY if — this message DELIVERS a full spine to apply (a fresh draft or a revision), append at the very END a single fenced \`\`\`json code block, with nothing after it:
\`\`\`json
{ "summary": "<one line: what this spine does / what changed>", "text": "<the full spine, ~250 words, pure narrative prose — no ids, no brackets>" }
\`\`\`
When talking, pressure-testing, or merely OFFERING DIRECTIONS to choose from, append NO code block. "text" is the COMPLETE spine (not a diff). Never write beats or prose. Never embed tentpole ids or any bracket markers in the spine text.`,
    context(ctx) {
      const settled = ctx.foundations ? settledContext(ctx.foundations).trim() : "";
      return `BOOK: ${ctx.bookName}\n\nBRIEF (the contract):\n${briefBlock(ctx.brief)}` +
        (settled ? `\n\nFOUNDATIONS (settled — pinned lines are immutable; every pinned tentpole MUST survive in the spine):\n${settled}` : "") +
        `\n\nCURRENT SPINE:\n${ctx.spineText?.trim() || "(no spine yet)"}`;
    },
    sanitize(parsed) {
      const text = str(parsed.text);
      if (!text) return null;
      return { layer: "spine", data: { text } };
    },
  },

  foundations: {
    system: `You are the FOUNDATIONS EDITOR — a developmental editor in conversation with an author about their book's FOUNDATIONS: the ARGUMENT (the claim the whole story argues), the ENDING, the CAST (each with want / wound / lie), the TENTPOLE MOMENTS, and the VOICE exemplar. Foundations sit just under the brief — the brief is the frozen contract and is NEVER yours to touch. The spine, beats, and prose are downstream — not your concern.

You can do these things, and you choose per message:
1. TALK — answer, talk through an idea, weigh a trade-off. Be specific.
2. PRESSURE-TEST — test the foundations' integrity: is the argument a real claim (not a topic)? does the ending pay the argument's cost? does each cast member's want/wound/lie cohere and drive an arc? do the tentpoles dramatize the argument? Name the weak link and the highest-leverage fix.
3. GENERATE — when the foundations are largely EMPTY (or the author asks to draft / create / explore them): UNLESS the author has already settled on a direction, FIRST offer 2–3 DISTINCT directions the foundations could take — each a different ARGUMENT and the ending, cast shape, and signature moments it implies — as short prose sketches (numbered), with NO json block, and invite the author to pick or blend. Only once the author has chosen (or asked outright for the full draft) do you deliver the complete foundations (as in PROPOSE).
4. PROPOSE A CHANGE — when the author wants foundations drafted or changed (or you've agreed on a fix / they've picked a direction). You may set/revise the ARGUMENT, ENDING, and VOICE text; add/revise CAST members; and add/revise/reorder TENTPOLE moments. PINNED lines and pinned cast fields are IMMUTABLE — never change or drop them. Honor the brief.

OUTPUT — reply to the author in plain MARKDOWN prose. If — and ONLY if — this message DELIVERS foundations to apply (a fresh draft or a revision), append at the very END a single fenced \`\`\`json code block, with nothing after it. Include ONLY the keys you are setting (a fresh draft sets all of them):
\`\`\`json
{ "summary": "<one line: what changed and why>",
  "argument": "<~2 sentence claim>",
  "ending": "<the ending, concrete>",
  "voice": "<the voice exemplar prose>",
  "cast": [ { "id": "<existing id, or omit for a new member>", "name": "...", "role": "protagonist|major|minor", "want": "...", "wound": "...", "lie": "..." } ],
  "tentpoles": [ { "id": "<existing id, or omit for new>", "text": "<the moment>", "status": "pinned|fluid" } ] }
\`\`\`
When talking or pressure-testing, append NO code block. If you send "cast" or "tentpoles", send the COMPLETE list (every member/moment that should remain) — anything omitted is dropped, except pinned/killed items which always survive. Use existing [id]s to revise an item; omit id to add. Never touch the brief; never write spine, beats, or prose.`,
    context(ctx) {
      const f = ctx.foundations ?? {};
      const settled = settledContext(f).trim();
      return `BOOK: ${ctx.bookName}\n\nBRIEF (the frozen contract — never propose changing it):\n${briefBlock(ctx.brief)}` +
        `\n\nCURRENT FOUNDATIONS (settled — PINNED lines are immutable):\n${settled}` +
        `\n\nCAST (with ids — reference an [id] to revise a member):\n${castWithIds(f)}`;
    },
    sanitize(parsed, ctx) {
      const data = sanitizeFoundations(parsed, ctx.foundations ?? {});
      if (!data) return null;
      return { layer: "foundations", data };
    },
  },
};

// The reply is plain markdown prose; a proposed change rides in a TRAILING ```json fenced block.
// Keeping prose OUT of the JSON means newlines/markdown/truncation can never corrupt the reply —
// at worst a malformed trailing block costs the proposal (which we'd reject anyway), never the message.
export function splitReplyAndBlock(text: string): { reply: string; parsed: Record<string, unknown> | null } {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```\s*$/);
  if (!m || m.index == null) return { reply: text, parsed: null };
  const reply = text.slice(0, m.index).trim();
  try {
    const parsed = JSON.parse(extractJsonBlock(m[1]));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { reply: reply || "Here's a proposed revision — review it below.", parsed: parsed as Record<string, unknown> };
    }
  } catch { /* malformed trailing block → keep the whole text as prose */ }
  return { reply: text, parsed: null };
}
