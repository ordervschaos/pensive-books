// novelDna — the pure engine for the Novel DNA tree. The book IS this tree (docs/novel-dna-schema.md);
// pages/chapters are projections (docs/novel-dna-spec.md). This module is PURE: it operates on in-memory
// node arrays — no DB, no LLM — so the whole build system (edit/lock/choose, staleness, blast radius,
// validation, the render predicate) is unit-testable. Persistence + expand(LLM) + reconcile live elsewhere.
import { metaHash } from "@/lib/planProvenance";

// ── Kinds ─────────────────────────────────────────────────────────────────────
export const LADDER_KINDS = ["seed", "premise", "pillar", "act", "beat", "scene"] as const;
export const ENTITY_KINDS = ["character", "relationship", "tentpole", "world_fact", "location", "thread", "game", "meter", "voice_profile"] as const;
export type LadderKind = (typeof LADDER_KINDS)[number];
export type EntityKind = (typeof ENTITY_KINDS)[number];
export type NodeKind = LadderKind | EntityKind;
export const isEntityKind = (k: NodeKind): k is EntityKind => (ENTITY_KINDS as readonly string[]).includes(k);

// The one legal parent kind for every kind — the skeleton the whole tree hangs on (schema §3 ladder / §4
// entities-on-the-pillar). `null` = a root. The single source of truth for "where does this attach": the
// structural linter checks against it, and generation asserts onto it (no silent fail-open re-parenting).
export const PARENT_KIND: Record<NodeKind, NodeKind | null> = {
  seed: null, premise: "seed", pillar: "premise", act: "pillar", beat: "act", scene: "beat",
  character: "pillar", relationship: "pillar", tentpole: "pillar", world_fact: "pillar", location: "pillar", thread: "pillar", game: "pillar", meter: "pillar", voice_profile: "pillar",
};
// Kinds that must be unique per book (the ladder spine + the single voice). A 2nd is a duplicate.
export const SINGLETON_KINDS: NodeKind[] = ["seed", "premise", "pillar", "voice_profile"];

// ── Authorship plane (docs/dna-structure-analysis.md Finding 3) ────────────────
// The KIND-level twin of dnaSchema's field-level taste/genOnly tags. Classifies every kind by WHO naturally
// produces it, so the journey, agent recipes, and tree editor stop each hand-asserting their own "what the
// author does vs. what the AI does" (the drift that gave threads three contradictory contracts). SSOT:
//   • authored  — becomes knowable at planning; the author (with AI options) owns it. Journey "now" steps
//                 and recipes only ever point here.
//   • derived   — a materialized index over lower rungs, MINTED by an engine pass (threads by the beat sheet,
//                 beats/scenes by the expand engine). Never a blocking "now" step; pre-declaring is optional.
//   • instrument — measurement, not story (meters): axes are pluggable, readings are always output. Never blocks.
export type Authorship = "authored" | "derived" | "instrument";
export const AUTHORSHIP: Record<NodeKind, Authorship> = {
  seed: "authored", premise: "authored", pillar: "authored", act: "authored",
  character: "authored", relationship: "authored", world_fact: "authored", location: "authored",
  game: "authored", tentpole: "authored", voice_profile: "authored",
  thread: "derived", beat: "derived", scene: "derived",
  meter: "instrument",
};
export const isAuthored = (k: NodeKind): boolean => AUTHORSHIP[k] === "authored";

export type AuthoringSource = "user" | "ai" | "ai_then_user";
export type AuthoringStatus = "empty" | "proposed" | "draft" | "accepted";

export interface Authoring {
  source: AuthoringSource;
  locked: boolean;
  status: AuthoringStatus;
  src_hash?: string; // hash of this node's INPUT SET when last generated/accepted
  prose_src_hash?: string; // scenes — hash of the scene plan the prose was written from
  illus_src_hash?: string; // scenes (picture mode) — hash of the scene plan the image+caption were made from
}

// ── Content shapes (the schema contract, §3/§4) ───────────────────────────────
// polarity: does the value end better (up) or worse (down) — feeds the emotional-topography axis (§6).
export interface ValueShift { value: string; from: string; to: string; polarity?: "up" | "down" }
// The agent's CURATED render brief — attached to a prose-render proposal and injected verbatim into the v2
// prose context (augmenting the deterministic digest, not replacing it). `focus` = what this page is really
// about in the agent's read; `mustHonor` = specific continuity facts it retrieved (grep/read); `avoid` =
// things not to repeat/contradict beyond the mechanical blocklist. See docs/agent-capabilities.md.
export interface RenderBrief { focus: string; mustHonor?: string[]; avoid?: string[] }
export interface SeedContent { logline?: string }
export interface PremiseContent { genre?: string[]; tone?: string[]; dramatic_question?: string; shape?: { setup?: string; turn1?: string; turn2?: string; turn3?: string; resolution?: string } }
export interface PillarContent { controlling_idea?: string; ending?: string }
// target_pct: where this act's turning_point should land in the book (0–1) — the pacing intent (§6).
export interface ActContent { title?: string; goal?: string; turning_point?: string; target_pct?: number; value?: ValueShift }
// A reference to a thread node + the role this beat/scene plays for that promise (§4.5/§5).
export type ThreadRole = "setup" | "payoff" | "advance";
export interface ThreadRef { ref: string; role: ThreadRole }
// polarity: the beat's PLANNED emotional charge (up/down) — set by the global beat-sheet pass to make the
// trajectory oscillate deliberately; scenes inherit it (schema §3, novel-dna-flow.md step 6).
// realizes: the tentpoles this beat DELIVERS (set-piece schedule) — the beat sheet assigns each pinned
// tentpole to a beat; scenes inherit them onto scene.realizes_tentpole (so the placement is planned, not
// left to local scene-gen — same fix as threads).
// grounds_in: the world_fact(s) whose MECHANISM this beat's turn OPERATES ON. The beat sheet plants this so
// the climax's win fires an established rule (no deus ex machina, Lester Dent's law); scenes inherit it.
// A game resolution anchored on a beat/scene (this turn DECIDES the game won/lost).
export interface GameResolution { ref: string; outcome: "won" | "lost" }
// A meter reading on a beat/scene: the LEVEL of a meter at this turn (a y-value, not a delta). Carry-forward:
// a turn with no reading on a meter holds the prior level (docs/novel-dna-meters.md §3).
export interface Reading { ref: string; value: number }
// CONTINUITY LEDGER (docs/true-agent.md Step 3): a fact a scene's PROSE asserted — key→value canon the rest of
// the book must stay consistent with ("mara" → "lot 7"). Folded left-to-right over scenes (last-write-wins =
// supersede) into the running "story so far". Observed OUTPUT of the read — the state-axis twin of observed_readings.
export interface LedgerFact { key: string; value: string; note?: string }
// A continuity break the read found in a scene's prose vs the canon established before it (was → now).
export interface ContinuityFlag { key: string; was: string; now: string; note?: string }
export interface BeatContent {
  summary?: string; connector?: "therefore" | "but"; polarity?: "up" | "down";
  threads?: ThreadRef[]; realizes?: string[]; grounds_in?: string[];
  plays?: string[];               // game ids this turn advances (a move) — schema/games §3
  resolves?: GameResolution[];    // games DECIDED on this turn
  establishes?: string[];         // CAUSALITY: state keys this turn PRODUCES (was [EXP:preconditions])
  needs?: string[];               // CAUSALITY: state keys this turn DEPENDS ON (earned upstream, not ambient)
  readings?: Reading[];           // METERS: this turn's PLANNED level on each meter (docs/novel-dna-meters.md)
  observed_readings?: Reading[];  // METERS: the level the PROSE actually delivers, written by the editor's read
                                  // (the verify loop, docs/true-agent.md). Output data — excluded from chat context.
}
export interface ChapterStart { title?: string; pov?: string; epigraph?: string }
export interface SceneContent {
  pov?: string; loc?: string; time?: { when?: string; elapsed?: string };
  present?: string[]; goal?: string; conflict?: string; outcome?: string;
  value_shift?: ValueShift;
  threads?: ThreadRef[];               // promise anchors this scene plants/pays → thread registry
  advances?: { ref: string; how?: string }[];  // relationship charge this scene moves → relationship nodes
  realizes_tentpole?: string | null;
  grounds_in?: string[];               // world_fact ids whose mechanism this scene's outcome operates on
  plays?: string[];                    // game ids this scene advances (inherited from its beat)
  resolves?: GameResolution[];         // games decided in this scene (inherited from its beat)
  establishes?: string[];              // CAUSALITY: state keys produced (inherited from its beat)
  needs?: string[];                    // CAUSALITY: state keys depended on (inherited from its beat)
  readings?: Reading[];                // METERS: this scene's level on each meter (inherited/refined from its beat)
  observed_establishes?: LedgerFact[]; // CONTINUITY: key→value facts this scene's prose asserted (the ledger delta)
  continuity_flags?: ContinuityFlag[]; // CONTINUITY: breaks the read found here vs prior canon (output, not plan input)
  chapter_start?: ChapterStart | null;
  prose?: { text?: string; words?: number };
  // Picture mode (docs/picture-book-mode.md): the scene's illustrated page. caption = the 1–3 sentence
  // page text (the DNA tree owns the words); image_url = the CHOSEN illustration that renders on the page.
  // The per-scene gallery of CANDIDATES (the "images map") lives node-keyed in node_scene_images — anchored
  // to this scene's stable id, NOT to a page row (pages are reconciled away). Both staleness-tracked via illus_src_hash.
  caption?: { text?: string; words?: number };
  image_url?: string | null;
  // Picture mode: optional per-scene art direction folded into THIS scene's image prompt (on top of the
  // book-wide house look) — e.g. "low angle, storm light, her face hidden". An INPUT, so it sits inside the
  // illus hash: change it and the scene reads stale (isIllusStale) → re-illustrate. Excluded from the prose hash.
  art_note?: string;
}
// tag = the physical/visual tag (the appearance descriptor an image render reads). portraits (picture mode,
// docs/picture-book-mode.md) = the character's "design the look" reference images, pinned on the NODE (the
// tree is self-contained — DNA-native books have no foundations.cast) and fed to scene renders for likeness.
export interface CharacterContent { name?: string; role?: "protagonist" | "antagonist" | "ally" | "love_interest" | "minor"; want?: string; need?: string; wound?: string; lie?: string; truth?: string; idiolect?: string; tag?: string; portraits?: string[] }
export interface RelationshipContent { a?: string; b?: string; bond?: string; charge?: string }
export interface TentpoleContent { summary?: string }
// name = a short handle (so beats/scenes can reference the rule); mechanism = the OPERABLE rule — what it
// enables or forbids, with inputs→outputs — not just atmosphere. The climax's win must fire a mechanism.
export interface WorldFactContent { name?: string; rule?: string; mechanism?: string; category?: string }
// location: a PLACE with a persistent sensory palette (unlike world_fact, which is a rule/mechanism). A
// scene points at one via scene.loc (the way scene.pov points at a character), so the palette carries across
// every scene set there — prose-gen reads the SAME harbor smell each time instead of re-inventing it (§ aim 1).
export interface LocationContent { name?: string; summary?: string; sight?: string; sound?: string; smell?: string; texture?: string; mood?: string }
// thread (← foundations.threads): the promise registry — one node both ends point at (§4.5).
// `owner` (optional) ties a DERIVED thread to the game whose resolution it promises — the auto-minted twin
// (docs/dna-structure-analysis.md Finding 2). Its presence is the idempotency key for game-twin reconciliation.
export interface ThreadContent { name?: string; promise?: string; payoff?: string; kind?: "mystery" | "foreshadow" | "setup_payoff" | "arc"; owner?: string }
// game (← the game pillar, docs/novel-dna-games.md): a contest with a win-condition + a stake. `couples` is
// the coupling edge — when THIS game resolves `when`, it has `effect` on the target game (the stakes engine).
export type CouplingEffect = "void" | "raise" | "lower" | "enable";
export interface Coupling { to: string; when: "won" | "lost"; effect: CouplingEffect; note?: string }
// [EXP:preconditions] — EXPERIMENT (removable). A win is a MOVE; its preconditions must hold when made. A
// `rule` precondition is satisfied by grounding (a known mechanism); a `state` precondition (a resource/state
// the win SPENDS, e.g. "fund ≥ price") must be ESTABLISHED by an earlier beat or the move is illegal (the
// "unearned resource" bug). Flip EXP_PRECONDITIONS=false to disable; grep "[EXP:preconditions]" to remove.
export const EXP_PRECONDITIONS = true;
export interface WinRequirement { type: "rule" | "state"; what: string; key?: string }
// A game is a CONTEST with an explicit possibility space — ways to win AND ways to lose. Both poles must
// exist or there are no real stakes. The climax is solid because it's one realized, legal path through that
// space (won or lost), not authorial fiat. `couples` is OPTIONAL — only multi-game stories need it.
export interface GameContent {
  name?: string; players?: string[]; win_condition?: string; lose_condition?: string; stake?: string;
  governing_rules?: string[]; couples?: Coupling[];
  win_requires?: WinRequirement[]; // [EXP:preconditions] the win's typed preconditions
}
// meter (docs/novel-dna-meters.md): one named bounded axis (comedy/heat/freedom/game-score). Defined once on
// the pillar; beats/scenes carry numeric `readings` on it. `target` is the planned curve generation aims at;
// `owner` (optional) ties an owned meter to a character/game/relationship (e.g. Mara's hope, the contract's score).
export type MeterKind = "value" | "game_score" | "affect" | "relationship" | "heat" | "comedy" | "tension" | "custom";
export interface MeterContent {
  name?: string; kind?: MeterKind; owner?: string;
  poles?: { low?: string; high?: string };
  scale?: { min?: number; max?: number };
  target?: { at: number; value: number }[];
}
// voice_profile: the book's narrative stance and prose signature — governs every word of prose.
export interface VoiceContent { pov?: string; tense?: "past" | "present"; style?: string; constraints?: string[]; sample?: string }
export type NodeContent = Record<string, unknown>;

