// dna-context — the BIBLE BLOCKS: the registry text dna-expand puts in front of the model (cast, threads,
// the arc, tentpoles, world rules, locations, games). Moved out of dna-expand/index.ts (not copied — a
// second copy is the drift this repo keeps paying for) for one reason: it has to be TESTABLE.
//
// The invariant these exist to protect (doc_1785673597000.md §5a). The book_nodes tree is going DENSE —
// every slot the structure template knows about becomes a real row with `content: {}` so the author can
// fill any rung at any time. That turns absence from a SHAPE (no row) into a VALUE (a row that says
// nothing), and absence-as-value FAILS OPEN: every `xs.length ? render : ""` guard in here would flip true
// on placeholders and emit `- [?] {}`. That is not a cosmetic problem —
//   1. it hands a "reference BY NAME" block a row with no name;
//   2. `{}` reads as ASSERTED absence ("this character has no want, no wound"), not as "unknown";
//   3. each block doubles as an implicit format exemplar, so half-empty rows lower the model's fill rate
//      on the FILLED nodes too — the damage spreads past the stubs.
// The fix is upstream (`liveNodes()` at the caller's bindings), and the LOCK is dna-context.test.ts:
// render the bible over a sparse tree and over its dense equivalent, and demand byte-identical output.
//
// Split by kind, because the right treatment differs:
//   • ENTITY registries (cast/threads/world/locations/tentpoles/games) — BY-NAME lookups. A nameless row is
//     strictly worse than no row, so empties are simply absent (the caller filters).
//   • LADDER sequences (the arc) — position is information. Drop the empty acts and a book whose author has
//     only written Act 2 reads as a one-act book. So empties are KEPT and explicitly MARKED.
import { hasOwnContent } from "./novel-dna.ts";

// The structural minimum these renderers need — matches dna-expand's local `Node` and the DnaNode twin
// both, so neither side needs a cast.
export interface CtxNode {
  id: string;
  parent_id: string | null;
  kind: string;
  position?: number;
  content: Record<string, unknown>;
  authoring?: { locked?: boolean; status?: string };
}

const str = (v: unknown): string => String(v ?? "").trim();

// ── Names (how each registry is referenced from a plan) ───────────────────────────────────────────────────
export const cName = (e: CtxNode): string => str((e.content as { name?: string }).name);
export const tName = (e: CtxNode): string => str((e.content as { name?: string }).name);
export const gName = (e: CtxNode): string => str((e.content as { name?: string }).name);
export const locName = (e: CtxNode): string => str((e.content as { name?: string }).name);
export const wfName = (e: CtxNode): string => str((e.content as { name?: string; rule?: string }).name ?? (e.content as { rule?: string }).rule);
export const tpName = (e: CtxNode): string => {
  const c = e.content as { name?: string; summary?: string };
  // legacy tentpoles authored before the `name` field existed: derive a short handle from the guidance
  // text so old data still resolves.
  return str(c.name) || str(c.summary).split(/\s+/).slice(0, 6).join(" ");
};
export const tpGuidance = (e: CtxNode): string => str((e.content as { summary?: string }).summary);

// ── Entity registries — empties are absent (the caller passes a live-filtered list) ───────────────────────

/** CAST & WORLD. `entities` = characters + world_facts + relationships hanging off the pillar. */
export function castBlock(entities: CtxNode[]): string {
  if (!entities.length) return "";
  const chars = entities.filter((e) => e.kind === "character");
  return "CAST & WORLD (reference characters BY NAME):\n" +
    chars.map((c) => `- ${cName(c)} [${(c.content as { role?: string }).role ?? "?"}] ${JSON.stringify(c.content)}`).join("\n") +
    entities.filter((e) => e.kind === "world_fact").map((w) => `\n- WORLD: ${(w.content as { rule?: string }).rule ?? ""}`).join("");
}

/** THREADS — the promise registry, so beats/scenes anchor real promises by name (schema §4.5/§6). */
export function threadBlock(threads: CtxNode[]): string {
  if (!threads.length) return "";
  return "THREADS — the promise registry (reference BY NAME):\n" +
    threads.map((t) => `- ${tName(t)}: ${(t.content as { promise?: string }).promise ?? ""} → ${(t.content as { payoff?: string }).payoff ?? ""}`).join("\n");
}

/** TENTPOLES — emotional/scene guidance the beat sheet must place. Reference BY NAME; the guidance text is
 *  not a line to quote back, so identity can't ride on reproducing it verbatim. */
export function tentpoleBlock(tentpoles: CtxNode[]): string {
  if (!tentpoles.length) return "";
  return "TENTPOLES — emotional/scene guidance to honor (each is a feel or turn the story builds toward, not a line to quote; reference it BY NAME in \"realizes\"):\n" +
    tentpoles.map((t) => `- ${tpName(t)}: ${tpGuidance(t)}`).join("\n");
}

