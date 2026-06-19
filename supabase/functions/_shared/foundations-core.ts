// foundations-core — the pure candidate-generation workers for the Foundations stage and the spine
// routes (pin-driven flow, docs/pinned_method.md §3.2–3.3). No auth, no access check, no row writes —
// callers own those (mirrors options-core.ts / spine-core.ts). The ai-run dispatcher runs these as
// durable rows; the CLIENT applies a chosen candidate into books.foundations / books.spine.
//
// Pin enforcement (§4 rule 2) at this layer:
//   (a) every prompt receives the pinned records in scope, verbatim, as hard constraints;
//   (b) workers never write rows, so they structurally cannot overwrite a pinned record;
//   (c) spineRoutes validates post-hoc that every pinned tentpole appears (and no killed one does)
//       in every route, and retries once on violation.
import { type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { type Brief, briefContext } from "./brief.ts";
import { callClaude, textFromClaude, type CallMeta } from "./claude.ts";
import { extractJsonBlock } from "./json.ts";
import { getActiveModels } from "./model-config.ts";
import { canonContext, type CanonPacket } from "./canon-core.ts";
import { readSteer, steerBlock } from "./steer.ts";

export type FoundationsStep = "argument" | "ending" | "cast" | "tentpoles" | "voice" | "world";

// ── books.foundations shape (the client owns writes; this is the read contract) ─────────────────
export interface FCandidate { id: string; text: string; implied_ending?: string; label?: string }
export interface FNode { text?: string; pinned?: boolean; author_edited_at?: string; candidates?: FCandidate[] }
export interface CastMember {
  id: string; name: string;
  want?: string; wound?: string; lie?: string;
  pinned_fields?: string[];
  role?: "protagonist" | "major" | "minor";
  // Mirror of the web copy (apps/web/src/lib/foundations.ts): the manual-portrait fields. Carried
  // here so a foundations cast patch preserves them instead of dropping them on a full-list replace.
  appearance?: string;
  portraits?: string[];
  // F1: per-character voice + history (story-architecture-extensions.md §F1)
  history?: string;    // formative backstory that colors word choice and interiority
  idiolect?: string;   // how this character speaks — diction, tics, register
  tag?: string;        // trackable physical/gesture marker (cosmetic; excluded from fingerprint)
}
export interface CastProposal { label: string; members: CastMember[]; relationships?: Relationship[] }

// F2: relationship layer — stable dyad definitions (mutable charges live in PageState)
export interface Relationship { id: string; a: string; b: string; bond: string; pinned?: boolean }
// F3a: world/setting foundation node
export interface WorldNode { setting?: string; period?: string; rules?: string[]; pinned?: boolean }
// F4a: narration mode — a stable voice decision (drift-tracked like the voice exemplar). Moved here
// from books.bible so the whole foundations machinery (chat, settledContext, fingerprint) owns it.
export interface Narration { person?: "first" | "close-third" | "omniscient"; tense?: "past" | "present"; distance?: string; pinned?: boolean }
export interface Tentpole {
  id: string; text: string;
  source: "author" | "ai";
  status: "pinned" | "fluid" | "killed";
  placed_page_id?: number;
}
export interface Foundations {
  argument?: FNode;
  ending?: FNode;
  cast?: CastMember[];
  tentpoles?: Tentpole[];
  voice_exemplar?: FNode;
  // The book's "house look" — a single visual-style direction every scene/portrait STYLE line inherits,
  // so illustrations stay coherent across the whole book. `art_theme` is the picked preset KEY (or
  // "custom") for UI highlight only — the edge composers read `art_direction` text. `image_model` is the
  // picked render-model KEY (IMAGE_MODELS in _shared/image.ts). Mirror of apps/web/src/lib/foundations.ts.
  art_direction?: string;
  art_theme?: string;
  image_model?: string;
  // F2: stable relationship definitions (mutable per-page charges live in PageState.relationship_states)
  relationships?: Relationship[];
  // F3a: pinned world/setting node (changes prose → included in fingerprint)
  world?: WorldNode;
  // F4a: narration mode (person/tense/distance) — book-level default for prose generation
  narration?: Narration;
}

export interface SpineRoute { id: string; summary: string; tentpole_order: string[] }



// The already-settled foundations, rendered as hard constraints for downstream steps. Pinned items
// are called out as immovable; selected-but-fluid items are context to stay consistent with.
// Exported: outline generation (spine-to-objectives) reuses it as its constraint block.
export function settledContext(f: Foundations): string {
  const lines: string[] = [];
  const node = (label: string, n?: FNode) => {
    if (n?.text?.trim()) lines.push(`${label}${n.pinned ? " (PINNED by the author — immutable, honor verbatim)" : ""}:\n${n.text.trim()}`);
  };
  node("ARGUMENT (the book's claim)", f.argument);
  node("ENDING", f.ending);
  if (f.cast?.length) {
    const cast = f.cast.map((c) => {
      const pf = c.pinned_fields ?? [];
      const line = (k: "want" | "wound" | "lie") =>
        c[k] ? `  ${k}: ${c[k]}${pf.includes(k) ? " [PINNED]" : ""}` : null;
      const parts = [`- ${c.name} (${c.role ?? "major"})`, line("want"), line("wound"), line("lie")];
      if (c.history) parts.push(`  history: ${c.history}`);
      if (c.idiolect) parts.push(`  idiolect: ${c.idiolect}`);
      if (c.tag) parts.push(`  tag: ${c.tag}`);
      return parts.filter(Boolean).join("\n");
    }).join("\n");
    lines.push(`CAST (pinned lines are immutable):\n${cast}`);
  }
  if (f.relationships?.length) {
    const castMap = new Map((f.cast ?? []).map((c) => [c.id, c.name]));
    const rels = f.relationships.map((r) => {
      const nameA = castMap.get(r.a) ?? r.a;
      const nameB = castMap.get(r.b) ?? r.b;
      return `- ${nameA} ↔ ${nameB}: ${r.bond}${r.pinned ? " [PINNED]" : ""}`;
    }).join("\n");
    lines.push(`RELATIONSHIPS (pinned lines are immutable):\n${rels}`);
  }
  if (f.world && (f.world.setting || f.world.period || (f.world.rules?.length))) {
    const pinSuffix = f.world.pinned ? " [PINNED]" : "";
    const worldLines: string[] = [];
    if (f.world.setting) worldLines.push(`setting: ${f.world.setting}${pinSuffix}`);
    if (f.world.period) worldLines.push(`period: ${f.world.period}${pinSuffix}`);
    if (f.world.rules?.length) {
      f.world.rules.forEach((rule) => worldLines.push(`rule: ${rule}${pinSuffix}`));
    }
    lines.push(`WORLD (pinned lines are immutable):\n${worldLines.join("\n")}`);
  }
  const live = (f.tentpoles ?? []).filter((t) => t.status !== "killed");
  const killed = (f.tentpoles ?? []).filter((t) => t.status === "killed");
  if (live.length) {
    lines.push(`TENTPOLE MOMENTS (id · status · text — pinned ones MUST survive into any structure):\n${
      live.map((t) => `- [${t.id}] (${t.status}) ${t.text}`).join("\n")}`);
  }
  if (killed.length) {
    lines.push(`KILLED DIRECTIONS (the author rejected these — do NOT propose anything like them):\n${
      killed.map((t) => `- ${t.text}`).join("\n")}`);
  }
  node("VOICE EXEMPLAR", f.voice_exemplar);
  if (f.narration && (f.narration.person || f.narration.tense || f.narration.distance)) {
    const n = f.narration;
    const bits = [n.person, n.tense ? `${n.tense} tense` : null, n.distance].filter(Boolean);
    if (bits.length) lines.push(`NARRATION (the book's default narrative mode)${n.pinned ? " [PINNED]" : ""}:\n${bits.join(", ")}`);
  }
  return lines.length ? lines.join("\n\n") : "(nothing settled yet)";
}

// deno-lint-ignore no-explicit-any
const textOf = (data: any): string => textFromClaude(data).trim();

function parseJson<T>(text: string): T {
  return JSON.parse(extractJsonBlock(text)) as T;
}

const uid = () => crypto.randomUUID().slice(0, 8);

// The model is told never to embed tentpole ids in generated prose, but it sometimes still slips a
// `[c3ac881d]` marker into a spine / route summary. Strip any `[8-hex-char]` token (and the space
// that usually precedes it) so saved narrative text is always clean, regardless of model obedience.
export const stripEntityIds = (s: string) => s.replace(/\s?\[[0-9a-f]{8}\]/g, "").replace(/[ \t]{2,}/g, " ");

// ── Per-step prompts ─────────────────────────────────────────────────────────
const STEP_SYSTEM: Record<FoundationsStep, string> = {
  argument: `You are a book architect proposing the book's ARGUMENT — the claim the whole story argues (e.g. "loyalty to a dead man can cost you every living one"). Generate exactly 3 candidates, genuinely different claims pulled from different tensions in the brief. Each: ~2 sentences, plus the ending it implies in one line.

Output JSON ONLY:
{ "candidates": [{ "text": "<~2 sentence claim>", "implied_ending": "<one line>" }, …] }`,

  ending: `You are a book architect proposing ENDINGS consistent with the book's selected argument. Generate exactly 3 candidates — same argument, different final images/costs/resolutions. Each ~2–3 sentences, concrete (who stands where, what it cost), not a synopsis.

Output JSON ONLY:
{ "candidates": [{ "text": "<the ending>" }, …] }`,

  cast: `You are a book architect proposing three complete CAST CONFIGURATIONS for this story. Each configuration stands alone: one protagonist and one or two major characters, each with want (external goal), wound (the unhealed injury driving them), and lie (the false belief the arc will break). Across the three options vary the protagonist's core wound and lie — each should represent a genuinely different human story pulled from different tensions in the brief. The major characters in each option should serve that specific protagonist's arc.

For each character also include:
- history: 1–2 sentence formative backstory that explains how they got their wound/lie
- idiolect: one line describing how they speak — diction, verbal tics, register (e.g. "speaks in short declaratives, never asks questions, drops g's")
- tag: one trackable physical or gesture marker (e.g. "always straightens objects on any surface near her")

For each proposal also include a "relationships" array capturing the key dyads among that proposal's members: { "a": "<member name>", "b": "<member name>", "bond": "<one line describing the relationship charge>" }.

Output JSON ONLY:
{ "proposals": [{ "label": "Option A", "members": [{ "name": "…", "role": "protagonist" | "major", "want": "…", "wound": "…", "lie": "…", "history": "…", "idiolect": "…", "tag": "…" }, …], "relationships": [{ "a": "…", "b": "…", "bond": "…" }, …] }, { "label": "Option B", "members": […], "relationships": […] }, { "label": "Option C", "members": […], "relationships": […] }] }`,

  world: `You are a book architect proposing the WORLD/SETTING for this story — a pinned, concrete artifact that all subsequent prose must stay consistent with. Ground every detail in the brief and the settled foundations; do not invent genre or setting that contradicts them. For non-genre stories, rules can be social, economic, or institutional constraints rather than magic or physics.

Propose exactly one world definition with:
- setting: where (and what kind of place) the story lives — specific enough to paint a picture
- period: when (era, season, moment in history, or "contemporary")
- rules: 3–5 load-bearing constraints of this story-world — the things prose must never contradict (physical laws if genre, social hierarchies, economic realities, institutional rules, etc.)

Output JSON ONLY:
{ "world": { "setting": "…", "period": "…", "rules": ["…", "…", "…"] } }`,

  tentpoles: `You are a book architect proposing TENTPOLE MOMENTS — vivid, concrete scenes the author can already see (1–3 sentences each, a moment not a summary). Generate exactly 6 proposals, spread across the book's whole arc, consistent with the settled argument/ending/cast. Never duplicate an existing tentpole; never resemble a killed direction.

Output JSON ONLY:
{ "candidates": [{ "text": "<the moment>" }, …] }`,

  voice: `You are a prose stylist. Render the given TENTPOLE MOMENT as ~120 words of finished prose in 3 DISTINCT voices — different sentence rhythm, distance, temperature. Label each with a 2–4 word descriptor (e.g. "spare and cold", "lush close-third"). Same moment, three soundscapes.

Output JSON ONLY:
{ "candidates": [{ "label": "<descriptor>", "text": "<~120 words>" }, …] }`,
};

// Sequel cast rule (§8.4): canon lists the cast as the previous book left them; each proposal shows
// where they are NOW, not a copy of who they were.
const CAST_SEQUEL_ADDENDUM = `

THIS BOOK IS A SEQUEL. The CANON block lists the cast as the previous book left them. Each proposal MUST include every canon character by their exact name. Vary across proposals how each character has evolved (different wounds, different lies cracked open by the last book's resolution) — not their identity. You may also add new characters to each option.`;

export interface FoundationsOptionsParams {
  bookId: number;
  step: FoundationsStep;
  /** Optional author-directed prompt, used for tentpoles to steer what kinds of moments to propose. */
  prompt?: string;
  userId?: string | null;
}

// Generate candidates for one Foundations sub-step. Returns step-shaped candidates with server ids.
// Cast is the exception: returns { proposals } (3 complete cast configs) instead of { candidates }.
// World is the exception: returns { world: WorldNode } (single picked node, not a candidates list).
export async function foundationsOptions(
  client: SupabaseClient, apiKey: string, p: FoundationsOptionsParams,
): Promise<{ candidates: FCandidate[] } | { proposals: CastProposal[] } | { candidates: Tentpole[] } | { world: WorldNode }> {
  const { data: book, error } = await client.from("books").select("id, name, brief, foundations, canon, steers").eq("id", p.bookId).single();
  if (error || !book) throw new Error("Book not found");
  const brief = book.brief as Brief | null;
  const f = (book.foundations as Foundations | null) ?? {};
  const canon = (book.canon as CanonPacket | null) ?? null;

  let stepInput = "";
  if (p.step === "ending" && !f.argument?.text?.trim()) throw new Error("Select an argument first.");
  if (p.step === "voice") {
    const t = (f.tentpoles ?? []).filter((x) => x.status !== "killed");
    const moment = t.find((x) => x.status === "pinned") ?? t[0];
    if (!moment) throw new Error("Add at least one tentpole moment first.");
    stepInput = `\n\nTENTPOLE MOMENT TO RENDER:\n${moment.text}`;
  }
  if (p.prompt?.trim()) {
    stepInput += `\n\nAUTHOR'S DIRECTION:\n${p.prompt.trim()}`;
  }

  const { high: model } = await getActiveModels();
  const meta: CallMeta = { fn: `foundations-${p.step}`, bookId: p.bookId, userId: p.userId ?? null };
  const data = await callClaude(apiKey, {
    model,
    max_tokens: 2048,
    temperature: 1,
    system: [{
      type: "text",
      text: STEP_SYSTEM[p.step] + (canon && p.step === "cast" ? CAST_SEQUEL_ADDENDUM : ""),
      cache_control: { type: "ephemeral" },
    }],
    messages: [{
      role: "user",
      content: `BOOK: ${book.name}\n\nBRIEF:\n${briefContext(brief)}` +
        (canon ? `\n\nCANON (settled facts from the previous book — honor, never contradict, never retell):\n${canonContext(canon)}` : "") +
        `\n\nSETTLED FOUNDATIONS SO FAR:\n${settledContext(f)}${stepInput}` +
        steerBlock(readSteer(book.steers, "foundations")) +
        `\n\nGenerate the candidates. JSON only.`,
    }],
  }, meta);

  const text = textOf(data);
  if (!text) throw new Error("Claude returned no candidates.");

  // Cast returns { proposals } — 3 complete cast configs to pick from, not a flat candidates list.
  if (p.step === "cast") {
    const parsed = parseJson<{ proposals?: Array<{ label?: unknown; members?: Array<Record<string, unknown>>; relationships?: Array<Record<string, unknown>> }> }>(text);
    const proposals: CastProposal[] = (parsed.proposals ?? []).map((prop) => {
      const members: CastMember[] = (Array.isArray(prop.members) ? prop.members : []).map((c) => ({
        id: uid(),
        name: String(c.name ?? "").trim(),
        role: (c.role === "protagonist" ? "protagonist" : "major") as CastMember["role"],
        want: String(c.want ?? "").trim(),
        wound: String(c.wound ?? "").trim(),
        lie: String(c.lie ?? "").trim(),
        pinned_fields: [] as string[],
        ...(c.history ? { history: String(c.history).trim() } : {}),
        ...(c.idiolect ? { idiolect: String(c.idiolect).trim() } : {}),
        ...(c.tag ? { tag: String(c.tag).trim() } : {}),
      })).filter((c) => c.name);
      // Map relationship name references → freshly-assigned member ids; drop any that don't resolve.
      const nameToId = new Map(members.map((m) => [m.name.toLowerCase(), m.id]));
      const relationships: Relationship[] = (Array.isArray(prop.relationships) ? prop.relationships : [])
        .map((r) => {
          const aId = nameToId.get(String(r.a ?? "").trim().toLowerCase());
          const bId = nameToId.get(String(r.b ?? "").trim().toLowerCase());
          if (!aId || !bId) return null;
          return { id: uid(), a: aId, b: bId, bond: String(r.bond ?? "").trim() } as Relationship;
        })
        .filter((r): r is Relationship => r !== null && r.bond.length > 0);
      return { label: String(prop.label ?? "").trim() || "Option", members, ...(relationships.length ? { relationships } : {}) };
    }).filter((p) => p.members.length > 0);
    if (proposals.length === 0) throw new Error("Claude returned no cast proposals.");
    return { proposals };
  }

  // World returns a single { world: WorldNode } — the client applies it directly.
  if (p.step === "world") {
    const parsed = parseJson<{ world?: Record<string, unknown> }>(text);
    const w = parsed.world ?? {};
    const world: WorldNode = {
      ...(w.setting ? { setting: String(w.setting).trim() } : {}),
      ...(w.period ? { period: String(w.period).trim() } : {}),
      ...(Array.isArray(w.rules) && w.rules.length ? { rules: w.rules.map((r) => String(r).trim()).filter(Boolean) } : {}),
    };
    if (!world.setting && !world.period && !world.rules?.length) throw new Error("Claude returned an empty world node.");
    return { world };
  }

  const parsed = parseJson<{ candidates?: Array<Record<string, unknown>> }>(text);
  const raw = Array.isArray(parsed.candidates) ? parsed.candidates : [];
  if (raw.length === 0) throw new Error("Claude returned an empty candidate list.");

  if (p.step === "tentpoles") {
    const candidates = raw.map((c) => ({
      id: uid(),
      text: String(c.text ?? "").trim(),
      source: "ai" as const,
      status: "fluid" as const,
    })).filter((c) => c.text);
    return { candidates };
  }
  const candidates = raw.map((c) => ({
    id: uid(),
    text: String(c.text ?? "").trim(),
    ...(c.implied_ending ? { implied_ending: String(c.implied_ending).trim() } : {}),
    ...(c.label ? { label: String(c.label).trim() } : {}),
  })).filter((c) => c.text);
  return { candidates };
}

// ── Spine routes (§3.3) ──────────────────────────────────────────────────────
const ROUTES_SYSTEM = `You are a book architect proposing ROUTES — alternative paths from this book's beginning to its settled ending, through its tentpole moments. A route is ~250 words: the causal road the story takes, not a blurb.

Generate exactly 3 routes. Each must:
- Realize the settled argument and land on the settled ending
- Weave EVERY pinned tentpole moment into the narrative prose — do NOT embed any ids or brackets in the text
- Never include a killed direction
- Differ genuinely from the other routes: different orderings, different connective tissue, different midpoints

Output JSON ONLY:
{ "routes": [{ "summary": "<~250 words pure narrative prose, no ids>", "tentpole_order": ["<tentpole id>", …] }, …] }`;

export interface SpineRoutesParams {
  bookId: number;
  /** Summaries to vary away from (re-route keeps the selected one client-side). */
  avoid?: string[];
  /** Optional per-call author direction (ephemeral chip selection + free note). */
  prompt?: string;
  userId?: string | null;
}

// brief+foundations → 3 candidate routes. Validates pin survival (§4 rule 2c): every pinned tentpole
// in every route's tentpole_order, no killed ones. One retry on violation, then throw.
export async function spineRoutes(client: SupabaseClient, apiKey: string, p: SpineRoutesParams): Promise<SpineRoute[]> {
  const { data: book, error } = await client.from("books").select("id, name, brief, foundations, canon, steers").eq("id", p.bookId).single();
  if (error || !book) throw new Error("Book not found");
  const brief = book.brief as Brief | null;
  const f = (book.foundations as Foundations | null) ?? {};
  const canon = (book.canon as CanonPacket | null) ?? null;
  const pinnedIds = (f.tentpoles ?? []).filter((t) => t.status === "pinned").map((t) => t.id);
  const killedIds = new Set((f.tentpoles ?? []).filter((t) => t.status === "killed").map((t) => t.id));

  const { high: model } = await getActiveModels();
  const meta: CallMeta = { fn: "spine-routes", bookId: p.bookId, userId: p.userId ?? null };
  const userContent =
    `BOOK: ${book.name}\n\nBRIEF:\n${briefContext(brief)}` +
    (canon ? `\n\nCANON (settled facts from the previous book — honor, never contradict, never retell):\n${canonContext(canon)}` : "") +
    `\n\nSETTLED FOUNDATIONS:\n${settledContext(f)}` +
    (p.avoid?.length ? `\n\nEXISTING ROUTES (vary away from these — don't paraphrase them):\n${p.avoid.map((s) => `---\n${s}`).join("\n")}` : "") +
    steerBlock(readSteer(book.steers, "spine")) +
    (p.prompt?.trim() ? `\n\nAUTHOR'S DIRECTION:\n${p.prompt.trim()}` : "") +
    `\n\nGenerate 3 routes. JSON only.`;

  const attempt = async (extra?: string): Promise<SpineRoute[]> => {
    const data = await callClaude(apiKey, {
      model,
      max_tokens: 4096,
      temperature: 1,
      system: [{ type: "text", text: ROUTES_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userContent + (extra ?? "") }],
    }, meta);
    const text = textOf(data);
    if (!text) throw new Error("Claude returned no routes.");
    const parsed = parseJson<{ routes?: Array<{ summary?: string; tentpole_order?: unknown[] }> }>(text);
    return (parsed.routes ?? [])
      .map((r) => ({
        id: uid(),
        summary: stripEntityIds(String(r.summary ?? "")).trim(),
        tentpole_order: (Array.isArray(r.tentpole_order) ? r.tentpole_order : []).map(String),
      }))
      .filter((r) => r.summary);
  };

  const violates = (routes: SpineRoute[]) =>
    routes.length === 0 ||
    routes.some((r) =>
      pinnedIds.some((id) => !r.tentpole_order.includes(id)) ||
      r.tentpole_order.some((id) => killedIds.has(id)));

  let routes = await attempt();
  if (violates(routes)) {
    routes = await attempt(
      `\n\nIMPORTANT: a previous attempt violated the constraints. EVERY route's tentpole_order must contain ALL of these pinned ids: ${JSON.stringify(pinnedIds)} and NONE of these killed ids: ${JSON.stringify([...killedIds])}.`,
    );
    if (violates(routes)) throw new Error("Couldn't generate routes that honor every pinned tentpole — try unpinning or rewording a tentpole.");
  }
  return routes;
}

// ── Tentpole revise ──────────────────────────────────────────────────────────
const TENTPOLE_REVISE_SYSTEM = `You are revising a TENTPOLE MOMENT — a vivid, concrete scene (1–3 sentences) the author has pinned into the book's structure. Apply the author's INSTRUCTION while preserving what already works. This is a targeted revision, not a rewrite from scratch.

Rules:
- Output only the revised moment. No title, no heading, no preamble, no markdown, no meta commentary.
- Keep the same form: a vivid, concrete scene in 1–3 sentences — a moment, not a summary.
- Stay consistent with the book's settled argument, ending, and cast.`;

export interface ReviseTentpoleParams {
  bookId: number;
  current: string;
  instruction: string;
  userId?: string | null;
}

export async function reviseTentpole(
  client: SupabaseClient, apiKey: string, p: ReviseTentpoleParams,
): Promise<string> {
  const cur = (p.current ?? "").trim();
  const instr = (p.instruction ?? "").trim();
  if (!cur) throw new Error("There's nothing to revise yet.");
  if (!instr) throw new Error("An instruction is required.");

  const { data: book, error } = await client.from("books").select("id, name, brief, foundations").eq("id", p.bookId).single();
  if (error || !book) throw new Error("Book not found");
  const f = (book.foundations as Foundations | null) ?? {};

  const { high: model } = await getActiveModels();
  const meta: CallMeta = { fn: "tentpole-revise", bookId: p.bookId, userId: p.userId ?? null };
  const data = await callClaude(apiKey, {
    model,
    max_tokens: 512,
    system: [{ type: "text", text: TENTPOLE_REVISE_SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{
      role: "user",
      content: `BOOK: ${book.name}\n\nSETTLED FOUNDATIONS:\n${settledContext(f)}\n\nCURRENT MOMENT:\n${cur}\n\nAUTHOR'S INSTRUCTION:\n${instr}\n\nReturn the revised moment only.`,
    }],
  }, meta);
  const text = textFromClaude(data).trim();
  if (!text) throw new Error("Claude returned nothing.");
  return text;
}