export interface DnaNode {
  id: string;
  book_id: number;
  parent_id: string | null;
  level: number;
  kind: NodeKind;
  position: number;
  content: NodeContent;
  authoring: Authoring;
  // Candidate alternatives the author picks ONE of (the options/picker channel). Written by the agent's
  // propose_options tool; `note` carries the agent's per-option rationale. jsonb — extending this shape needs
  // no migration. chosen = the committed proposal id (set by chooseProposal).
  proposals?: { id: string; content: NodeContent; note?: string; source?: "options" }[];
  chosen?: string | null;
}

// ── Ids ───────────────────────────────────────────────────────────────────────
export const newId = () => `n_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;

// ── Tree helpers ──────────────────────────────────────────────────────────────
export const byId = (nodes: DnaNode[]): Map<string, DnaNode> => new Map(nodes.map((n) => [n.id, n]));
/** The single pillar (the hub that parents the whole entity branch, schema §4). */
export const pillarOf = (nodes: DnaNode[]): DnaNode | undefined => nodes.find((n) => n.kind === "pillar");
export const childrenOf = (nodes: DnaNode[], parentId: string | null): DnaNode[] =>
  nodes.filter((n) => n.parent_id === parentId).sort((a, b) => a.position - b.position);

/** Scenes in reading order: DFS of the narrative spine (acts→beats→scenes, each by position). */
export function scenesInOrder(nodes: DnaNode[]): DnaNode[] {
  const out: DnaNode[] = [];
  const walk = (n: DnaNode) => {
    if (n.kind === "scene") out.push(n);
    for (const c of childrenOf(nodes, n.id)) if (!isEntityKind(c.kind)) walk(c);
  };
  for (const root of nodes.filter((n) => n.parent_id === null)) walk(root);
  // Also handle trees whose roots are acts directly (no single root) — entities excluded above.
  if (!out.length) for (const m of nodes.filter((n) => n.kind === "act")) walk(m);
  return out;
}

/** The character nodes a scene depicts (picture mode, docs/picture-book-mode.md). Prefers the scene's
 *  explicit `present[]` ids; when empty (AI-generated scenes don't populate it) falls back to name-matching
 *  the cast against the scene plan (goal/conflict/outcome/pov name). MUST mirror generate-dna-scene-image's
 *  resolution so the portraits the client ensures are exactly the refs the render passes. */
export function presentCharacters(scene: DnaNode, nodes: DnaNode[]): DnaNode[] {
  const index = byId(nodes);
  const c = scene.content as SceneContent;
  const cName = (n: DnaNode) => String((n.content as CharacterContent).name ?? "").trim();
  const explicit = (c.present ?? [])
    .map((id) => index.get(id))
    .filter((n): n is DnaNode => !!n && n.kind === "character");
  if (explicit.length) return explicit;
  const povName = c.pov ? cName(index.get(c.pov) ?? ({} as DnaNode)) : "";
  const planText = [c.goal, c.conflict, c.outcome, povName].filter(Boolean).join(" \n ");
  const namedIn = (name: string) => {
    const n = name.trim();
    return !!n && new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(planText);
  };
  return nodes.filter((n) => n.kind === "character" && namedIn(cName(n)));
}

/** Beats in reading order: acts by position, then each act's beats by position. The causal
 *  spine operates on beats (the plan), not scenes (the render) — so the producer/consumer walk is here. */
export function beatsInOrder(nodes: DnaNode[]): DnaNode[] {
  const out: DnaNode[] = [];
  for (const m of nodes.filter((n) => n.kind === "act").sort((a, b) => a.position - b.position)) {
    for (const b of childrenOf(nodes, m.id)) if (b.kind === "beat") out.push(b);
  }
  return out;
}

// ── Chapters — the partition projection (§4/§6) ───────────────────────────────
export interface Chapter { index: number; title: string; pov?: string; epigraph?: string; sceneIds: string[]; wordCount: number; estPages: number }
const WORDS_PER_PAGE = 280;
const proseWords = (n: DnaNode): number => {
  const p = (n.content as SceneContent).prose;
  if (typeof p?.words === "number") return p.words;
  return (p?.text ?? "").trim() ? (p!.text as string).trim().split(/\s+/).length : 0;
};

/** Partition scenes into chapters by chapter_start boundaries. Scenes before the first boundary form an
 *  implicit opening chapter. Pure derivation — never stored. */
export function chapters(nodes: DnaNode[]): Chapter[] {
  const scenes = scenesInOrder(nodes);
  const out: Chapter[] = [];
  for (const s of scenes) {
    const cs = (s.content as SceneContent).chapter_start;
    if (cs || out.length === 0) {
      out.push({ index: out.length, title: cs?.title ?? (out.length === 0 ? "Opening" : "Untitled"), pov: cs?.pov, epigraph: cs?.epigraph, sceneIds: [], wordCount: 0, estPages: 0 });
    }
    const ch = out[out.length - 1];
    ch.sceneIds.push(s.id);
    ch.wordCount += proseWords(s);
  }
  for (const ch of out) ch.estPages = Math.max(1, Math.ceil(ch.wordCount / WORDS_PER_PAGE));
  return out;
}

// ── Render projection (Phase 2): the pages a chapter materializes ─────────────
// PROSE mode: a chapter → a SECTION page (title) + a TEXT page (its scenes' prose, concatenated).
// PICTURE mode (docs/picture-book-mode.md): a chapter → a SECTION page + one IMAGE page PER scene
// (the chosen illustration + its caption). Pure: the DB reconcile (novelDnaRender.reconcileDna) applies
// this list to `pages`. nodeId is the stable page key; `kind` picks the doc builder (image pages render
// as page_type "text" whose doc is an image node + caption — no new page type, the reader is untouched).
export interface RenderedPage { nodeId: string; kind: "section" | "text" | "image"; title: string; proseText: string; imageUrl?: string | null; caption?: string }
export function renderPages(nodes: DnaNode[], mode: "prose" | "picture" = "prose"): RenderedPage[] {
  const index = byId(nodes);
  const out: RenderedPage[] = [];
  for (const ch of chapters(nodes)) {
    const key = ch.sceneIds[0] ?? `i${ch.index}`; // first scene id is the chapter's stable boundary key
    out.push({ nodeId: `ch:${key}`, kind: "section", title: ch.title, proseText: "" });
    if (mode === "picture") {
      // One illustrated page per scene — the picture-book unit. The section page carries the chapter title;
      // each image page renders just the illustration + caption (its title is the chapter, for nav/grouping).
      for (const id of ch.sceneIds) {
        const c = index.get(id)?.content as SceneContent | undefined;
        out.push({ nodeId: `sc:${id}`, kind: "image", title: ch.title, proseText: "", imageUrl: c?.image_url ?? null, caption: c?.caption?.text?.trim() ?? "" });
      }
      continue;
    }
    const prose = ch.sceneIds
      .map((id) => (index.get(id)?.content as SceneContent | undefined)?.prose?.text?.trim())
      .filter((t): t is string => !!t)
      .join("\n\n");
    out.push({ nodeId: `ch:${key}:body`, kind: "text", title: ch.title, proseText: prose });
  }
  return out;
}

// ── Staleness — derived from the input-set hash (§6 of the spec) ──────────────
const stableStringify = (v: unknown): string => {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(",")}}`;
};