/** WORLD RULES (name + mechanism) — so a turning point (esp. the climax) can be GROUNDED in a rule. */
export function worldRulesBlock(worldFacts: CtxNode[]): string {
  if (!worldFacts.length) return "";
  return "WORLD RULES (the mechanisms a turning point can fire — reference BY NAME in grounds_in):\n" +
    worldFacts.map((w) => `- ${wfName(w)}: ${(w.content as { mechanism?: string; rule?: string }).mechanism ?? (w.content as { rule?: string }).rule ?? ""}`).join("\n");
}

/** A location's persistent sensory palette, rendered as one line. Also used to ground a scene in the
 *  location its plan points at, so it lives here with the registry that owns it. */
export const palette = (c: { sight?: string; sound?: string; smell?: string; texture?: string; mood?: string }): string =>
  [c.sight && `sight: ${c.sight}`, c.sound && `sound: ${c.sound}`, c.smell && `smell: ${c.smell}`, c.texture && `texture: ${c.texture}`, c.mood && `mood: ${c.mood}`].filter(Boolean).join(" · ");

/** LOCATIONS (name + persistent sensory palette) — so the same place reads consistently in every scene set
 *  there (continuity; aim 1). */
export function locationBlock(locations: CtxNode[]): string {
  if (!locations.length) return "";
  return "LOCATIONS — places with a fixed sensory palette (reference BY NAME in loc; render the SAME palette every time):\n" +
    locations.map((l) => `- ${locName(l)}: ${palette(l.content as Record<string, string>) || "(no palette yet)"}`).join("\n");
}

/** GAMES (the contests + their win/lose poles) — so beats can PLAY them and a beat RESOLVES each. */
export function gamesBlock(games: CtxNode[]): string {
  if (!games.length) return "";
  return "GAMES (the contests — reference BY NAME in plays/resolves; WIN vs LOSE):\n" +
    games.map((g) => { const c = g.content as { win_condition?: string; lose_condition?: string }; return `- ${gName(g)}: WIN = ${c.win_condition ?? "?"} | LOSE = ${c.lose_condition ?? "?"}`; }).join("\n");
}

export interface StatePrecond { key: string; what: string; game: string }

/** [EXP:preconditions] the STATE preconditions each game's win spends — the beat sheet must establish each. */
export function statePreconditions(games: CtxNode[]): StatePrecond[] {
  return games.flatMap((g) => ((g.content as { win_requires?: { type?: string; what?: string; key?: string }[] }).win_requires ?? [])
    .filter((r) => r.type === "state" && r.key).map((r) => ({ key: r.key as string, what: r.what ?? "", game: gName(g) })));
}

export function precondBlock(preconds: StatePrecond[]): string {
  if (!preconds.length) return "";
  return "STATE PRECONDITIONS (each must be ESTABLISHED by an earlier beat — list its key in that beat's `establishes` — BEFORE the beat that resolves its game):\n" +
    preconds.map((p) => `- ${p.key} (${p.game}): ${p.what}`).join("\n");
}

/** The VOICE PROFILE — governs all prose. */
export function voiceBlock(vp: { pov?: string; tense?: string; style?: string; constraints?: string[]; sample?: string } | undefined): string {
  if (!vp) return "";
  return "VOICE PROFILE (every word of prose must conform to this):\n" +
    [vp.pov ? `- POV: ${vp.pov}` : "", vp.tense ? `- Tense: ${vp.tense}` : "", vp.style ? `- Style: ${vp.style}` : ""].filter(Boolean).join("\n") +
    (vp.constraints?.length ? `\n- Rules:\n${vp.constraints.map((c) => `  • ${c}`).join("\n")}` : "") +
    (vp.sample ? `\n- Reference sample (match this voice exactly):\n${vp.sample}` : "");
}

// ── HUNGER — the second channel (doc_1785673597000.md §5a-bis) ────────────────────────────────────────────
// The registries above OMIT placeholders, and taken alone that is wrong in spirit: an empty slot is not a
// void, it is an APPETITE — the book asking to be written there. Suppression-only would tell every consumer
// the book is finished.
//
// The resolution is placement, not visibility. The danger was never that a model SEES emptiness; it is that
// it MISREADS emptiness as a settled fact. Inline among content, `- [?] {}` asserts "this character has no
// want" — a claim, and a poisonous exemplar. In its own named channel, the same fact reads as an invitation.
// So: omit empties from the CONTENT blocks, then state the hunger ONCE, explicitly, in its own voice.
//
// Aggregated on purpose — counts, not rows. A generator that sees individual empty ids starts filling slots
// it was not asked to fill; what it actually needs is "the book does not end here". (The agent gets the
// per-node view instead, via treeDigestLines, because acting on specific slots IS its job.)
//
// NOT for the renderer (a reader must never meet "Chapter 4: yet to be filled") and NOT a lint (hunger is
// not a defect; a book that lints red merely for existing is unusable — that belongs in fillRatio()).
const HUNGER_ORDER = ["premise", "pillar", "act", "beat", "scene", "character", "relationship", "location", "world_fact", "thread", "game", "tentpole", "voice_profile"];