/** The node ids a node's content REFERENCES (cross-links — part of its input set, not parent edges). */
export function refsOf(node: DnaNode): string[] {
  const out: string[] = [];
  if (node.kind === "scene") {
    const c = node.content as SceneContent;
    if (c.pov) out.push(c.pov);
    // loc is now a location ref (like pov→character). Only treat it as a ref when it's a node id (`n_…`) so
    // legacy free-text locs ("the harbor") aren't flagged as dangling — they just render as their own string.
    if (c.loc && c.loc.startsWith("n_")) out.push(c.loc);
    if (Array.isArray(c.present)) out.push(...c.present);
    if (c.realizes_tentpole) out.push(c.realizes_tentpole);
    if (Array.isArray(c.threads)) out.push(...c.threads.map((t) => t.ref).filter(Boolean));
    if (Array.isArray(c.advances)) out.push(...c.advances.map((a) => a.ref).filter(Boolean));
    if (Array.isArray(c.grounds_in)) out.push(...c.grounds_in.filter(Boolean));
    if (Array.isArray(c.plays)) out.push(...c.plays.filter(Boolean));
    if (Array.isArray(c.resolves)) out.push(...c.resolves.map((r) => r.ref).filter(Boolean));
    if (Array.isArray(c.readings)) out.push(...c.readings.map((r) => r.ref).filter(Boolean));
  } else if (node.kind === "beat") {
    const c = node.content as BeatContent;
    if (Array.isArray(c.threads)) out.push(...c.threads.map((t) => t.ref).filter(Boolean));
    if (Array.isArray(c.grounds_in)) out.push(...c.grounds_in.filter(Boolean));
    if (Array.isArray(c.plays)) out.push(...c.plays.filter(Boolean));
    if (Array.isArray(c.resolves)) out.push(...c.resolves.map((r) => r.ref).filter(Boolean));
    if (Array.isArray(c.readings)) out.push(...c.readings.map((r) => r.ref).filter(Boolean));
    if (Array.isArray(c.observed_readings)) out.push(...c.observed_readings.map((r) => r.ref).filter(Boolean));
  } else if (node.kind === "meter") {
    const c = node.content as MeterContent;
    if (c.owner) out.push(c.owner);
  } else if (node.kind === "relationship") {
    const c = node.content as RelationshipContent;
    if (c.a) out.push(c.a);
    if (c.b) out.push(c.b);
  } else if (node.kind === "game") {
    const c = node.content as GameContent;
    if (Array.isArray(c.players)) out.push(...c.players.filter(Boolean));
    if (Array.isArray(c.governing_rules)) out.push(...c.governing_rules.filter(Boolean));
    if (Array.isArray(c.couples)) out.push(...c.couples.map((k) => k.to).filter(Boolean));
  }
  return [...new Set(out)];
}

/** Inverse of refsOf: id → the nodes whose content cross-references it (inbound edges). Powers the tree's
 *  "referenced by" view and the delete-safety guard (deleting an entity that others point at). One pass. */
export function backlinkIndex(nodes: DnaNode[]): Map<string, DnaNode[]> {
  const map = new Map<string, DnaNode[]>();
  for (const n of nodes) for (const ref of refsOf(n)) (map.get(ref) ?? map.set(ref, []).get(ref)!).push(n);
  return map;
}

// Fields that are OUTPUTS of generation/the read, never plan INPUTS — stripped before any input-set hash so
// writing them (e.g. a meter read onto a beat, a fact ledger onto a scene) never spuriously stales the nodes
// that hash this content. Mirrors how the prose/illus hashes already exclude prose/caption/image_url.
const OUTPUT_FIELDS = ["prose", "caption", "image_url", "observed_readings", "observed_establishes", "continuity_flags"] as const;
function planOf(content: NodeContent | null | undefined): NodeContent | null {
  if (!content) return null;
  const out: Record<string, unknown> = { ...(content as Record<string, unknown>) };
  for (const k of OUTPUT_FIELDS) delete out[k];
  return out;
}

/** Hash of a node's full input set: its parent's content + every referenced entity's content — with OUTPUT
 *  fields stripped, so a generated value living in a parent's content never leaks into a child's staleness. */
export function inputHash(node: DnaNode, index: Map<string, DnaNode>): string {
  const parent = node.parent_id ? index.get(node.parent_id) : null;
  const refs = refsOf(node).map((id) => planOf(index.get(id)?.content));
  return metaHash(stableStringify([planOf(parent?.content), ...refs]));
}

/** A node is stale iff its recorded src_hash no longer matches its current input set. Never stale before
 *  it's been stamped (never generated) — "don't badge what we didn't generate". */
export function isStale(node: DnaNode, index: Map<string, DnaNode>): boolean {
  if (!node.authoring.src_hash) return false;
  return node.authoring.src_hash !== inputHash(node, index);
}

/** Scene prose is stale iff the scene plan changed since the prose was written. */
export function isProseStale(scene: DnaNode): boolean {
  const c = scene.content as SceneContent;
  if (!c.prose?.text?.trim() || !scene.authoring.prose_src_hash) return false;
  // art_note is a picture-only input; observed_establishes/continuity_flags are OUTPUTS of the read, not inputs.
  const { prose: _p, art_note: _a, observed_establishes: _oe, continuity_flags: _cf, ...plan } = c;
  return scene.authoring.prose_src_hash !== metaHash(stableStringify(plan));
}

/** Picture mode: a scene's illustrated page (image + caption) is stale iff the scene plan changed since it
 *  was generated. The image_url + caption are excluded from the hash (they're the OUTPUT, like prose). */
export function isIllusStale(scene: DnaNode): boolean {
  const c = scene.content as SceneContent;
  const made = !!(c.image_url?.trim() || c.caption?.text?.trim());
  if (!made || !scene.authoring.illus_src_hash) return false;
  const { image_url: _i, caption: _c, prose: _p, observed_establishes: _oe, continuity_flags: _cf, ...plan } = c;
  return scene.authoring.illus_src_hash !== metaHash(stableStringify(plan));
}

/** Stamp a node's input hash (call when it's generated/accepted from its current inputs). */
export function stampInput(node: DnaNode, index: Map<string, DnaNode>): DnaNode {
  return { ...node, authoring: { ...node.authoring, src_hash: inputHash(node, index) } };
}
/** Stamp a scene's prose hash (call after prose is written from the current plan). */
export function stampProse(scene: DnaNode): DnaNode {
  const { prose: _p, art_note: _a, observed_establishes: _oe, continuity_flags: _cf, ...plan } = scene.content as SceneContent;
  return { ...scene, authoring: { ...scene.authoring, prose_src_hash: metaHash(stableStringify(plan)) } };
}
/** Stamp a scene's illustration hash (call after the image + caption are made from the current plan). */
export function stampIllus(scene: DnaNode): DnaNode {
  const { image_url: _i, caption: _c, prose: _p, observed_establishes: _oe, continuity_flags: _cf, ...plan } = scene.content as SceneContent;
  return { ...scene, authoring: { ...scene.authoring, illus_src_hash: metaHash(stableStringify(plan)) } };
}

// ── Pure edits ────────────────────────────────────────────────────────────────
/** The canonical DNA content merge: nested PLAIN OBJECTS merge recursively; arrays and scalars from the
 *  patch REPLACE (DNA arrays — threads/players/shape… — are whole values, never appended). Used by EVERY
 *  edit path so a nested patch (e.g. { shape: { setup } }) can't clobber its sibling fields (turn1…resolution). */
export function deepMergeContent(base: NodeContent, patch: NodeContent): NodeContent {
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  const p = patch as Record<string, unknown>;
  for (const k of Object.keys(p)) {
    const pv = p[k], bv = out[k];
    out[k] = pv && typeof pv === "object" && !Array.isArray(pv) && bv && typeof bv === "object" && !Array.isArray(bv)
      ? deepMergeContent(bv as NodeContent, pv as NodeContent)
      : pv;
  }
  return out;
}

export function editContent(node: DnaNode, patch: NodeContent): DnaNode {
  const wasEmpty = node.authoring.status === "empty";
  return {
    ...node,
    content: deepMergeContent(node.content, patch),
    authoring: {
      ...node.authoring,
      source: wasEmpty ? "user" : node.authoring.source === "ai" ? "ai_then_user" : node.authoring.source,
      status: node.authoring.status === "empty" ? "draft" : node.authoring.status,
    },
  };
}
export const lock = (node: DnaNode, locked = true): DnaNode => ({ ...node, authoring: { ...node.authoring, locked } });
export const setStatus = (node: DnaNode, status: AuthoringStatus): DnaNode => ({ ...node, authoring: { ...node.authoring, status } });

/** Accept one of a node's proposals: its content becomes the node's, status→accepted, source→ai. */
export function chooseProposal(node: DnaNode, proposalId: string): DnaNode {
  const p = node.proposals?.find((x) => x.id === proposalId);
  if (!p) return node;
  return { ...node, content: p.content, chosen: proposalId, proposals: undefined, authoring: { ...node.authoring, status: "accepted", source: "ai" } };
}

// ── Blast radius (§6) ─────────────────────────────────────────────────────────
/** The unlocked nodes a change to `changedId` would touch: its subtree (pruned at any lock) plus, if it's
 *  an entity, the unlocked scenes that reference it. The "visible blast radius" shown before regenerating. */
export function blastRadius(changedId: string, nodes: DnaNode[]): { count: number; ids: string[] } {
  const out = new Set<string>();
  const walk = (id: string) => {
    for (const c of childrenOf(nodes, id)) {
      if (c.authoring.locked) continue; // locks stop the sweep cold
      out.add(c.id);
      walk(c.id);
    }
  };
  walk(changedId);
  const changed = nodes.find((n) => n.id === changedId);
  if (changed && isEntityKind(changed.kind)) {
    for (const n of nodes) if (n.kind === "scene" && !n.authoring.locked && refsOf(n).includes(changedId)) out.add(n.id);
  }
  return { count: out.size, ids: [...out] };
}

// ── The global beat-sheet guarantee (root fix) ────────────────────────────────
// The promise axis (setup→payoff in order) is a property of the WHOLE sequence — so it must be enforced
// where the whole sequence is in view: the global beat-sheet pass, not per-beat scene-gen. This makes the
// `unearned_payoff`/`misordered_payoff` lints *invariants the generator can't violate* rather than after-
// the-fact complaints. Pure + testable; the edge fn / bridge mirror this logic on their parsed beat sheets.
export interface ThreadCarrier { threads?: ThreadRef[] }

/** Walk items in reading order; for each thread, keep `payoff` roles only once a `setup` for that thread has
 *  already appeared. Orphan payoffs (no prior setup) are DROPPED. Returns cleaned items + the drop count.
 *  This guarantees: every surviving payoff is preceded by its setup → no unearned/misordered payoff. */
export function enforcePromiseSchedule<T extends ThreadCarrier>(itemsInOrder: T[]): { items: T[]; dropped: number } {
  const setUp = new Set<string>();
  let dropped = 0;
  const items = itemsInOrder.map((it) => {
    if (!it.threads?.length) return it;
    // first pass: this item's own setups count for payoffs in the SAME item (a beat can set up and pay later
    // beats, but a single item paying a thread it also sets up is allowed).
    for (const t of it.threads) if (t.role === "setup") setUp.add(t.ref);
    const kept = it.threads.filter((t) => {
      if (t.role !== "payoff") return true;
      if (setUp.has(t.ref)) return true;
      dropped++;
      return false;
    });
    return kept.length === it.threads.length ? it : { ...it, threads: kept };
  });
  return { items, dropped };
}

// ── The three analytic axes (schema §6) ───────────────────────────────────────
// All derive over scenes-in-reading-order; none store anything. Each also feeds a lint in validate().

const PACING_DRIFT_TOL = 0.1;   // a act turn >10 percentage-points off its target_pct = drift
const SAGGING_RUN = 4;          // ≥4 consecutive same-polarity scenes = a sagging middle
const METER_FLAT_RUN = 4;       // ≥4 consecutive ~equal readings on a meter = a dead stretch on that axis
const METER_MIN_OSC = 2;        // a meter that changes direction fewer times over its life reads monotone
const METER_POLE_BAND = 0.15;   // a game_score must come within 15% of its losing pole or there's no jeopardy
const METER_TARGET_DRIFT_BAND = 0.2; // the PLAN's readings may sit within 20% of scale of the INTENDED target curve
const METER_READ_GAP_BAND = 0.2;     // the prose-OBSERVED reading may sit within 20% of scale of the PLANNED reading

/** PACING (when): each act's turning point gets an actual % (cumulative words, or scene count
 *  pre-prose) and the drift from its authored target_pct. */
export interface PacingPoint { actId: string; title?: string; targetPct?: number; actualPct: number; driftPct: number }
export function pacing(nodes: DnaNode[]): PacingPoint[] {
  const index = byId(nodes);
  const scenes = scenesInOrder(nodes);
  const hasProse = scenes.some((s) => proseWords(s) > 0);
  const w = (s: DnaNode) => (hasProse ? proseWords(s) : 1); // pre-prose: weight every scene equally
  const total = scenes.reduce((a, s) => a + w(s), 0) || 1;
  const actOf = (s: DnaNode): string | null => {
    const beat = s.parent_id ? index.get(s.parent_id) : null;
    const mv = beat?.parent_id ? index.get(beat.parent_id) : null;
    return mv?.kind === "act" ? mv.id : null;
  };
  let cum = 0;
  const endFrac = new Map<string, number>(); // cumulative fraction at a act's LAST scene = where its turn lands
  for (const s of scenes) { cum += w(s); const m = actOf(s); if (m) endFrac.set(m, cum / total); }
  return nodes.filter((n) => n.kind === "act").sort((a, b) => a.position - b.position).map((m) => {
    const c = m.content as ActContent;
    const actualPct = endFrac.get(m.id) ?? 0;
    return { actId: m.id, title: c.title, targetPct: c.target_pct, actualPct, driftPct: typeof c.target_pct === "number" ? actualPct - c.target_pct : 0 };
  });
}

/** EMOTIONAL TOPOGRAPHY (charge): the value_shift polarity of each scene in reading order. */
export function topography(nodes: DnaNode[]): { sceneId: string; polarity: "up" | "down" | null }[] {
  return scenesInOrder(nodes).map((s) => ({ sceneId: s.id, polarity: (s.content as SceneContent).value_shift?.polarity ?? null }));
}

/** PROMISES (what): per thread, how many scenes set it up vs pay it off (in reading order). The registry
 *  view the UI shows and the chat is handed — a thread with payoffs:0 is a dangling promise. */
export interface PromiseLedgerRow { threadId: string; name: string; promise: string; setups: number; payoffs: number }
export function promiseLedger(nodes: DnaNode[]): PromiseLedgerRow[] {
  const scenes = scenesInOrder(nodes);
  return nodes.filter((n) => n.kind === "thread").map((t) => {
    const c = t.content as ThreadContent;
    let setups = 0, payoffs = 0;
    for (const s of scenes) for (const ref of ((s.content as SceneContent).threads ?? [])) {
      if (ref.ref !== t.id) continue;
      if (ref.role === "setup") setups++; else if (ref.role === "payoff") payoffs++;
    }
    return { threadId: t.id, name: c.name ?? t.id, promise: c.promise ?? "", setups, payoffs };
  });
}