export function hungerBlock<T extends { id: string; kind: string }>(nodes: T[], fills: Map<string, { state: string }>): string {
  const counts = new Map<string, number>();
  for (const n of nodes) {
    if (fills.get(n.id)?.state !== "empty") continue;
    counts.set(n.kind, (counts.get(n.kind) ?? 0) + 1);
  }
  if (!counts.size) return "";
  const parts = [...counts].sort((a, b) => {
    const ia = HUNGER_ORDER.indexOf(a[0]), ib = HUNGER_ORDER.indexOf(b[0]);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  }).map(([kind, n]) => `${n} ${kind}${n === 1 ? "" : "s"}`);
  return `STILL UNWRITTEN (${parts.join(" · ")}) — slots that exist in the book's plan but hold no content yet. The book does NOT end where the written material ends: do not resolve, conclude, or wrap up on the assumption that what you can see is all there is. Write only what you were asked for; these are context, not a to-do list for this call.`;
}

// ── The agent's tree digest — empties are KEPT but COLLAPSED ──────────────────────────────────────────────
// A third consumer class, distinct from both of the above. The generation prompts HIDE placeholders and the
// arc MARKS them; the agent must actually SEE them, because they are its work queue — it fills a slot by
// targeting that slot's id. So nothing is filtered here. It is compressed instead, for the two reasons an
// empty node hurts a prompt: a serialized blank reads as ASSERTED absence rather than "unwritten", and a
// long run of blank exemplars drags the model's fill rate down on the nodes that DO have content.
//   • `state === "empty"` means the entire subtree is empty, so a descendant says nothing its parent hasn't
//     — keep the topmost empty node, drop everything beneath it.
//   • consecutive empty siblings of the same kind fold into one line, every id intact.
// CALLER CONTRACT: `sorted` is the full DFS-by-position walk and `seqOf` numbers over that FULL list, blanks
// included. "beat 7" must denote the same node to the agent, the tree UI, and the render whether or not
// beats 4–6 happen to be empty; numbering off the collapsed list would silently renumber the book.
export interface DigestRow { id: string; parent_id: string | null; kind: string; level: number }

export function treeDigestLines<T extends DigestRow>(
  sorted: T[],
  fills: Map<string, { state: string }>,
  serialize: (n: T) => string,
  seqOf: (n: T) => number | undefined,
): string[] {
  const byId = new Map(sorted.map((n) => [n.id, n]));
  const stateOf = (n: T) => fills.get(n.id)?.state ?? "filled";
  const parentEmpty = (n: T) => {
    const p = n.parent_id ? byId.get(n.parent_id) : undefined;
    return !!p && stateOf(p) === "empty";
  };
  const shown = sorted.filter((n) => stateOf(n) !== "empty" || !parentEmpty(n));
  const lines: string[] = [];
  for (let i = 0; i < shown.length; i++) {
    const n = shown[i];
    if (stateOf(n) !== "empty") { lines.push(serialize(n)); continue; }
    const run = [n];
    while (i + 1 < shown.length) {
      const m = shown[i + 1];
      if (stateOf(m) !== "empty" || m.parent_id !== n.parent_id || m.kind !== n.kind) break;
      run.push(m); i++;
    }
    const nums = run.map(seqOf).filter((x): x is number => typeof x === "number");
    const span = nums.length ? ` ${nums[0]}${nums.length > 1 ? `–${nums[nums.length - 1]}` : ""}` : "";
    lines.push(`[${run.map((r) => r.id).join(", ")}] L${n.level} ${n.kind}${span}${run.length > 1 ? ` ×${run.length}` : ""}: EMPTY — a placeholder slot, nothing written here or below it yet. Fill it by id.`);
  }
  return lines;
}

// ── Ladder sequence — empties are KEPT and MARKED ─────────────────────────────────────────────────────────

/** THE ARC. Unlike the registries above, this takes the RAW act list: acts are a sibling sequence, so
 *  silence is not neutral. An unwritten act is announced as a GAP, never serialized as `{}` — blank JSON
 *  reads as a fact about the act ("it has no turning point") rather than "nobody has written this yet".
 *  Emits nothing at all while EVERY act is empty (a wholly unplanned arc is the sparse tree's "" case). */
export function actBlock(acts: CtxNode[]): string {
  if (!acts.some(hasOwnContent)) return "";
  return "THE ARC (acts in order — place promises across these):\n" +
    // The value line grounds the "act's value shift is the MACRO trend" rule — the model can't oscillate
    // within (or land) a trend it never sees.
    acts.map((m, i) => {
      const c = m.content as { title?: string; turning_point?: string; value?: { name?: string; from?: string; to?: string; polarity?: string } };
      if (!hasOwnContent(m)) return `- [act ${i + 1}] — NOT YET WRITTEN (this act exists in the book's plan but has no content; do not treat the story as ending before it)`;
      const v = c.value && (c.value.name || c.value.from || c.value.to)
        ? ` | value ${c.value.name ?? ""}: ${c.value.from ?? "?"} → ${c.value.to ?? "?"}${c.value.polarity ? ` (lands ${c.value.polarity})` : ""}`
        : "";
      return `- [${c.title ?? ""}] turn: ${c.turning_point ?? ""}${v}`;
    }).join("\n");
}