// ── CAUSALITY (why): the causal spine — the 4th axis (when/what/charge/why) ───
// Every beat claims a `connector` (therefore/but), but that's a self-asserted LABEL until we check it.
// Make it computable the same way the ledger made thread refs computable: each beat PRODUCES state keys
// (`establishes`) and DEPENDS ON state keys (`needs`). Walk beats in reading order accumulating produced
// state; a `therefore` whose `needs` aren't produced upstream is an *uncaused* claim ("and then" in
// disguise). `needs` are earned-in-story keys only — ambient premise/world givens are NOT needs.
export interface CausalityRow {
  beatId: string; idx: number; connector?: "therefore" | "but";
  needs: string[]; unmet: string[];       // unmet = needs no earlier beat establishes
  produces: string[]; reversed: boolean;  // reversed = polarity turns vs the prior beat (the `but` test)
}
export function causality(nodes: DnaNode[]): CausalityRow[] {
  const beats = beatsInOrder(nodes);
  const producedSoFar = new Set<string>();
  let prevPolarity: "up" | "down" | undefined;
  return beats.map((b, idx): CausalityRow => {
    const c = b.content as BeatContent;
    const needs = c.needs ?? [];
    const unmet = needs.filter((k) => !producedSoFar.has(k));   // checked BEFORE this beat produces
    const produces = c.establishes ?? [];
    for (const k of produces) producedSoFar.add(k);
    const reversed = !!c.polarity && !!prevPolarity && c.polarity !== prevPolarity;
    prevPolarity = c.polarity ?? prevPolarity;
    return { beatId: b.id, idx, connector: c.connector, needs, unmet, produces, reversed };
  });
}

/** CAUSALITY lints: a `therefore` whose needs aren't earned upstream (hollow link), and a `but` that
 *  neither reverses charge nor consumes an established state (a labeled reversal that turns nothing). */
function causalityLints(nodes: DnaNode[]): DnaIssue[] {
  const issues: DnaIssue[] = [];
  for (const r of causality(nodes)) {
    if (r.idx === 0) continue; // the opener has no prior beat — therefore/but are antecedent-relative
    if (r.connector === "therefore" && r.unmet.length) {
      issues.push({ rule: "uncaused_therefore", severity: "warn", nodeId: r.beatId,
        message: `beat follows "therefore" but needs "${r.unmet.join(", ")}", which no earlier beat establishes — the causal link is hollow` });
    }
    if (r.connector === "but" && !r.reversed && !r.needs.length) {
      issues.push({ rule: "empty_but", severity: "warn", nodeId: r.beatId,
        message: `beat is labeled "but" but doesn't reverse the charge or consume an established state — the complication turns nothing` });
    }
  }
  return issues;
}

// ── The stakes graph (the game pillar — docs/novel-dna-games.md §4) ───────────
// Coupling makes stakes COMPUTABLE: a game's stake = what its outcome does to the other games. Pure
// functions over the games + their `couples` edges.

/** cascade(gameId, outcome): the games this resolution affects, transitively (follow couples edges whose
 *  `when` matches). Returns each affected game id + the effect that reached it. The propagation the reader
 *  feels — "if he loses her, everything else collapses." */
export function cascade(nodes: DnaNode[], gameId: string, outcome: "won" | "lost"): { gameId: string; effect: CouplingEffect }[] {
  const index = byId(nodes);
  const out = new Map<string, CouplingEffect>();
  const walk = (id: string, when: "won" | "lost") => {
    const g = index.get(id);
    if (!g || g.kind !== "game") return;
    for (const c of ((g.content as GameContent).couples ?? [])) {
      if (c.when !== when || !c.to || out.has(c.to)) continue;
      out.set(c.to, c.effect);
      // A voided/enabled target propagates as the same-direction resolution to ITS couplings.
      if (c.effect === "void") walk(c.to, "lost");
      else if (c.effect === "enable") walk(c.to, "won");
    }
  };
  walk(gameId, outcome);
  return [...out].map(([id, effect]) => ({ gameId: id, effect }));
}

/** stakesOf(game): the magnitude of what rides on a game = the union of games its win OR loss would touch.
 *  |stakesOf| is the computed stake (schema/games §4) — high when a resolution cascades widely. */
export function stakesOf(nodes: DnaNode[], gameId: string): string[] {
  const won = cascade(nodes, gameId, "won").map((c) => c.gameId);
  const lost = cascade(nodes, gameId, "lost").map((c) => c.gameId);
  return [...new Set([...won, ...lost])];
}

// ── METERS (the plottable axis layer — docs/novel-dna-meters.md) ──────────────
// A meter is one named bounded axis (comedy/heat/freedom/game-score). Beats carry numeric `readings`; this
// derives the series (what a chart plots) and the shape stats the lints read. Pure, over the beat spine (the
// PLAN layer, like causality) with carry-forward so a gap means "held", not 0. Nothing is stored.
export interface MeterPoint { id: string; idx: number; value: number | null }
/** A meter's level over the beat spine from one reading channel, carry-forward filling gaps. `readings` is
 *  the PLAN (authored); `observed_readings` is what the editor's read measured off the prose (the verify loop). */
function seriesFrom(nodes: DnaNode[], meterId: string, field: "readings" | "observed_readings"): MeterPoint[] {
  let last: number | null = null;
  return beatsInOrder(nodes).map((b, idx) => {
    const r = ((b.content as BeatContent)[field] ?? []).find((x) => x.ref === meterId);
    if (r && typeof r.value === "number") last = r.value;
    return { id: b.id, idx, value: last };
  });
}
/** The PLAN series — the beat sheet's authored `readings` on a meter. */
export const meterSeries = (nodes: DnaNode[], meterId: string): MeterPoint[] => seriesFrom(nodes, meterId, "readings");
/** The OBSERVED series — what the editor's read measured off the prose (`observed_readings`). The 3rd trace. */
export const observedSeries = (nodes: DnaNode[], meterId: string): MeterPoint[] => seriesFrom(nodes, meterId, "observed_readings");

/** Summary stats the lints + UI read off a series: range used, # direction changes (oscillation), longest
 *  flat run, terminal value. Carry-forward nulls (leading gaps before the first reading) are ignored. */
export function meterShape(series: MeterPoint[]): { range: number; oscillations: number; flatRun: number; last: number | null } {
  const ys = series.map((p) => p.value).filter((v): v is number => v != null);
  if (!ys.length) return { range: 0, oscillations: 0, flatRun: 0, last: null };
  let osc = 0, flat = 1, maxFlat = 1, dir = 0;
  for (let i = 1; i < ys.length; i++) {
    const d = Math.sign(ys[i] - ys[i - 1]);
    if (d === 0) { flat++; maxFlat = Math.max(maxFlat, flat); }
    else { flat = 1; if (dir && d !== dir) osc++; dir = d; }
  }
  return { range: Math.max(...ys) - Math.min(...ys), oscillations: osc, flatRun: maxFlat, last: ys[ys.length - 1] };
}

/** A meter is "serial" (plottable as a line) once it carries ≥2 readings across the spine. */
export function isSerialMeter(nodes: DnaNode[], meterId: string): boolean {
  return meterSeries(nodes, meterId).filter((p) => p.value != null).length >= 2;
}

/** Linear-interpolate a sparse target curve (keyframes at fractions 0..1, pre-sorted) at fraction f,
 *  clamped flat beyond the first/last keyframe. */
function interpTarget(pts: { at: number; value: number }[], f: number): number {
  if (f <= pts[0].at) return pts[0].value;
  if (f >= pts[pts.length - 1].at) return pts[pts.length - 1].value;
  for (let i = 1; i < pts.length; i++) {
    if (f <= pts[i].at) {
      const a = pts[i - 1], b = pts[i];
      const t = (f - a.at) / (b.at - a.at || 1);
      return a.value + t * (b.value - a.value);
    }
  }
  return pts[pts.length - 1].value;
}

/** The INTENT layer: the meter's planned `target` curve sampled at every beat. The sparse keyframes
 *  ({at: 0..1 fraction of the book, value}) are linearly interpolated across the beat spine (beat i sits
 *  at fraction i/(n-1), the same x the chart uses). Returns null at every beat when the meter has no
 *  target — there's nothing to aim at. Compare against meterSeries (the PLAN) via targetGap. */
export function meterTarget(nodes: DnaNode[], meterId: string): MeterPoint[] {
  const beats = beatsInOrder(nodes);
  const meter = nodes.find((n) => n.id === meterId && n.kind === "meter");
  const pts = (((meter?.content as MeterContent | undefined)?.target) ?? [])
    .filter((p) => typeof p?.at === "number" && typeof p?.value === "number")
    .sort((a, b) => a.at - b.at);
  const n = beats.length;
  return beats.map((b, idx) => ({
    id: b.id, idx,
    value: pts.length === 0 ? null : interpTarget(pts, n <= 1 ? 0 : idx / (n - 1)),
  }));
}

/** Plan-vs-intent diff (Diff A — pure, no model): per-beat delta between the PLAN (meterSeries readings)
 *  and the INTENT (meterTarget curve), over the beats where BOTH are present, plus the worst beat and the
 *  RMS deviation. The cheap half of the verify loop — does the beat sheet even aim at the intended shape? */
export interface TargetGap {
  perBeat: { id: string; idx: number; planned: number; target: number; delta: number }[];
  maxAbs: number;            // largest |delta| across compared beats
  worstBeatId: string | null;
  rms: number;               // root-mean-square deviation
}
export function targetGap(nodes: DnaNode[], meterId: string): TargetGap {
  const plan = meterSeries(nodes, meterId);
  const tgt = meterTarget(nodes, meterId);
  const perBeat: TargetGap["perBeat"] = [];
  for (let i = 0; i < plan.length; i++) {
    const p = plan[i].value, t = tgt[i]?.value;
    if (p == null || t == null) continue;
    perBeat.push({ id: plan[i].id, idx: i, planned: p, target: t, delta: p - t });
  }
  let maxAbs = 0, worstBeatId: string | null = null, sumSq = 0;
  for (const r of perBeat) {
    sumSq += r.delta * r.delta;
    if (Math.abs(r.delta) > maxAbs) { maxAbs = Math.abs(r.delta); worstBeatId = r.id; }
  }
  return { perBeat, maxAbs, worstBeatId, rms: perBeat.length ? Math.sqrt(sumSq / perBeat.length) : 0 };
}

/** Observed-vs-plan diff (Diff B — the experiential read, docs/true-agent.md): per-beat delta between what
 *  the PROSE delivers (observedSeries) and what the beat sheet PLANNED (meterSeries), over beats where both
 *  exist, plus the worst beat. delta = observed − planned (negative = the prose under-delivers the plan).
 *  Empty until a read has populated observed_readings. The other half of the verify loop. */
export interface ObservedGap {
  perBeat: { id: string; idx: number; observed: number; planned: number; delta: number }[];
  maxAbs: number; worstBeatId: string | null; rms: number;
}
export function observedGap(nodes: DnaNode[], meterId: string): ObservedGap {
  const obs = observedSeries(nodes, meterId);
  const plan = meterSeries(nodes, meterId);
  const perBeat: ObservedGap["perBeat"] = [];
  for (let i = 0; i < plan.length; i++) {
    const o = obs[i]?.value, p = plan[i].value;
    if (o == null || p == null) continue;
    perBeat.push({ id: plan[i].id, idx: i, observed: o, planned: p, delta: o - p });
  }
  let maxAbs = 0, worstBeatId: string | null = null, sumSq = 0;
  for (const r of perBeat) {
    sumSq += r.delta * r.delta;
    if (Math.abs(r.delta) > maxAbs) { maxAbs = Math.abs(r.delta); worstBeatId = r.id; }
  }
  return { perBeat, maxAbs, worstBeatId, rms: perBeat.length ? Math.sqrt(sumSq / perBeat.length) : 0 };
}

/** METER lints: a flat axis (nothing moves), a monotone axis (never reverses), and — for game_score meters —
 *  a possibility space that never nears its losing pole (the measurable "no jeopardy" the games doc wants). */
function meterLints(nodes: DnaNode[]): DnaIssue[] {
  const issues: DnaIssue[] = [];
  for (const m of nodes.filter((n) => n.kind === "meter")) {
    const c = m.content as MeterContent;
    const series = meterSeries(nodes, m.id);
    const s = meterShape(series);
    if (s.last == null) continue; // no readings yet — "early", not "wrong" (mirror the other axes)
    if (s.flatRun >= METER_FLAT_RUN) {
      issues.push({ rule: "flat_meter", severity: "warn", nodeId: m.id, message: `"${c.name ?? m.id}" holds flat for ${s.flatRun} beats — nothing moves on this axis` });
    }
    if (s.oscillations < METER_MIN_OSC && series.filter((p) => p.value != null).length >= METER_FLAT_RUN) {
      issues.push({ rule: "no_oscillation", severity: "warn", nodeId: m.id, message: `"${c.name ?? m.id}" barely changes direction — monotone charge` });
    }
    if (c.kind === "game_score") {
      const min = c.scale?.min ?? 0, max = c.scale?.max ?? 100;
      const lowBand = min + (max - min) * METER_POLE_BAND;
      const neared = series.some((p) => p.value != null && p.value <= lowBand);
      if (!neared) {
        issues.push({ rule: "no_jeopardy", severity: "warn", nodeId: m.id, message: `game-score "${c.name ?? m.id}" never nears its losing pole — the win was never in doubt (soft climax)` });
      }
    }
    // A meter's comparison band = a fraction of its scale (explicit scale, else the readings' observed range).
    const span = typeof c.scale?.min === "number" && typeof c.scale?.max === "number" ? c.scale.max - c.scale.min : s.range;
    // The PLAN vs the INTENT: when a target curve is set, the beat-sheet readings must aim at it. A drift
    // beyond a band of the meter's scale = the beat sheet isn't tracking the shape it declared it wants.
    if ((c.target ?? []).length && span > 0) {
      const gap = targetGap(nodes, m.id);
      if (gap.maxAbs > METER_TARGET_DRIFT_BAND * span) {
        const worst = gap.perBeat.find((r) => r.id === gap.worstBeatId);
        issues.push({ rule: "target_drift", severity: "warn", nodeId: m.id,
          message: `"${c.name ?? m.id}" planned readings drift from the target curve by up to ${Math.round(gap.maxAbs)}${worst ? ` (beat ${worst.idx + 1}: plan ${worst.planned} vs target ${Math.round(worst.target)})` : ""} — the beat sheet isn't aiming at the intended shape` });
      }
    }
    // The OBSERVED vs the PLAN (the verify loop): once the editor's read has populated observed_readings, a
    // beat whose prose departs from its planned reading by more than the band = the prose underdelivers the plan.
    if (span > 0 && observedSeries(nodes, m.id).some((p) => p.value != null)) {
      const gap = observedGap(nodes, m.id);
      if (gap.maxAbs > METER_READ_GAP_BAND * span) {
        const worst = gap.perBeat.find((r) => r.id === gap.worstBeatId);
        issues.push({ rule: "read_gap", severity: "warn", nodeId: m.id,
          message: `"${c.name ?? m.id}" reads off-plan by up to ${Math.round(gap.maxAbs)}${worst ? ` (beat ${worst.idx + 1}: prose ${worst.observed} vs planned ${worst.planned})` : ""} — the prose doesn't deliver the planned level` });
      }
    }
  }
  return issues;
}

// ── CONTINUITY LEDGER (the prefix-sum "story so far" — docs/true-agent.md Step 3) ──────────────────────────
// A scan over scenes in reading order: each scene's observed_establishes (the key→value facts its prose
// asserted) fold left-to-right, LAST-WRITE-WINS per key (re-asserting a key supersedes the old value — the
// assert/supersede lifecycle). ledgerBefore returns the canon a scene INHERITS (1..n-1, never itself or the
// future) — the bounded context the per-page coherence check reads, and the state-axis cousin of meterSeries.
type StampedFact = LedgerFact & { sceneId: string };
function foldFacts(scenes: DnaNode[]): Map<string, StampedFact> {
  const canon = new Map<string, StampedFact>();
  for (const s of scenes) {
    for (const f of ((s.content as SceneContent).observed_establishes ?? [])) {
      if (!f?.key) continue;
      canon.set(f.key, { key: f.key, value: f.value, note: f.note, sceneId: s.id });
    }
  }
  return canon;
}
/** The continuity canon a scene inherits: facts asserted by every scene strictly BEFORE it in reading order,
 *  last-write-wins. Empty for the opening scene. The bounded "story so far" the per-page check reads. */
export function ledgerBefore(nodes: DnaNode[], sceneId: string): LedgerFact[] {
  const scenes = scenesInOrder(nodes);
  const i = scenes.findIndex((s) => s.id === sceneId);
  const prior = i < 0 ? scenes : scenes.slice(0, i);
  return [...foldFacts(prior).values()].map(({ sceneId: _s, ...f }) => f);
}
/** The whole-book continuity canon (every fact, last-write-wins), each tagged with the scene that set it. The
 *  ledger view + the input the macro re-read audits. */
export function ledgerFull(nodes: DnaNode[]): StampedFact[] {
  return [...foldFacts(scenesInOrder(nodes)).values()];
}

/** A compact plain-text STORY ANALYSIS — the three axes + lints — handed to the dna-chat reviser as context
 *  so it can act on pacing drift / dangling promises / sagging runs. The UI renders the same data visually. */
export function analysisText(nodes: DnaNode[], settings: BookSettings): string {
  const lines: string[] = [];
  const pace = pacing(nodes);
  if (pace.length) {
    lines.push("PACING (turning point position vs target):");
    for (const p of pace) lines.push(`  ${p.title ?? p.actId}: actual ${Math.round(p.actualPct * 100)}%${typeof p.targetPct === "number" ? ` / target ${Math.round(p.targetPct * 100)}%${Math.abs(p.driftPct) > 0.1 ? " ⚠ DRIFT" : ""}` : ""}`);
  }
  const ledger = promiseLedger(nodes);
  if (ledger.length) {
    lines.push("PROMISES (thread registry — setups/payoffs):");
    for (const r of ledger) lines.push(`  "${r.name}": setups ${r.setups}, payoffs ${r.payoffs}${r.setups && !r.payoffs ? " ⚠ DANGLING" : ""}`);
  }
  const topo = topography(nodes).map((t) => (t.polarity === "up" ? "+" : t.polarity === "down" ? "-" : "·"));
  if (topo.length) lines.push(`TOPOGRAPHY (value polarity in reading order): ${topo.join("")}`);
  const causal = causality(nodes);
  if (causal.some((r) => r.connector || r.needs.length)) {
    lines.push("CAUSALITY (why — each beat's connector + unmet needs):");
    for (const r of causal) {
      const unmet = r.unmet.length ? ` ⚠ UNMET: ${r.unmet.join(", ")}` : "";
      lines.push(`  beat ${r.idx + 1} [${r.connector ?? "—"}]${r.needs.length ? ` needs: ${r.needs.join(", ")}` : ""}${r.produces.length ? ` → ${r.produces.join(", ")}` : ""}${unmet}`);
    }
  }
  const meters = nodes.filter((n) => n.kind === "meter");
  if (meters.length) {
    lines.push("METERS (tracked axes — level over the beat spine):");
    for (const m of meters) {
      const c = m.content as MeterContent;
      const series = meterSeries(nodes, m.id);
      const s = meterShape(series);
      const vals = series.map((p) => (p.value == null ? "·" : String(p.value))).join("→");
      lines.push(`  "${c.name ?? m.id}"${c.kind ? ` (${c.kind})` : ""}: ${vals || "(no readings)"}${s.last != null ? ` [range ${s.range}, osc ${s.oscillations}]` : ""}`);
    }
  }
  const issues = validate(nodes);
  if (issues.length) { lines.push("LINTS:"); for (const i of issues) lines.push(`  [${i.severity}] ${i.rule}: ${i.message}`); }
  return lines.join("\n");
}

/** PROMISES (what): resolve each thread's setup/payoff against reading order (§4.5). Two-pass so a payoff
 *  that precedes its setup is told apart (misordered) from one that has no setup at all (unearned). */
function promiseLints(nodes: DnaNode[]): DnaIssue[] {
  const index = byId(nodes);
  const scenes = scenesInOrder(nodes);
  const setupAt = new Map<string, number>();                       // threadId → first setup scene index
  const payoffAt = new Map<string, { i: number; sceneId: string }>(); // threadId → first payoff
  scenes.forEach((s, i) => {
    for (const t of ((s.content as SceneContent).threads ?? [])) {
      if (index.get(t.ref)?.kind !== "thread") continue;           // dangling_ref handled elsewhere
      if (t.role === "setup" && !setupAt.has(t.ref)) setupAt.set(t.ref, i);
      if (t.role === "payoff" && !payoffAt.has(t.ref)) payoffAt.set(t.ref, { i, sceneId: s.id });
    }
  });
  const issues: DnaIssue[] = [];
  for (const [ref, pay] of payoffAt) {
    const su = setupAt.get(ref);
    if (su === undefined) issues.push({ rule: "unearned_payoff", severity: "warn", message: "scene pays a promise that was never set up", nodeId: pay.sceneId });
    else if (su > pay.i) issues.push({ rule: "misordered_payoff", severity: "error", message: "payoff precedes its setup in reading order", nodeId: pay.sceneId });
  }
  // Dangling: an accepted/locked thread set up but never paid by any scene.
  for (const th of nodes.filter((n) => n.kind === "thread" && (n.authoring.locked || n.authoring.status === "accepted"))) {
    if (setupAt.has(th.id) && !payoffAt.has(th.id)) issues.push({ rule: "dangling_promise", severity: "warn", message: "promise is set up but never paid off", nodeId: th.id });
  }
  return issues;
}

// ── Validation (§7) ───────────────────────────────────────────────────────────
export interface DnaIssue { rule: string; severity: "error" | "warn"; message: string; nodeId?: string }

/** Structural integrity (§3/§4): the tree SHAPE itself — is each node attached to the right kind of parent,
 *  and are the singletons singular. These are malformations (the entity-on-premise / duplicate-pillar class),
 *  not weak craft, so they're errors. Pure structure: no content, no order, no inputs. Designed to be
 *  false-positive-safe on partial trees — a node not yet attached (null parent, no pillar present) is "early",
 *  not "wrong"; only a parent that RESOLVES to the wrong kind, a dangling parent id, or a real duplicate fires. */
export function structuralLints(nodes: DnaNode[]): DnaIssue[] {
  const index = byId(nodes);
  const issues: DnaIssue[] = [];
  for (const n of nodes) {
    const want = PARENT_KIND[n.kind];
    if (want === null || !n.parent_id) continue;           // a root, or not yet attached — not a fault
    const parent = index.get(n.parent_id);
    if (!parent) issues.push({ rule: "orphan", severity: "error", message: `${n.kind} points at a missing parent`, nodeId: n.id });
    else if (parent.kind !== want) issues.push({ rule: "misparented", severity: "error", message: `${n.kind} hangs off ${parent.kind}, not ${want} — it'll be invisible to ${want}-scoped generation`, nodeId: n.id });
  }
  for (const kind of SINGLETON_KINDS) {
    const dupes = nodes.filter((n) => n.kind === kind);
    for (const d of dupes.slice(1)) issues.push({ rule: "duplicate_singleton", severity: "warn", message: `${dupes.length} ${kind} nodes — only one is canonical (the rest split or shadow it)`, nodeId: d.id });
  }
  return issues;
}

export function validate(nodes: DnaNode[]): DnaIssue[] {
  const index = byId(nodes);
  const issues: DnaIssue[] = structuralLints(nodes);

  for (const n of nodes) {
    // Ladder order: an accepted node whose parent isn't accepted jumped the gate.
    if (n.parent_id && n.authoring.status === "accepted") {
      const parent = index.get(n.parent_id);
      if (parent && !isEntityKind(n.kind) && parent.authoring.status !== "accepted") {
        issues.push({ rule: "ladder_order", severity: "warn", message: `${n.kind} accepted before its parent`, nodeId: n.id });
      }
    }
    // Dangling references.
    for (const ref of refsOf(n)) {
      if (!index.has(ref)) issues.push({ rule: "dangling_ref", severity: "error", message: `${n.kind} references a missing node`, nodeId: n.id });
    }
    if (n.kind === "scene") {
      const c = n.content as SceneContent;
      const hasContent = !!(c.goal || c.outcome || c.prose?.text);
      if (hasContent && !(c.value_shift && c.value_shift.from && c.value_shift.to)) {
        issues.push({ rule: "flat_scene", severity: "error", message: "scene has no value shift (flat 'and-then')", nodeId: n.id });
      }
    }
  }

  // Beat causality: every non-first beat in a act needs a therefore/but connector.
  for (const m of nodes.filter((n) => n.kind === "act")) {
    const beats = childrenOf(nodes, m.id).filter((b) => b.kind === "beat");
    beats.forEach((b, i) => {
      if (i === 0) return;
      const conn = (b.content as BeatContent).connector;
      if (conn !== "therefore" && conn !== "but") {
        issues.push({ rule: "beat_connector", severity: "warn", message: "beat lacks a therefore/but link to the prior beat", nodeId: b.id });
      }
    });
  }

  // Pinned tentpole with no placement.
  const placed = new Set(nodes.flatMap((n) => (n.kind === "scene" ? [(n.content as SceneContent).realizes_tentpole] : [])).filter(Boolean) as string[]);
  for (const t of nodes.filter((n) => n.kind === "tentpole" && (n.authoring.locked || n.authoring.status === "accepted"))) {
    if (!placed.has(t.id)) issues.push({ rule: "tentpole_unplaced", severity: "warn", message: "pinned tentpole is never realized by a scene", nodeId: t.id });
  }

  // Promises axis (§6): dangling / unearned / misordered payoffs.
  issues.push(...promiseLints(nodes));

  // Causality axis (why): hollow `therefore` (unmet need) / empty `but` (turns nothing).
  issues.push(...causalityLints(nodes));

  // Meters axis (docs/novel-dna-meters.md): flat / monotone / no-jeopardy on a tracked axis.
  issues.push(...meterLints(nodes));

  // Grounding: the resolution must fire an established world rule (no deus ex machina — Lester Dent's law).
  // When the world has rules, the last scene in reading order should ground its win in at least one.
  const worldFacts = nodes.filter((n) => n.kind === "world_fact");
  const sceneSeq = scenesInOrder(nodes);
  if (worldFacts.length && sceneSeq.length) {
    const last = sceneSeq[sceneSeq.length - 1];
    const g = (last.content as SceneContent).grounds_in;
    if (!Array.isArray(g) || !g.length) {
      issues.push({ rule: "ungrounded_climax", severity: "warn", message: "the resolution scene's win isn't grounded in any world rule (risk of deus ex machina)", nodeId: last.id });
    }
  }

  // Pacing axis (§6): a act's turning point drifting off its authored target_pct.
  for (const p of pacing(nodes)) {
    if (typeof p.targetPct === "number" && Math.abs(p.driftPct) > PACING_DRIFT_TOL) {
      issues.push({ rule: "pacing_drift", severity: "warn", message: `act turn lands at ${Math.round(p.actualPct * 100)}% (target ${Math.round(p.targetPct * 100)}%)`, nodeId: p.actId });
    }
  }

  // Game pillar (docs/novel-dna-games.md §5): a game is a real possibility space (win AND lose), and a
  // played game must resolve. Coupling is OPTIONAL — single-game stories are valid; not having couples is
  // never a fault.
  const games = nodes.filter((n) => n.kind === "game");
  if (games.length) {
    // games referenced as played / resolved anywhere on the spine
    const played = new Set<string>(), resolved = new Set<string>();
    for (const n of nodes) {
      if (n.kind !== "beat" && n.kind !== "scene") continue;
      const c = n.content as BeatContent & SceneContent;
      for (const p of (c.plays ?? [])) played.add(p);
      for (const r of (c.resolves ?? [])) if (r.ref) resolved.add(r.ref);
    }
    for (const g of games) {
      const c = g.content as GameContent;
      // The core discipline: a genuine possibility space needs BOTH poles — you can't win if you can't lose.
      if (!c.win_condition?.trim() || !c.lose_condition?.trim()) {
        issues.push({ rule: "halfopen_game", severity: "warn", message: "game lacks a win or lose condition — no real possibility space (you can't win if you can't lose)", nodeId: g.id });
      }
      if (played.has(g.id) && !resolved.has(g.id)) {
        issues.push({ rule: "unresolved_game", severity: "warn", message: "game is played but never resolved (won/lost) — a dangling contest", nodeId: g.id });
      }
      if (!(c.governing_rules ?? []).length && nodes.some((n) => n.kind === "world_fact")) {
        issues.push({ rule: "ungrounded_game", severity: "warn", message: "game's win isn't bound to any world rule (governing_rules empty)", nodeId: g.id });
      }
    }

    // [EXP:preconditions] — a resolved game's STATE preconditions must be ESTABLISHED by an EARLIER beat
    // (you can't spend a resource you never acquired). Beats in reading order; a state key whose first
    // `establishes` is not strictly before the resolving beat = an illegal move (the "unearned resource" bug).
    if (EXP_PRECONDITIONS) {
      const beatOrder = beatsInOrder(nodes);
      const orderOf = new Map(beatOrder.map((b, i) => [b.id, i]));
      const establishedAt = new Map<string, number>(); // key → earliest beat index that establishes it
      beatOrder.forEach((b, i) => { for (const k of ((b.content as BeatContent).establishes ?? [])) if (!establishedAt.has(k)) establishedAt.set(k, i); });
      for (const g of games) {
        const stateKeys = ((g.content as GameContent).win_requires ?? []).filter((r) => r.type === "state" && r.key).map((r) => r.key as string);
        if (!stateKeys.length) continue;
        const resolver = beatOrder.find((b) => ((b.content as BeatContent).resolves ?? []).some((r) => r.ref === g.id));
        if (!resolver) continue; // unresolved is its own lint
        const resolveIdx = orderOf.get(resolver.id)!;
        for (const key of stateKeys) {
          const at = establishedAt.get(key);
          if (at === undefined || at >= resolveIdx) {
            issues.push({ rule: "illegal_resolution", severity: "warn", message: `the win spends "${key}" but it was never established before the resolving turn (unearned resource)`, nodeId: g.id });
          }
        }
      }
    }
  }

  // Emotional-topography axis (§6): a run of ≥SAGGING_RUN same-polarity scenes = a sagging middle.
  const topo = topography(nodes);
  for (let i = 0; i < topo.length; ) {
    const pol = topo[i].polarity;
    if (pol == null) { i++; continue; }
    let j = i;
    while (j < topo.length && topo[j].polarity === pol) j++;
    if (j - i >= SAGGING_RUN) issues.push({ rule: "sagging_middle", severity: "warn", message: `${j - i} scenes in a row stay ${pol} — flat emotional charge`, nodeId: topo[i].sceneId });
    i = j;
  }

  // Continuity ledger (docs/true-agent.md Step 3): contradictions the read recorded on a scene's prose vs the
  // canon established before it. Pure — surfaces the stored flags so the editor handoff reuses this filter.
  for (const s of nodes.filter((n) => n.kind === "scene")) {
    for (const f of ((s.content as SceneContent).continuity_flags ?? [])) {
      issues.push({ rule: "continuity_break", severity: "error", nodeId: s.id,
        message: `prose contradicts established canon — "${f.key}" was "${f.was}", now "${f.now}"${f.note ? ` (${f.note})` : ""}` });
    }
  }
  return issues;
}

// ── State-key canonicalization (§3c) ─────────────────────────────────────────
// `needs`/`establishes` are an OPEN snake_case vocabulary, so a typo or a plural silently SPLITS the causal
// DAG — `redemption_fund` and `redemption_funds` read as two separate facts, and a beat that needs one while
// an earlier beat establishes the other looks "uncaused" (the redemption_fund incident). Snap a key to a
// near-duplicate already in use so the two collapse into one.
function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  let cur = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

/** Snap an open-vocabulary state key to a near-duplicate already in `known` (a plural/typo split of the same
 *  concept), so the causal DAG doesn't fork on two spellings. Exact match, or nothing close → returns the key
 *  unchanged. Conservative (edit-distance ≤ 2 AND min length ≥ 6) so genuinely distinct keys — which differ by
 *  whole words, i.e. a large distance — are never merged. First-seen spelling wins as canonical. */
export function canonicalizeKey(key: string, known: Iterable<string>): string {
  const k = key.trim();
  if (!k) return k;
  let best = k, bestD = Infinity;
  for (const cand of known) {
    if (cand === k) return k;
    if (Math.abs(cand.length - k.length) > 2 || Math.min(cand.length, k.length) < 6) continue;
    const d = editDistance(k, cand);
    if (d <= 2 && d < bestD) { best = cand; bestD = d; }
  }
  return best;
}

// ── Render completeness (§7) ──────────────────────────────────────────────────
export interface BookSettings { title?: string; author?: string; word_target?: number; mode?: "prose" | "picture" }

/** Can the book render at gold completeness? Returns the blocking reasons (empty = renderable). In picture
 *  mode (docs/picture-book-mode.md) the per-scene requirement is an image, not prose; word_target doesn't apply. */
export function renderBlockers(nodes: DnaNode[], settings: BookSettings): string[] {
  const picture = settings.mode === "picture";
  const blockers: string[] = [];
  if (!settings.title?.trim()) blockers.push("no book title");
  if (!settings.author?.trim()) blockers.push("no author");
  if (!picture && !settings.word_target) blockers.push("no word_target in the mandate");

  const scenes = scenesInOrder(nodes);
  if (!scenes.length) { blockers.push("no scenes yet"); return blockers; }

  const unwritten = scenes.filter((s) => {
    const c = s.content as SceneContent;
    const done = picture ? !!c.image_url?.trim() : !!c.prose?.text?.trim();
    return !(done && s.authoring.status === "accepted");
  });
  if (unwritten.length) blockers.push(`${unwritten.length} scene(s) ${picture ? "without an illustration" : "without accepted prose"}`);
  return blockers;
}

export const isRenderable = (nodes: DnaNode[], settings: BookSettings): boolean => renderBlockers(nodes, settings).length === 0;

/** A fresh node slot in the requested status (the "hungry" empty slot the UI fills). */
export function emptyNode(book_id: number, kind: NodeKind, level: number, parent_id: string | null, position = 0): DnaNode {
  return { id: newId(), book_id, parent_id, level, kind, position, content: {}, authoring: { source: "user", locked: false, status: "empty" } };
}

// ── Game twins (docs/dna-structure-analysis.md Finding 2) ──────────────────────
// One dramatic tension is triple-encoded — the game (the contest), its game_score METER (the plottable
// trajectory), and the THREAD that promises its resolution. Rather than ask the author/agent to create and
// align all three by hand, we DERIVE the two views from the game: a code-enforced invariant, denormalization
// done honestly. Both twins carry `owner = game.id` so reconciliation is idempotent (mint only when missing).
// Pure — content only; the caller mints ids / positions / persists (see reconcileGameTwins).
export function gameTwins(game: DnaNode): { meter: MeterContent; thread: ThreadContent } {
  const g = game.content as GameContent;
  const name = (g.name ?? "").trim() || "the contest";
  return {
    meter: {
      name: `${name} — score`, kind: "game_score", owner: game.id,
      poles: { low: g.lose_condition, high: g.win_condition },
    },
    thread: {
      name: `${name} — resolution`, kind: "setup_payoff", owner: game.id,
      promise: g.stake ? `${name} is joined; ${g.stake} is on the line.` : `${name} is joined and must be decided.`,
      payoff: g.win_condition ? `${name} resolves: ${g.win_condition} — or it is lost.` : `${name} resolves, won or lost.`,
    },
  };
}
