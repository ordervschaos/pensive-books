// novel-dna — EDGE TWIN of apps/web/src/features/dna/lib/novelDna.ts (the pure Novel DNA engine).
//
// This file MUST stay behaviourally identical to the web copy: the same `validate()` lints and objective
// derivation the browser computes are re-derived here so the server agent (book-agent/threadSystem) can
// SENSE the live tree each chain link instead of dead-reckoning from a stale snapshot
// (docs/agent-improvement-plan.md P1.1). The module is PURE (in-memory node arrays; no DB/LLM/DOM), so the
// only cross-runtime dependency is metaHash — served here by the edge twin ./plan-provenance.ts, whose
// cyrb53 is byte-for-byte identical to the browser's. Parity is LOCKED by a test that runs both copies over
// the same fixtures: apps/web/src/features/dna/lib/novelDna.parity.test.ts. Edit the web copy → the test
// fails until you mirror the change here.
import { metaHash } from "./plan-provenance.ts";

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

export type AuthoringSource = "user" | "ai" | "ai_then_user";
export type AuthoringStatus = "empty" | "proposed" | "draft" | "accepted";

export interface Authoring {
  source: AuthoringSource;
  locked: boolean;
  status: AuthoringStatus;
  src_hash?: string; // hash of this node's INPUT SET when last generated/accepted
  prose_src_hash?: string; // scenes — hash of the scene plan the prose was written from
  sketch_src_hash?: string; // scenes — hash of the scene spec the SKETCH was written from
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
export interface PremiseContent {
  genre?: string[]; tone?: string[]; dramatic_question?: string;
  shape?: { name?: string; movements?: string[]; ending_feel?: "up" | "down" | "bittersweet" | "ambivalent" };
  // THE SHAPE READ (doc_1783113903000_shape_read_spec.md): a paid semantic verdict — do the acts DELIVER each
  // movement the premise promised? Written by read-shape onto the level that made the promise (the premise),
  // parallel to how the meter read writes observed_readings onto beats. Output data, never authored (kept out of
  // dnaSchema FIELDS + stripped from input hashing via OUTPUT_FIELDS). The acts→movements mapping is INFERRED by
  // the read (acts carry no movement ref) and returned as data (actIds). observed_shape_hash is the staleness seal.
  observed_shape_fit?: { movement: number; actIds: string[]; fit: number; worst?: string; note?: string }[];
  observed_shape_hash?: string;
}
export interface PillarContent {
  controlling_idea?: string; ending?: string;
  // THE SYNOPSIS READ (W2, doc_1783192600000_dna_build_plan.md): a paid craft verdict over the PLAN plane
  // (premise + pillar + acts + beats, zero prose) — the shift-left "editor's read", written by read-synopsis
  // onto the pillar (the level that owns the whole plan), parallel to observed_shape_fit on the premise.
  // Output data, never authored (kept out of dnaSchema FIELDS + stripped from input hashing via OUTPUT_FIELDS).
  // axis ∈ boredom_risk/predictability/genre_feel/stakes_clarity; worst = the beat most responsible for a low
  // score. observed_craft_hash is the staleness seal.
  observed_craft?: { axis: string; score: number; note?: string; worst?: string }[];
  observed_craft_hash?: string;
}
// target_pct: where this act's turning_point should land in the book (0–1) — the pacing intent (§6).
// value = the act's MACRO shift; schema keys it `name` (scene ValueShift keys it `value`). polarity = the
// machine-readable trend (where the value ENDS across the act) — what act_value_undelivered checks.
export interface ActContent { title?: string; goal?: string; turning_point?: string; target_pct?: number; value?: { name?: string; from?: string; to?: string; polarity?: "up" | "down" } }
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
// entity (Phase-1 grounding, docs/scene-ledger.md §1): the DNA node id this fact is ABOUT (`n_…`), set when the
// fact concerns a known registry entity — the join key that lets observed state meet the plan side (advances[].ref,
// ThreadRef, scene.loc) key-by-key. ADDITIVE: a fact never loses its free `key`; a non-entity fact just omits `entity`.
export interface LedgerFact { key: string; value: string; note?: string; entity?: string }
// A continuity break the read found in a scene's prose vs the canon established before it (was → now).
export interface ContinuityFlag { key: string; was: string; now: string; note?: string }
// A confusion the cold-reader read found in a scene's prose — something a reader who knows ONLY what the
// book has shown so far couldn't follow (who is speaking / where are we / when / why / what's referenced).
// Output of the read (read-confusion), never authored — the affective twin of ContinuityFlag.
export interface ConfusionFlag { kind?: "who" | "where" | "when" | "why" | "reference"; note?: string }
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
// The scene TREATMENT (doc_1783196400000_dna_scene_sketch_layer.md, doc_1783198900000_dna_scene_direction.md):
// the low-res plan between the scene's contract (goal/conflict/outcome) and its prose. `moves` are WHAT
// happens (never dialogue lines — direction says HOW, not WHAT's said); `direction` is HOW it's shown.
export interface SketchMove { what: string; thread?: string; sense?: string }
export type SketchDistance = "far" | "mid" | "close" | "deep"; // psychic distance (Gardner)
export type SketchMode = "dialogue" | "action" | "interior" | "description" | "summary";
export type SketchTime = "real" | "compressed" | "stretched";
export type SketchTension = "suspense" | "mystery" | "irony";
export interface SketchDirection { cut?: { in?: string; out?: string }; distance?: SketchDistance; mode?: SketchMode; time?: SketchTime; tension?: SketchTension }
export interface SceneSketch { opening?: string; moves?: SketchMove[]; exit?: string; direction?: SketchDirection }
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
  sketch?: SceneSketch;                // TREATMENT: what/how this page renders — generated before prose (dna-expand target='sketch')
  observed_establishes?: LedgerFact[]; // CONTINUITY: key→value facts this scene's prose asserted (the ledger delta)
  continuity_flags?: ContinuityFlag[]; // CONTINUITY: breaks the read found here vs prior canon (output, not plan input)
  confusion_flags?: ConfusionFlag[];   // COLD READER: what a reader-so-far couldn't follow here (output, not plan input)
  chapter_start?: ChapterStart | null;
  prose?: { text?: string; words?: number };
}
// tag = the physical/visual tag (a character-appearance descriptor).
export interface CharacterContent { name?: string; role?: "protagonist" | "antagonist" | "ally" | "love_interest" | "minor"; want?: string; need?: string; wound?: string; lie?: string; truth?: string; idiolect?: string; tag?: string }
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
// A chapter → a SECTION page (title) + a TEXT page (its scenes' prose, concatenated). Pure: the DB reconcile
// (novelDnaRender.reconcileDna) applies this list to `pages`. nodeId is the stable page key.
export interface RenderedPage { nodeId: string; kind: "section" | "text"; title: string; proseText: string }
export function renderPages(nodes: DnaNode[]): RenderedPage[] {
  const index = byId(nodes);
  const out: RenderedPage[] = [];
  for (const ch of chapters(nodes)) {
    const key = ch.sceneIds[0] ?? `i${ch.index}`; // first scene id is the chapter's stable boundary key
    out.push({ nodeId: `ch:${key}`, kind: "section", title: ch.title, proseText: "" });
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
// that hash this content. Mirrors how the prose hash already excludes prose.
const OUTPUT_FIELDS = ["prose", "observed_readings", "observed_establishes", "continuity_flags", "confusion_flags", "observed_shape_fit", "observed_shape_hash", "observed_craft", "observed_craft_hash"] as const;
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
  // observed_establishes/continuity_flags are OUTPUTS of the read, not inputs.
  const { prose: _p, observed_establishes: _oe, continuity_flags: _cf, ...plan } = c;
  return scene.authoring.prose_src_hash !== metaHash(stableStringify(plan));
}

/** Stamp a node's input hash (call when it's generated/accepted from its current inputs). */
export function stampInput(node: DnaNode, index: Map<string, DnaNode>): DnaNode {
  return { ...node, authoring: { ...node.authoring, src_hash: inputHash(node, index) } };
}
/** Stamp a scene's prose hash (call after prose is written from the current plan). */
export function stampProse(scene: DnaNode): DnaNode {
  const { prose: _p, observed_establishes: _oe, continuity_flags: _cf, ...plan } = scene.content as SceneContent;
  return { ...scene, authoring: { ...scene.authoring, prose_src_hash: metaHash(stableStringify(plan)) } };
}

/** The scene's SPEC — its content minus the sketch itself and every OUTPUT field — the input set the sketch
 *  is generated from. Shared by isSketchStale/stampSketch so the two can never drift on what "spec" means. */
function sketchInputPlan(c: SceneContent): Record<string, unknown> {
  const { sketch: _sk, prose: _p, observed_establishes: _oe, continuity_flags: _cf, confusion_flags: _cnf, ...plan } = c;
  return plan;
}
/** Scene sketch is stale iff the scene's spec changed since the sketch was written. Because `prose_src_hash`
 *  hashes the WHOLE plan (sketch included), editing the sketch — or the spec beneath it — already staleness-
 *  invalidates the prose for free; this only needs to guard the sketch's OWN input (the spec, minus itself). */
export function isSketchStale(scene: DnaNode): boolean {
  const c = scene.content as SceneContent;
  if (!c.sketch || !scene.authoring.sketch_src_hash) return false;
  return scene.authoring.sketch_src_hash !== metaHash(stableStringify(sketchInputPlan(c)));
}
/** Stamp a scene's sketch hash (call after the sketch is written from the current spec). */
export function stampSketch(scene: DnaNode): DnaNode {
  return { ...scene, authoring: { ...scene.authoring, sketch_src_hash: metaHash(stableStringify(sketchInputPlan(scene.content as SceneContent))) } };
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

// ── Lint configuration (the linter's ".eslintrc") ─────────────────────────────
// Every craft threshold in one bag so GENRE can parameterize strictness instead of one-size-fits-all —
// a thriller's sagging middle is shorter than a literary novel's. validate()/analysisText() take an
// optional config; DEFAULT_LINT_CONFIG preserves the historical values so every existing caller is
// unchanged. Callers that hold the brief derive a preset via lintConfigForBrief.
export interface LintConfig {
  pacingDriftTol: number;       // an act turn this far (fraction) off its target_pct = drift
  saggingRun: number;           // ≥N consecutive same-polarity scenes = a sagging middle
  meterFlatRun: number;         // ≥N consecutive ~equal readings on a meter = a dead stretch on that axis
  meterMinOsc: number;          // a meter that changes direction fewer times over its life reads monotone
  meterPoleBand: number;        // a game_score must come within this fraction of its losing pole or there's no jeopardy
  meterTargetDriftBand: number; // the PLAN's readings may sit within this fraction of scale of the INTENDED target curve
  meterReadGapBand: number;     // the prose-OBSERVED reading may sit within this fraction of scale of the PLANNED reading
  sceneRefineBand: number;      // a scene's explicit reading may sit within this fraction of scale of its beat's
  // W3 — the deterministic prose linter (proseLints; only scenes WITH prose are ever judged):
  proseEchoAdjacent: number;    // ≥N shared distinctive 5-grams with the PREVIOUS scene = an echo
  proseEchoDistant: number;     // ≥N shared distinctive 5-grams with any NON-adjacent earlier scene = an echo
  rhythmMinSentences: number;   // a scene needs at least this many real sentences before cadence is judged
  rhythmCvFloor: number;        // sentence-length coefficient of variation below this = monotone rhythm
  nameDensityCeiling: number;   // character-name mentions per 100 words above this = name soup
  dialogueRunLen: number;       // ≥N consecutive prose scenes all ≥90% (or all ≤10%) dialogue = a flatline
}
export const DEFAULT_LINT_CONFIG: LintConfig = {
  pacingDriftTol: 0.1, saggingRun: 4, meterFlatRun: 4, meterMinOsc: 2,
  meterPoleBand: 0.15, meterTargetDriftBand: 0.2, meterReadGapBand: 0.2, sceneRefineBand: 0.2,
  proseEchoAdjacent: 1, proseEchoDistant: 2, rhythmMinSentences: 8, rhythmCvFloor: 0.3,
  nameDensityCeiling: 8, dialogueRunLen: 3,
};
// Genre presets, matched by keyword over the brief's free-text genre. Taut genres tolerate shorter flat
// stretches; interior genres allow longer ones and don't demand oscillation. An unrecognized genre gets
// the defaults — never stricter by accident.
const TAUT_GENRES = ["thriller", "mystery", "suspense", "horror", "action", "crime", "heist"];
const INTERIOR_GENRES = ["literary", "character study", "slice of life", "slice-of-life", "memoir", "quiet"];
export function lintConfigForBrief(brief?: { genre?: string | string[] | null } | null): LintConfig {
  const g = (Array.isArray(brief?.genre) ? brief.genre.join(" ") : brief?.genre ?? "").toLowerCase();
  if (TAUT_GENRES.some((k) => g.includes(k))) return { ...DEFAULT_LINT_CONFIG, saggingRun: 3, meterFlatRun: 3 };
  if (INTERIOR_GENRES.some((k) => g.includes(k))) return { ...DEFAULT_LINT_CONFIG, saggingRun: 5, meterFlatRun: 5, meterMinOsc: 1 };
  return DEFAULT_LINT_CONFIG;
}

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

// ── OBLIGATIONS (the debt ledger — promise → progress → payoff, unified) ──────
// First-principles model (doc_1783287744842_promise_debt_completion.md): a book is a ledger of promises —
// every axis OPENS debts (a thread set up, a game played, a state key spent, a tentpole pinned, an entity
// introduced) and the book is DONE when every debt is paid or deliberately waived (a sequel hook). This
// re-projects the per-axis signals the lints already compute into ONE typed table, so the completion
// predicate — and later the driver's endgame objective — reads "the remaining debt" in one place.
//   unopened — promised in the registry, never reaches the page  → outstanding
//   open     — live on the page, not yet paid                    → outstanding
//   closed   — paid (payoff / resolved / established / placed / appeared)
//   waived   — deliberate carry-over: `content.waived === true` (nothing writes it yet; read here so the
//              state machine is total before the waive gesture ships)
// Spine note: thread/tentpole/entity_intro indices are scenesInOrder positions (render plane, like
// promiseLints); state_key indices are beatsInOrder positions (plan plane, like causality). Indices compare
// within a kind only. NOT rows in v1 (fuzzy closure — need schema refs first): the contract meter (the
// vertical-fit lints own target-curve delivery) and the dramatic question (needs an explicit answering ref).
export type ObligationKind = "thread" | "game" | "state_key" | "tentpole" | "entity_intro";
export type ObligationState = "unopened" | "open" | "closed" | "waived";
export interface Obligation {
  id: string;                  // `<kind>:<ref>` — unique row key
  ref: string;                 // the node id (or bare state key) the debt concerns
  kind: ObligationKind;
  name: string;
  promise: string;             // what the reader was promised, human-readable
  state: ObligationState;
  openedAt: number | null;     // spine index where the debt went live (null = opened by the registry itself)
  closedAt: number | null;     // spine index where it was paid
  touches: number;             // service events (advances / plays / appearances) — the "progress" P
  // READER PRESSURE: turns since the debt was last serviced, to the end of ITS spine (scenes for threads,
  // beats for games/state keys) — the debt "accruing interest". Only meaningful while open; null otherwise.
  quiet: number | null;
}

const pinnedOrAccepted = (n: DnaNode): boolean => n.authoring.locked || n.authoring.status === "accepted";
const isWaived = (n: DnaNode): boolean => (n.content as { waived?: unknown }).waived === true;

export function obligationLedger(nodes: DnaNode[]): Obligation[] {
  const out: Obligation[] = [];
  const scenes = scenesInOrder(nodes);

  // THREADS — the canonical promise: opens at its first scene `setup`, pays at the first `payoff` at/after
  // it (a payoff with no prior setup settles nothing — unearned_payoff flags that anomaly). `advance` = progress.
  for (const t of nodes.filter((n) => n.kind === "thread" && pinnedOrAccepted(n))) {
    const c = t.content as ThreadContent;
    let openedAt: number | null = null, closedAt: number | null = null, touches = 0, last: number | null = null;
    scenes.forEach((s, i) => {
      for (const r of ((s.content as SceneContent).threads ?? [])) {
        if (r.ref !== t.id) continue;
        last = i;
        if (r.role === "setup" && openedAt === null) openedAt = i;
        if (r.role === "advance") touches++;
        if (r.role === "payoff" && openedAt !== null && closedAt === null) closedAt = i;
      }
    });
    const state: ObligationState = isWaived(t) ? "waived" : closedAt !== null ? "closed" : openedAt !== null ? "open" : "unopened";
    out.push({ id: `thread:${t.id}`, ref: t.id, kind: "thread", name: c.name ?? t.id, promise: c.promise ?? "",
      state, openedAt, closedAt, touches,
      quiet: state === "open" && last !== null ? scenes.length - 1 - last : null });
  }

  // GAMES — accepting a contest promises the reader a DECISION: `plays` opens it, `resolves` pays it.
  // State scans beats AND scenes (like the unresolved_game lint); indices are beat-spine best-effort
  // (scenes inherit their beat's plays/resolves). touches counts every turn that plays it, both planes.
  const beats = beatsInOrder(nodes);
  const playedAt = new Map<string, number>(), resolvedAt = new Map<string, number>(), lastPlayAt = new Map<string, number>();
  beats.forEach((b, i) => {
    const c = b.content as BeatContent;
    for (const p of (c.plays ?? [])) if (p) { if (!playedAt.has(p)) playedAt.set(p, i); lastPlayAt.set(p, i); }
    for (const r of (c.resolves ?? [])) if (r.ref) { if (!resolvedAt.has(r.ref)) resolvedAt.set(r.ref, i); lastPlayAt.set(r.ref, i); }
  });
  const played = new Set<string>(), resolved = new Set<string>(), playCount = new Map<string, number>();
  for (const n of nodes) {
    if (n.kind !== "beat" && n.kind !== "scene") continue;
    const c = n.content as BeatContent & SceneContent;
    for (const p of (c.plays ?? [])) if (p) { played.add(p); playCount.set(p, (playCount.get(p) ?? 0) + 1); }
    for (const r of (c.resolves ?? [])) if (r.ref) resolved.add(r.ref);
  }
  for (const g of nodes.filter((n) => n.kind === "game" && pinnedOrAccepted(n))) {
    const c = g.content as GameContent;
    const state: ObligationState = isWaived(g) ? "waived" : resolved.has(g.id) ? "closed" : played.has(g.id) ? "open" : "unopened";
    const last = lastPlayAt.get(g.id);
    out.push({ id: `game:${g.id}`, ref: g.id, kind: "game", name: c.name ?? g.id,
      promise: c.stake ?? c.win_condition ?? "",
      state, openedAt: playedAt.get(g.id) ?? null, closedAt: resolvedAt.get(g.id) ?? null,
      touches: playCount.get(g.id) ?? 0,
      quiet: state === "open" && last !== undefined ? beats.length - 1 - last : null });
  }

  // STATE KEYS — the causality axis as debt, with the direction INVERTED: a `needs` is a withdrawal that an
  // EARLIER beat's `establishes` must already have deposited, so a healthy key closes (deposit) BEFORE it
  // opens (first spend). One row per key ever needed; open while any need is unmet upstream.
  const rows = causality(nodes);
  const neededAt = new Map<string, number>(), producedAtIdx = new Map<string, number>(), needCount = new Map<string, number>();
  const lastMention = new Map<string, number>(), unmetKeys = new Set<string>();
  for (const r of rows) {
    for (const k of r.needs) { if (!neededAt.has(k)) neededAt.set(k, r.idx); needCount.set(k, (needCount.get(k) ?? 0) + 1); lastMention.set(k, r.idx); }
    for (const k of r.unmet) unmetKeys.add(k);
    for (const k of r.produces) { if (!producedAtIdx.has(k)) producedAtIdx.set(k, r.idx); lastMention.set(k, r.idx); }
  }
  for (const [key, at] of neededAt) {
    const state: ObligationState = unmetKeys.has(key) ? "open" : "closed";
    const last = lastMention.get(key);
    out.push({ id: `state_key:${key}`, ref: key, kind: "state_key", name: key,
      promise: `"${key}" is earned before it is spent`,
      state, openedAt: at, closedAt: producedAtIdx.get(key) ?? null, touches: needCount.get(key) ?? 0,
      quiet: state === "open" && last !== undefined ? rows.length - 1 - last : null });
  }

  // TENTPOLES — a pinned set-piece is a registry promise, paid when a scene realizes it (tentpole_unplaced
  // as a debt row). Single-event: unopened → closed, no open middle.
  const placedAt = new Map<string, number>();
  scenes.forEach((s, i) => { const r = (s.content as SceneContent).realizes_tentpole; if (r && !placedAt.has(r)) placedAt.set(r, i); });
  for (const t of nodes.filter((n) => n.kind === "tentpole" && pinnedOrAccepted(n))) {
    const c = t.content as TentpoleContent;
    const at = placedAt.get(t.id) ?? null;
    out.push({ id: `tentpole:${t.id}`, ref: t.id, kind: "tentpole", name: c.summary ?? t.id, promise: c.summary ?? "",
      state: isWaived(t) ? "waived" : at !== null ? "closed" : "unopened",
      openedAt: null, closedAt: at, touches: at !== null ? 1 : 0, quiet: null });
  }

  // ENTITY INTROS — the new axis: accepting a character/location promises the reader will MEET it. PRIMARY
  // signal: structured refs (character: pov/present; location: scene.loc as a node id). FALLBACK, checked only
  // when the ref is absent: the generator doesn't actually populate pov/present today (confirmed against a
  // live 80-scene book — every character read "unopened" despite Mara being on nearly every page), so a
  // structured-ref-only check would hold EVERY real book's debt gate open forever. A character counts as met
  // if their first name appears in the scene's drafted PROSE (the same token-match name_soup already uses);
  // a location counts as visited if its free-text `loc` name matches (the same tolerance dangling_ref gives
  // legacy string locs). Both fallbacks only fire on scenes that already have prose/loc text — an undrafted,
  // unlocated scene can't accidentally satisfy this by absence.
  for (const e of nodes.filter((n) => (n.kind === "character" || n.kind === "location") && pinnedOrAccepted(n))) {
    const name = String((e.content as { name?: unknown }).name ?? e.id);
    const firstNameToken = e.kind === "character" ? name.trim().split(/\s+/)[0]?.toLowerCase() : undefined;
    let first: number | null = null, touches = 0;
    scenes.forEach((s, i) => {
      const c = s.content as SceneContent;
      let hit: boolean;
      if (e.kind === "character") {
        hit = c.pov === e.id || (c.present ?? []).includes(e.id);
        if (!hit && firstNameToken) {
          const prose = c.prose?.text;
          if (prose) hit = facetWords(prose).some((t) => t.replace(/'.*$/, "") === firstNameToken);
        }
      } else {
        hit = c.loc === e.id || (!!c.loc && c.loc.trim().toLowerCase() === name.trim().toLowerCase());
      }
      if (!hit) return;
      touches++;
      if (first === null) first = i;
    });
    out.push({ id: `entity_intro:${e.id}`, ref: e.id, kind: "entity_intro", name,
      promise: e.kind === "character" ? `the reader meets ${name}` : `the reader visits ${name}`,
      state: isWaived(e) ? "waived" : first !== null ? "closed" : "unopened",
      openedAt: null, closedAt: first, touches, quiet: null });
  }

  return out;
}

/** The outstanding debt: obligations not yet settled. `unopened` counts — a registry promise that never
 *  reaches the page is still owed (plant it, waive it, or delete the node). PRESSURE-ORDERED: on-page (open)
 *  debts first, stalest first (`quiet` desc — the promise the reader has held longest without a touch);
 *  registry-only (unopened) debts follow in ledger order. Sort is stable, so ties keep the ledger's grouping. */
export function openObligations(nodes: DnaNode[]): Obligation[] {
  return obligationLedger(nodes)
    .filter((o) => o.state === "unopened" || o.state === "open")
    .sort((a, b) => (a.state === "open" ? 0 : 1) - (b.state === "open" ? 0 : 1) || (b.quiet ?? -1) - (a.quiet ?? -1));
}

/** THE COMPLETION PREDICATE (debt-based done): the book is finished when every promise is paid or waived —
 *  not when a count fills. What the journey's final gate and the driver's endgame loop will read. */
export const debtSettled = (nodes: DnaNode[]): boolean => openObligations(nodes).length === 0;

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
function meterLints(nodes: DnaNode[], cfg: LintConfig): DnaIssue[] {
  const issues: DnaIssue[] = [];
  for (const m of nodes.filter((n) => n.kind === "meter")) {
    const c = m.content as MeterContent;
    const series = meterSeries(nodes, m.id);
    const s = meterShape(series);
    if (s.last == null) continue; // no readings yet — "early", not "wrong" (mirror the other axes)
    if (s.flatRun >= cfg.meterFlatRun) {
      issues.push({ rule: "flat_meter", severity: "warn", nodeId: m.id, message: `"${c.name ?? m.id}" holds flat for ${s.flatRun} beats — nothing moves on this axis` });
    }
    if (s.oscillations < cfg.meterMinOsc && series.filter((p) => p.value != null).length >= cfg.meterFlatRun) {
      issues.push({ rule: "no_oscillation", severity: "warn", nodeId: m.id, message: `"${c.name ?? m.id}" barely changes direction — monotone charge` });
    }
    if (c.kind === "game_score") {
      const min = c.scale?.min ?? 0, max = c.scale?.max ?? 100;
      const lowBand = min + (max - min) * cfg.meterPoleBand;
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
      if (gap.maxAbs > cfg.meterTargetDriftBand * span) {
        const worst = gap.perBeat.find((r) => r.id === gap.worstBeatId);
        issues.push({ rule: "target_drift", severity: "warn", nodeId: m.id,
          message: `"${c.name ?? m.id}" planned readings drift from the target curve by up to ${Math.round(gap.maxAbs)}${worst ? ` (beat ${worst.idx + 1}: plan ${worst.planned} vs target ${Math.round(worst.target)})` : ""} — the beat sheet isn't aiming at the intended shape` });
      }
    }
    // The OBSERVED vs the PLAN (the verify loop): once the editor's read has populated observed_readings, a
    // beat whose prose departs from its planned reading by more than the band = the prose underdelivers the plan.
    if (span > 0 && observedSeries(nodes, m.id).some((p) => p.value != null)) {
      const gap = observedGap(nodes, m.id);
      if (gap.maxAbs > cfg.meterReadGapBand * span) {
        const worst = gap.perBeat.find((r) => r.id === gap.worstBeatId);
        issues.push({ rule: "read_gap", severity: "warn", nodeId: m.id,
          message: `"${c.name ?? m.id}" reads off-plan by up to ${Math.round(gap.maxAbs)}${worst ? ` (beat ${worst.idx + 1}: prose ${worst.observed} vs planned ${worst.planned})` : ""} — the prose doesn't deliver the planned level` });
      }
    }
  }
  return issues;
}

// ── VERTICAL FIT (the timeline layer — doc_1783103754000_timeline_layer.md) ──────────────────────────────
// The ladder states the same trajectory at several zooms (premise shape → acts → beats → scenes). The lints
// above check consistency WITHIN a level (horizontal); these check that each finer level faithfully REFINES
// the one above it. Existing members of the family live elsewhere: pacing_drift (act intent ↔ scene reality),
// target_drift (meter intent ↔ beat plan), read_gap (beat plan ↔ prose observed). All fire conservatively —
// a missing level, polarity, or scale is "early", not "wrong". `movements` free text is never interpreted;
// only counts and enums cross levels (a movement's valence isn't machine-readable, so no shape-curve lint).
// (the scene↔beat refine band now lives on LintConfig.sceneRefineBand)

// ── THE SHAPE READ input + seal (doc_1783113903000_shape_read_spec.md) ───────────────────────────────────
// The paid, semantic half of vertical fit. read-shape (edge fn) is LLM-as-SENSOR — it reads the plan text and
// writes a per-movement verdict onto premise.observed_shape_fit; the movement_unfit lint below is the pure JUDGE
// (thresholds live here, not the prompt). buildShapeReadInput assembles the read's input from the live tree;
// shapeReadHash seals it. Both are shared by the client (which sends the input + stamps the seal) AND the lint
// (which recomputes the seal off the tree to tell a FRESH verdict from a STALE one — the dirty-graph idea, § seal).
export interface ShapeReadAct { actId: string; title?: string; goal?: string; turningPoint?: string; beats: { beatId: string; summary: string }[] }
export interface ShapeReadInput { movements: string[]; endingFeel?: string; acts: ShapeReadAct[] }
export const MOVEMENT_FIT_FLOOR = 3; // fit ≤ 2 ⇒ the movement is not delivered by the acts that carry it

/** Assemble the shape read's input from the live tree — PLAN plane only (no prose): movements verbatim, plus
 *  each act's fields and its beats' summaries in reading order. Skip-empty (early, not wrong): no premise, no
 *  movements, or no act carrying a beat ⇒ null (no call). */
export function buildShapeReadInput(nodes: DnaNode[]): ShapeReadInput | null {
  const premise = nodes.find((n) => n.kind === "premise");
  const shape = (premise?.content as PremiseContent | undefined)?.shape;
  const movements = (shape?.movements ?? []).filter((m): m is string => typeof m === "string" && !!m.trim());
  const acts: ShapeReadAct[] = nodes.filter((n) => n.kind === "act").sort((a, b) => a.position - b.position).map((a) => {
    const c = a.content as ActContent;
    const beats = childrenOf(nodes, a.id).filter((b) => b.kind === "beat")
      .map((b) => ({ beatId: b.id, summary: String((b.content as BeatContent).summary ?? "") }));
    return { actId: a.id, title: c.title, goal: c.goal, turningPoint: c.turning_point, beats };
  });
  if (!premise || !movements.length || !acts.some((a) => a.beats.length)) return null;
  return { movements, endingFeel: shape?.ending_feel, acts };
}

/** The staleness seal: a stable hash of the exact input sent. A verdict is FRESH iff this still matches the
 *  premise's stored observed_shape_hash; any plan edit that changes the input flips it, silencing the lint. */
export function shapeReadHash(input: ShapeReadInput): string {
  return metaHash(stableStringify(input));
}

// ── THE SYNOPSIS READ input + seal (W2 — doc_1783192600000_dna_build_plan.md) ────────────────────────────
// The shift-left quality judge, cloned from the shape read. read-synopsis (edge fn) is LLM-as-SENSOR — an
// acquisitions editor reads the WHOLE PLAN at synopsis resolution (premise promise + pillar thesis + acts +
// beats, zero prose) and scores fixed craft axes 1–5 (boredom_risk / predictability / genre_feel /
// stakes_clarity); the client writes the verdict onto pillar.observed_craft, and the craft_flag lint below is
// the pure JUDGE (the floor lives here, not the prompt). Same fresh/stale seal discipline as the shape read —
// this is the cheapest place to catch a boring book, before any prose is paid for.
export interface SynopsisReadBeat { beatId: string; summary: string; connector?: string; polarity?: string }
export interface SynopsisReadAct {
  actId: string; title?: string; goal?: string; turningPoint?: string;
  value?: { name?: string; from?: string; to?: string; polarity?: "up" | "down" };
  beats: SynopsisReadBeat[];
}
export interface SynopsisReadInput {
  premise: { dramaticQuestion?: string; shapeName?: string; movements?: string[]; endingFeel?: string };
  pillar: { controllingIdea?: string; ending?: string };
  acts: SynopsisReadAct[];
}
export const CRAFT_AXIS_FLOOR = 3; // score ≤ 2 ⇒ the axis is flagged (1–5 scale, same convention as MOVEMENT_FIT_FLOOR)

/** Assemble the synopsis read's input from the live tree — PLAN plane only (no prose): the premise's promise,
 *  the pillar's thesis + ending, and each act's fields plus its beats (summary/connector/polarity) in reading
 *  order. Skip-empty (early, not wrong): no pillar, or no act carrying a beat ⇒ null (no call). */
export function buildSynopsisReadInput(nodes: DnaNode[]): SynopsisReadInput | null {
  const premise = nodes.find((n) => n.kind === "premise");
  const pillar = nodes.find((n) => n.kind === "pillar");
  const pc = premise?.content as PremiseContent | undefined;
  const plc = pillar?.content as PillarContent | undefined;
  const acts: SynopsisReadAct[] = nodes.filter((n) => n.kind === "act").sort((a, b) => a.position - b.position).map((a) => {
    const c = a.content as ActContent;
    const beats: SynopsisReadBeat[] = childrenOf(nodes, a.id).filter((b) => b.kind === "beat").map((b) => {
      const bc = b.content as BeatContent;
      return { beatId: b.id, summary: String(bc.summary ?? ""), connector: bc.connector, polarity: bc.polarity };
    });
    return { actId: a.id, title: c.title, goal: c.goal, turningPoint: c.turning_point, value: c.value, beats };
  });
  if (!pillar || !acts.some((a) => a.beats.length)) return null;
  return {
    premise: { dramaticQuestion: pc?.dramatic_question, shapeName: pc?.shape?.name, movements: pc?.shape?.movements, endingFeel: pc?.shape?.ending_feel },
    pillar: { controllingIdea: plc?.controlling_idea, ending: plc?.ending },
    acts,
  };
}

/** The staleness seal: a stable hash of the exact input sent. A verdict is FRESH iff this still matches the
 *  pillar's stored observed_craft_hash; any plan edit that changes the input flips it, silencing the lint. */
export function synopsisReadHash(input: SynopsisReadInput): string {
  return metaHash(stableStringify(input));
}

// ── LOGLINE ANATOMY (the seed) ────────────────────────────────────────────────────────────────────────────
// The seed's logline is the story's ENGINE in one or two sentences (protagonist · inciting incident · goal ·
// obstacle · stakes) — not the raw idea, and not a situation. Two deterministic checks below, both warn.
export const LOGLINE_MAX_WORDS = 35; // the practical bar — past this a logline is smuggling in subplot/backstory
// Decisive-action verbs that mark an ACTIVE protagonist. Deliberately EXCLUDES the passive-signal verbs the
// anatomy names (discover / find / learn / realize / deal with) — "a man discovers his life is a lie" is the
// anti-pattern the lint should CATCH, not accept.
const LOGLINE_ACTIVE_VERB = /\b(must|fights?|races?|racing|hunts?|struggles?|seeks?|vows?|battles?|escapes?|chases?|infiltrates?|defends?|protects?|saves?|steals?|outruns?|wages?|rushes?|risks?|sets? out|sets? off|breaks? into|takes? down|tracks? down)\b/i;

function verticalLints(nodes: DnaNode[], cfg: LintConfig): DnaIssue[] {
  const issues: DnaIssue[] = [];
  const index = byId(nodes);

  // seed.logline ↔ the logline anatomy (doc_1783348800000_logline_anatomy.md): the seed is the story's engine
  // in one or two sentences, not a raw idea and not a situation. Two deterministic checks, both warn:
  //   logline_overlong — over LOGLINE_MAX_WORDS words: it's carrying subplot/backstory ("one story, not three").
  //   logline_static  — no active-drive verb, so the protagonist has things happen TO them ("a man discovers his
  //     life is a lie") — a passive logline usually signals a passive story.
  const seed = nodes.find((n) => n.kind === "seed");
  const logline = ((seed?.content as SeedContent | undefined)?.logline ?? "").trim();
  if (seed && logline) {
    const wordCount = logline.split(/\s+/).filter(Boolean).length;
    if (wordCount > LOGLINE_MAX_WORDS) {
      issues.push({ rule: "logline_overlong", severity: "warn", nodeId: seed.id,
        message: `the logline runs ${wordCount} words (aim for ≤ ${LOGLINE_MAX_WORDS}) — cut subplot and backstory down to the one story's engine` });
    }
    if (!LOGLINE_ACTIVE_VERB.test(logline)) {
      issues.push({ rule: "logline_static", severity: "warn", nodeId: seed.id,
        message: `the logline reads passive — the protagonist should DRIVE the story (must, fights to, races to…), not have things happen to them` });
    }
  }

  const premise = nodes.find((n) => n.kind === "premise");
  const shape = (premise?.content as PremiseContent | undefined)?.shape;

  // premise.shape.movements ↔ acts: acts map n:1 onto movements (several acts may serve one movement, never
  // the reverse), so fewer acts than movements means some movement has no act to carry it.
  const movements = (shape?.movements ?? []).filter((m) => typeof m === "string" && m.trim());
  const acts = nodes.filter((n) => n.kind === "act");
  if (premise && movements.length && acts.length && acts.length < movements.length) {
    issues.push({ rule: "shape_unmapped", severity: "warn", nodeId: premise.id,
      message: `the shape promises ${movements.length} movements but the book has ${acts.length} act(s) — acts map onto movements n:1, so some movement has no act to carry it` });
  }

  // movement_unfit — the SEMANTIC complement of shape_unmapped (a movement no act DELIVERS, even when counts
  // look fine). Reads the paid shape read's verdict (premise.observed_shape_fit); the threshold lives here, not
  // in the prompt (LLM-as-sensor, pure-fn-as-judge). Fires only when the seal is FRESH — a stale verdict is
  // silent (early-not-wrong; the read is paid, so the author re-triggers it rather than us nagging).
  const fitVerdict = (premise?.content as PremiseContent | undefined)?.observed_shape_fit;
  if (premise && Array.isArray(fitVerdict) && fitVerdict.length) {
    const input = buildShapeReadInput(nodes);
    const fresh = !!input && (premise.content as PremiseContent).observed_shape_hash === shapeReadHash(input);
    if (fresh) {
      for (const row of fitVerdict) {
        if (typeof row.movement !== "number") continue;
        const carried = Array.isArray(row.actIds) && row.actIds.length > 0;
        const score = carried ? row.fit : 0; // an empty inferred mapping = uncarried = fit 0 (the semantic case)
        if (typeof score !== "number" || score >= MOVEMENT_FIT_FLOOR) continue;
        const text = movements[row.movement] ?? `#${row.movement + 1}`;
        const worst = row.worst && index.has(row.worst) ? row.worst : premise.id; // anchor to the node that can fix it
        issues.push({ rule: "movement_unfit", severity: "warn", nodeId: worst,
          message: `movement ${row.movement + 1} "${text}" scores ${score}/5 in the acts that carry it${row.note ? ` — ${row.note}` : ""}` });
      }
    }
  }

  // craft_flag — the synopsis read's verdict (pillar.observed_craft): the shift-left "editor's read" of the
  // PLAN, one flag per craft axis under the floor. Same sensor/judge split and freshness gate as movement_unfit:
  // the floor lives here (CRAFT_AXIS_FLOOR, not LintConfig — a fixed craft convention, not a genre dial), and a
  // stale seal is silent (early-not-wrong; the read is paid, so the author re-triggers it rather than us nagging).
  const pillar = nodes.find((n) => n.kind === "pillar");
  const craftVerdict = (pillar?.content as PillarContent | undefined)?.observed_craft;
  if (pillar && Array.isArray(craftVerdict) && craftVerdict.length) {
    const input = buildSynopsisReadInput(nodes);
    const fresh = !!input && (pillar.content as PillarContent).observed_craft_hash === synopsisReadHash(input);
    if (fresh) {
      for (const row of craftVerdict) {
        if (typeof row.axis !== "string" || typeof row.score !== "number" || row.score >= CRAFT_AXIS_FLOOR) continue;
        const worst = row.worst && index.has(row.worst) ? row.worst : pillar.id; // anchor to the beat most responsible
        issues.push({ rule: "craft_flag", severity: "warn", nodeId: worst,
          message: `the synopsis read scores ${row.axis} ${row.score}/5${row.note ? ` — ${row.note}` : ""}` });
      }
    }
  }

  // premise.shape.ending_feel ↔ the spine's terminus: "up"/"down" are deterministic promises (bittersweet/
  // ambivalent aren't — skipped). Only the ACTUAL last element is read (last scene, else last beat); if it
  // carries no polarity yet the ending isn't authored — early, not wrong.
  const feel = shape?.ending_feel;
  if (premise && (feel === "up" || feel === "down")) {
    const scenes = scenesInOrder(nodes);
    const beats = beatsInOrder(nodes);
    const lastScene = scenes[scenes.length - 1];
    const lastBeat = beats[beats.length - 1];
    const scenePol = lastScene ? (lastScene.content as SceneContent).value_shift?.polarity : undefined;
    const beatPol = lastBeat ? (lastBeat.content as BeatContent).polarity : undefined;
    const terminal = scenePol && lastScene ? { id: lastScene.id, pol: scenePol } : beatPol && lastBeat ? { id: lastBeat.id, pol: beatPol } : null;
    if (terminal && terminal.pol !== feel) {
      issues.push({ rule: "ending_feel_mismatch", severity: "warn", nodeId: terminal.id,
        message: `the premise's shape promises the ending feels "${feel}" but the spine's last turn lands ${terminal.pol}` });
    }
  }

  // act.value.polarity ↔ its beats' landing: the act's value polarity is where the macro value ENDS across
  // the act, so its LAST beat must land the same way. Beats oscillate within the act by design (hope spots
  // in down-acts) — only the landing is checked, and only when both sides are authored.
  for (const a of acts) {
    const av = (a.content as ActContent).value;
    const actBeats = childrenOf(nodes, a.id).filter((b) => b.kind === "beat");
    const last = actBeats[actBeats.length - 1];
    const bp = last ? (last.content as BeatContent).polarity : undefined;
    if (av?.polarity && bp && bp !== av.polarity) {
      issues.push({ rule: "act_value_undelivered", severity: "warn", nodeId: last.id,
        message: `act plans ${av.name ? `"${av.name}"` : "its value"} to land ${av.polarity} but its last beat lands ${bp} — the beats don't deliver the act's macro shift` });
    }
  }

  for (const b of nodes.filter((n) => n.kind === "beat")) {
    const bc = b.content as BeatContent;
    const kids = childrenOf(nodes, b.id).filter((s) => s.kind === "scene");
    const last = kids[kids.length - 1];

    // beat.polarity ↔ its scenes' value shifts: a beat's polarity is where the value ENDS across its turn, so
    // its LAST scene must land the same way. Scenes may detour (down-down-up under an "up" beat) — only the
    // landing is checked, and only when the last scene has authored its shift.
    const sp = last ? (last.content as SceneContent).value_shift?.polarity : undefined;
    if (bc.polarity && sp && sp !== bc.polarity) {
      issues.push({ rule: "beat_polarity_undelivered", severity: "warn", nodeId: last.id,
        message: `beat plans a "${bc.polarity}" turn but its last scene lands ${sp} — the scenes don't deliver the beat's charge` });
    }

    // scene.readings ↔ the beat's readings: a scene's explicit level on a meter must refine, not contradict,
    // its beat's explicit level on the same meter. Explicit-vs-explicit only (no carry-forward guessing), and
    // only against an explicit scale — anything less is early.
    for (const s of kids) {
      for (const r of ((s.content as SceneContent).readings ?? [])) {
        const br = (bc.readings ?? []).find((x) => x.ref === r.ref);
        if (!br || typeof r.value !== "number" || typeof br.value !== "number") continue;
        const meter = index.get(r.ref);
        const mc = meter?.kind === "meter" ? (meter.content as MeterContent) : undefined;
        const span = typeof mc?.scale?.min === "number" && typeof mc?.scale?.max === "number" ? mc.scale.max - mc.scale.min : 0;
        if (span > 0 && Math.abs(r.value - br.value) > cfg.sceneRefineBand * span) {
          issues.push({ rule: "scene_reading_departs", severity: "warn", nodeId: s.id,
            message: `scene reads "${mc?.name ?? r.ref}" at ${r.value} but its beat planned ${br.value} — the scene contradicts the level it refines` });
        }
      }
    }
  }
  return issues;
}

// ── SKETCH LINTS (the scene treatment — doc_1783198900000_dna_scene_direction.md) ─────────────────────────
// Direction lives INSIDE the sketch, so these only fire once a scene HAS a sketch ("don't badge what we
// didn't generate" — the same house rule as isStale). Two checks:
//   promise_undramatized — a scene doing PROMISE WORK (pays off a thread, realizes a tentpole, or is the
//     scene that lands its beat's turn) whose direction is "summary" mode or "far" distance: the promise is
//     PRESENT in the plan but not experientially DELIVERED (a payoff summarized reads as a report, not a moment).
//   direction_monotone — adjacent sketched scenes (in reading order) repeating the same mode/distance/tension:
//     the register field's existing note ("adjacent scenes should differ") made checkable.
function sketchLints(nodes: DnaNode[]): DnaIssue[] {
  const issues: DnaIssue[] = [];
  let prev: SketchDirection | undefined;
  for (const s of scenesInOrder(nodes)) {
    const c = s.content as SceneContent;
    const dir = c.sketch?.direction;
    if (!dir) continue; // no sketch yet — early, not wrong; don't reset `prev` so adjacency skips it cleanly

    const paysOffThread = (c.threads ?? []).some((t) => t.role === "payoff");
    const realizesTentpole = !!c.realizes_tentpole;
    const lastOfBeat = !!s.parent_id && childrenOf(nodes, s.parent_id).filter((k) => k.kind === "scene").slice(-1)[0]?.id === s.id;
    const promiseWork = paysOffThread || realizesTentpole || lastOfBeat;
    if (promiseWork && (dir.mode === "summary" || dir.distance === "far")) {
      const why = paysOffThread ? "pays off a thread" : realizesTentpole ? "realizes a tentpole" : "lands its beat's turn";
      issues.push({ rule: "promise_undramatized", severity: "warn", nodeId: s.id,
        message: `scene ${why} but its direction is ${dir.mode === "summary" ? "summary mode" : `${dir.distance} distance`} — the promise is present but not dramatized` });
    }
    if (prev && dir.mode === prev.mode && dir.distance === prev.distance && dir.tension === prev.tension) {
      issues.push({ rule: "direction_monotone", severity: "warn", nodeId: s.id,
        message: `scene repeats the same direction (${dir.mode}/${dir.distance}/${dir.tension}) as the previous sketched scene — adjacent scenes should differ` });
    }
    prev = dir;
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
      canon.set(f.key, { key: f.key, value: f.value, note: f.note, entity: f.entity, sceneId: s.id });
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

// ── ENTITY REGISTRY (the shared keyspace — docs/scene-ledger.md §1.2) ──────────────────────────────────────
// The kinds prose actually NAMES, in the order they appear in the block. Games/meters/tentpoles are excluded:
// they're plan constructs the prose never says out loud, so grounding an observed fact against them is noise.
const REGISTRY_KINDS: NodeKind[] = ["character", "location", "world_fact", "thread", "relationship"];
const REGISTRY_CAP = 120; // guard the fold/read prompt size on huge casts (same spirit as read-facts' MAX_LEDGER)

/** The entity registry as an LLM-consumable block: one line per entity node,
 *  `id — kind — name (+ one-line identifying detail)`. Deterministic order (kind, then position). This is the
 *  shared keyspace both the digest fold and the fact read resolve names/epithets/pronouns AGAINST, so observed
 *  state can be tagged with the node id it concerns and join the plan side (advances/threads/loc) by that id. A
 *  relationship line names BOTH ends by their character name (`n_rel_x — relationship — Mara ↔ Okonkwo`). */
export function entityRegistryBlock(nodes: DnaNode[]): string {
  const index = byId(nodes);
  const nm = (id?: string): string => String((index.get(id ?? "")?.content as { name?: string } | undefined)?.name ?? "").trim();
  const name = (n: DnaNode): string => {
    if (n.kind === "relationship") {
      const c = n.content as RelationshipContent;
      return `${nm(c.a) || c.a || "?"} ↔ ${nm(c.b) || c.b || "?"}`;
    }
    return String((n.content as { name?: string }).name ?? "").trim() || n.id;
  };
  const detail = (n: DnaNode): string => {
    const c = n.content as Record<string, unknown>;
    const s = n.kind === "character" ? [c.role, c.want && `wants ${c.want}`].filter(Boolean).join(", ")
      : n.kind === "location" ? String(c.summary ?? c.mood ?? "")
      : n.kind === "world_fact" ? String(c.rule ?? c.mechanism ?? "")
      : n.kind === "thread" ? String(c.promise ?? "")
      : n.kind === "relationship" ? String(c.bond ?? "")
      : "";
    return s.replace(/\s+/g, " ").trim().slice(0, 80);
  };
  const lines: string[] = [];
  for (const kind of REGISTRY_KINDS) {
    for (const n of nodes.filter((x) => x.kind === kind).sort((a, b) => a.position - b.position)) {
      const d = detail(n);
      lines.push(`${n.id} — ${kind} — ${name(n)}${d ? ` (${d})` : ""}`);
    }
  }
  return lines.slice(0, REGISTRY_CAP).join("\n");
}

// ── FACET EXPOSURE (progressive disclosure — docs/scene-ledger.md §2) ──────────────────────────────────────
// A FACET is (entityRef, field): one descriptive content field of a registry entity that the prose can "spend".
// The catalog of which fields count is derived from the schema — deterministic, no LLM, no authoring burden.
const FACET_FIELDS: Partial<Record<NodeKind, string[]>> = {
  location: ["sight", "sound", "smell", "texture", "mood"],
  character: ["tag", "wound", "lie", "idiolect"],
  world_fact: ["rule", "mechanism"],
  relationship: ["bond"],
};
// uses ≥ this ⇒ a facet is SATURATED (restatement forbidden). One knob, LintConfig.meterFlatRun in spirit.
export const FACET_SATURATION = 3;

const FACET_STOP = new Set("the a an and or but of to in on at for with as is was were be been are it its his her their they he she you your we our i me my that this these those there then than so if when while into from over under up down out off not no yes".split(" "));
const facetWords = (t: string): string[] => (t || "").toLowerCase().replace(/[^a-z0-9'\s]/g, " ").split(/\s+/).filter(Boolean);
/** Distinctive 5→4→3-word shingles of a facet's authored text (dropping all-stopword grams). Longest first so
 *  the recorded echo is the most specific match. Empty when the text is too short (<3 content words) to match
 *  distinctively — that facet simply can't be detected by the verbatim floor (paraphrase escapes it too). */
function facetShingles(text: string): string[] {
  const w = facetWords(text);
  const out: string[] = [];
  for (const n of [5, 4, 3]) {
    for (let i = 0; i + n <= w.length; i++) {
      const gram = w.slice(i, i + n);
      if (gram.every((g) => FACET_STOP.has(g))) continue;
      out.push(gram.join(" "));
    }
  }
  return out;
}

export interface FacetUse { ref: string; facet: string; sceneId: string; echo?: string }
/** Scan prosed scenes in reading order; a facet is "used" in a scene when a distinctive n-gram of its authored
 *  text appears (near-verbatim, token-boundary match) in that scene's prose — the exact harm Phase 2 kills.
 *  Deterministic, no model. Known limitation (by design): a PARAPHRASE of the palette escapes this floor. */
export function facetEchoes(nodes: DnaNode[]): FacetUse[] {
  const facets: { ref: string; facet: string; shingles: string[] }[] = [];
  for (const n of nodes) {
    const fields = FACET_FIELDS[n.kind];
    if (!fields) continue;
    const c = n.content as Record<string, unknown>;
    for (const f of fields) {
      const sh = facetShingles(String(c[f] ?? ""));
      if (sh.length) facets.push({ ref: n.id, facet: f, shingles: sh });
    }
  }
  const out: FacetUse[] = [];
  for (const s of scenesInOrder(nodes)) {
    const prose = String((s.content as SceneContent).prose?.text ?? "");
    if (!prose.trim()) continue;
    const hay = ` ${facetWords(prose).join(" ")} `; // pad so a shingle only matches on whole-token boundaries
    for (const fc of facets) {
      const echo = fc.shingles.find((g) => hay.includes(` ${g} `));
      if (echo) out.push({ ref: fc.ref, facet: fc.facet, sceneId: s.id, echo });
    }
  }
  return out;
}

export interface FacetExposure { ref: string; facet: string; uses: number; lastPhrasing?: string; saturated: boolean }
/** Fold facetEchoes into the per-facet DISCLOSURE BUDGET ENTERING a scene: how many times each facet was echoed
 *  by scenes strictly BEFORE it in reading order, the last phrasing used, and whether it's saturated. What the
 *  prose prompt reads to decide reveal-fresh / vary-known / drop-saturated. `sceneId` not found ⇒ whole book. */
export function facetExposureBefore(nodes: DnaNode[], sceneId: string): FacetExposure[] {
  const order = scenesInOrder(nodes).map((s) => s.id);
  const cut = order.indexOf(sceneId);
  const prior = new Set(cut < 0 ? order : order.slice(0, cut));
  const agg = new Map<string, FacetExposure>();
  for (const u of facetEchoes(nodes)) {
    if (!prior.has(u.sceneId)) continue;
    const key = `${u.ref} ${u.facet}`;
    const e = agg.get(key) ?? { ref: u.ref, facet: u.facet, uses: 0, saturated: false };
    e.uses++;
    if (u.echo) e.lastPhrasing = u.echo;
    e.saturated = e.uses >= FACET_SATURATION;
    agg.set(key, e);
  }
  return [...agg.values()];
}

// ── ledgerAt (the unified between-scenes view — docs/scene-ledger.md §3) ────────────────────────────────────
// ONE pure answer to "what is true ENTERING scene N?" — a fold of the plan fields + the already-persisted
// observed outputs, over the scenes strictly BEFORE N in reading order. No LLM, no I/O, callable everywhere
// both twins are. It CONSOLIDATES the reads the prose context / agent digest / verify-loop each assembled ad
// hoc; the field folds delegate to the existing derivations (facetExposureBefore, ledgerBefore) so the logic
// lives once. "Held open" = state:"open" with scenesSinceTouch>0 — derived, never authored.
export interface SceneLedger {
  sceneId: string; index: number;                  // position in scenesInOrder (-1 if the id isn't a scene)
  causality: { established: string[] };            // state keys produced upstream (fold of `establishes`)
  threads: { ref: string; state: "unopened" | "open" | "paid"; openedAt?: number; lastTouch?: number; scenesSinceTouch?: number }[];
  relations: { ref: string; moves: number; lastHow?: string; lastAt?: number }[];   // fold of `advances`
  meters: { ref: string; value: number }[];        // carry-forward level entering this scene (last reading wins)
  positions: { ref: string; loc?: string; lastSeenAt: number }[];  // char → last loc they appeared in
  exposure: FacetExposure[];                        // Phase 2 disclosure budget entering this scene
  facts: LedgerFact[];                              // observed canon folded from observed_establishes (Phase 1 keys)
}
export function ledgerAt(nodes: DnaNode[], sceneId: string): SceneLedger {
  const scenes = scenesInOrder(nodes);
  const index = scenes.findIndex((s) => s.id === sceneId);
  const idx = index < 0 ? scenes.length : index;   // not a known scene ⇒ fold the whole book
  const prior = scenes.slice(0, idx);

  // CAUSALITY — the state keys produced by scenes strictly upstream (last-first, dedup, reading order).
  const established: string[] = [];
  const seenKey = new Set<string>();
  for (const s of prior) for (const k of ((s.content as SceneContent).establishes ?? [])) if (k && !seenKey.has(k)) { seenKey.add(k); established.push(k); }

  // THREADS — a per-thread FSM over prior scenes' ThreadRefs: setup opens, payoff pays; lastTouch drives the
  // reader-pressure signals. scenesSinceTouch is measured from the ENTRY point (idx), so a thread touched in
  // the immediately preceding scene reads as 1.
  const threads = nodes.filter((n) => n.kind === "thread").map((t) => {
    let state: "unopened" | "open" | "paid" = "unopened";
    let openedAt: number | undefined, lastTouch: number | undefined;
    prior.forEach((s, i) => {
      for (const ref of ((s.content as SceneContent).threads ?? [])) {
        if (ref.ref !== t.id) continue;
        lastTouch = i;
        if (ref.role === "setup" && state === "unopened") { state = "open"; openedAt = i; }
        if (ref.role === "payoff") state = "paid";
      }
    });
    return {
      ref: t.id, state,
      ...(openedAt != null ? { openedAt } : {}),
      ...(lastTouch != null ? { lastTouch, scenesSinceTouch: idx - lastTouch } : {}),
    };
  });

  // RELATIONS — fold of `advances` (move count + last move) per relationship node.
  const relations = nodes.filter((n) => n.kind === "relationship").map((r) => {
    let moves = 0, lastHow: string | undefined, lastAt: number | undefined;
    prior.forEach((s, i) => {
      for (const a of ((s.content as SceneContent).advances ?? [])) {
        if (a.ref !== r.id) continue;
        moves++; lastAt = i; if (a.how) lastHow = a.how;
      }
    });
    return { ref: r.id, moves, ...(lastHow ? { lastHow } : {}), ...(lastAt != null ? { lastAt } : {}) };
  });

  // METERS — carry-forward: the last authored reading on each meter across prior scenes (a gap holds the level).
  const meterMap = new Map<string, number>();
  for (const s of prior) for (const r of ((s.content as SceneContent).readings ?? [])) if (typeof r.value === "number") meterMap.set(r.ref, r.value);
  const meters = [...meterMap].map(([ref, value]) => ({ ref, value }));

  // POSITIONS — each character's last-seen location (pov + present resolve to who's "in the room").
  const posMap = new Map<string, { loc?: string; lastSeenAt: number }>();
  prior.forEach((s, i) => {
    const c = s.content as SceneContent;
    for (const ch of new Set([c.pov, ...(c.present ?? [])].filter((x): x is string => !!x))) {
      posMap.set(ch, { loc: c.loc, lastSeenAt: i });
    }
  });
  const positions = [...posMap].map(([ref, v]) => ({ ref, ...(v.loc ? { loc: v.loc } : {}), lastSeenAt: v.lastSeenAt }));

  return {
    sceneId, index,
    causality: { established },
    threads, relations, meters, positions,
    exposure: facetExposureBefore(nodes, sceneId),
    facts: ledgerBefore(nodes, sceneId),
  };
}

/** A compact, name-resolved rendering of the between-scenes state ENTERING a scene (a `ledgerAt` fold): open
 *  promises with held-pressure + where each character was last seen. The SHARED text the generator's prose
 *  context and the agent's tree digest both read, so generator and editor see the same snapshot. Empty when
 *  there's nothing to say (no known scene / no open loops / no positions) — callers drop the block entirely. */
export function ledgerText(nodes: DnaNode[], sceneId: string): string {
  const L = ledgerAt(nodes, sceneId);
  const index = byId(nodes);
  const nm = (id: string): string => String((index.get(id)?.content as { name?: string } | undefined)?.name ?? id);
  const open = L.threads.filter((t) => t.state === "open").map((t) => {
    const held = (t.scenesSinceTouch ?? 0) > 1 ? ` (held ${t.scenesSinceTouch} scenes — don't let it drop)` : "";
    return `"${nm(t.ref)}"${held}`;
  });
  const positions = L.positions.filter((p) => p.loc).map((p) => `${nm(p.ref)} — last at ${nm(p.loc!)}`);
  return [
    open.length ? `- Open promises (set up, not yet paid — keep them alive): ${open.join("; ")}` : "",
    positions.length ? `- Positions (where each was last seen — account for any travel): ${positions.join("; ")}` : "",
  ].filter(Boolean).join("\n");
}

// ── traceDiff (the planned-vs-observed STATE trace — docs/true-agent.md; unlocked by Phase-1 grounding) ──────
// Phase 1 gave observed facts a node-id `entity`, so the plan and the read finally share a keyspace. Per scene
// that has BEEN READ (carries observed_establishes), join the plan against the read by that id: a relationship
// the scene PLANS to move (`advances[].ref`) or a promise it PLANS to pay (a `payoff` ThreadRef) with NO
// observed fact tagged to that entity = a plan the prose didn't deliver. Fires only on read scenes, so it never
// flags an un-read draft. Meters (readings vs observed_readings) are the existing observedGap — the other axis.
export interface TraceGap { sceneId: string; index: number; axis: "relationship" | "thread"; ref: string; note: string }
export function traceDiff(nodes: DnaNode[]): TraceGap[] {
  const index = byId(nodes);
  const nm = (id: string): string => String((index.get(id)?.content as { name?: string } | undefined)?.name ?? id);
  const out: TraceGap[] = [];
  scenesInOrder(nodes).forEach((s, i) => {
    const c = s.content as SceneContent;
    if (!c.observed_establishes?.length) return; // not read yet — never flag an unmeasured scene
    const seen = new Set(c.observed_establishes.map((f) => f.entity).filter((e): e is string => !!e));
    for (const a of (c.advances ?? [])) {
      if (a.ref && !seen.has(a.ref)) out.push({ sceneId: s.id, index: i, axis: "relationship", ref: a.ref,
        note: `scene ${i + 1} plans to advance "${nm(a.ref)}"${a.how ? ` (${a.how})` : ""} but the read surfaced no fact about it — the move may not have landed in the prose` });
    }
    for (const t of (c.threads ?? [])) {
      if (t.role === "payoff" && t.ref && !seen.has(t.ref)) out.push({ sceneId: s.id, index: i, axis: "thread", ref: t.ref,
        note: `scene ${i + 1} plans to PAY OFF "${nm(t.ref)}" but the read surfaced no fact tagged to it — the payoff may be unearned in the prose` });
    }
  });
  return out;
}

/** A compact plain-text STORY ANALYSIS — the three axes + lints — handed to the dna-chat reviser as context
 *  so it can act on pacing drift / dangling promises / sagging runs. The UI renders the same data visually. */
export function analysisText(nodes: DnaNode[], settings: BookSettings, cfg: LintConfig = DEFAULT_LINT_CONFIG): string {
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
  const issues = validate(nodes, cfg);
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

// ── PROSE LINTS (the deterministic read layer) ────────────────────────────────
// The "prettier" for prose: pure, LLM-free lints over scene.content.prose.text that catch repetition and
// monotony MECHANICALLY — millisecond cost, so validate() runs them on every tree read. All four judge ONLY
// scenes that already have prose (skip-empty = early, not wrong; an undrafted scene never fires). Reuses
// facetWords/FACET_STOP so "distinctive" means the same thing here as on the facet-echo floor. Known
// limitation (by design, same as facetEchoes): a PARAPHRASE escapes all of these — that's the LLM read's job.

// A normalized 5-gram is DISTINCTIVE when it carries ≤2 stopwords — enough content words that its recurrence
// is authorial repetition, not English being English. Set preserves first-occurrence order (deterministic pick).
const ECHO_N = 5;
const ECHO_MAX_STOP = 2;
function distinctiveGrams(tokens: string[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + ECHO_N <= tokens.length; i++) {
    const gram = tokens.slice(i, i + ECHO_N);
    if (gram.filter((g) => FACET_STOP.has(g)).length > ECHO_MAX_STOP) continue;
    out.add(gram.join(" "));
  }
  return out;
}

// Sentence word-lengths: split on ./?/! boundaries; a fragment under 2 words isn't a sentence (an initial,
// an ellipsis shard) and is dropped rather than allowed to fake variety.
function sentenceLengths(prose: string): number[] {
  return prose.split(/[.?!]+/).map((s) => s.trim().split(/\s+/).filter(Boolean).length).filter((n) => n >= 2);
}

// A line "is dialogue" when it contains a double-quote pair or opens with a quote — deliberately crude but
// deterministic; curly quotes count so smart-quoted prose isn't misread as narration.
const QUOTE_CHARS = new Set(['"', "“", "”"]);
function dialogueShare(prose: string): number {
  const lines = prose.split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return 0;
  const dialogue = lines.filter((l) => {
    let quotes = 0;
    for (const ch of l) if (QUOTE_CHARS.has(ch)) quotes++;
    return quotes >= 2 || QUOTE_CHARS.has(l[0]);
  }).length;
  return dialogue / lines.length;
}

const NAME_SOUP_MIN_WORDS = 150;      // below this a scene is too short for density to mean anything
const DIALOGUE_HIGH = 0.9;            // line share at/above = "all dialogue"
const DIALOGUE_LOW = 0.1;             // line share at/below = "no dialogue"

/** The four mechanical prose lints. One precompute pass (tokens / 5-grams / sentence lengths / dialogue
 *  share per prose-bearing scene), then pairwise compare only the n-gram sets. Pure string work — no
 *  Date, no random — so the verdict is a deterministic function of the tree. */
export function proseLints(nodes: DnaNode[], cfg: LintConfig): DnaIssue[] {
  const issues: DnaIssue[] = [];
  const index = byId(nodes);
  const scenes = scenesInOrder(nodes);

  // Precompute per scene. A 5-gram that appears in the scene's OWN location palette (scene.loc → location
  // fields) is excluded — a facet echo is deliberate craft, already covered by facetEchoes. Prose-less
  // scenes stay null so ADJACENCY below means "next to each other in reading order", not "next drafted".
  type SceneStat = { id: string; idx: number; tokens: string[]; grams: Set<string>; sentences: number[]; dialogue: number };
  const stats: (SceneStat | null)[] = scenes.map((s, idx) => {
    const c = s.content as SceneContent;
    const prose = c.prose?.text ?? "";
    if (!prose.trim()) return null;
    const tokens = facetWords(prose);
    const grams = distinctiveGrams(tokens);
    const loc = c.loc ? index.get(c.loc) : undefined;
    if (loc?.kind === "location") {
      const lc = loc.content as Record<string, unknown>;
      for (const f of FACET_FIELDS.location ?? []) for (const g of distinctiveGrams(facetWords(String(lc[f] ?? "")))) grams.delete(g);
    }
    return { id: s.id, idx, tokens, grams, sentences: sentenceLengths(prose), dialogue: dialogueShare(prose) };
  });
  const prosed = stats.filter((s): s is SceneStat => s !== null);

  // 1) prose_echo — a distinctive 5-gram recurring BETWEEN scenes (the top repetition source is the scene
  // right before, so adjacent pairs fire at a lower floor). The LATER scene is flagged (it did the
  // repeating); capped at one issue per scene pair.
  for (let l = 0; l < prosed.length; l++) {
    for (let e = 0; e < l; e++) {
      const later = prosed[l], earlier = prosed[e];
      const shared: string[] = [];
      for (const g of later.grams) if (earlier.grams.has(g)) shared.push(g);
      const floor = later.idx - earlier.idx === 1 ? cfg.proseEchoAdjacent : cfg.proseEchoDistant;
      if (shared.length < floor) continue;
      issues.push({ rule: "prose_echo", severity: "warn", nodeId: later.id,
        message: `prose repeats "${shared[0]}" from scene ${earlier.idx + 1}${shared.length > 1 ? ` (+${shared.length - 1} more shared phrase(s))` : ""}` });
    }
  }

  // 2) monotone_rhythm — flat cadence: enough sentences to HAVE a rhythm, and their word-lengths barely
  // vary (coefficient of variation = stddev/mean under the floor). Population stddev; fragments already dropped.
  for (const s of prosed) {
    if (s.sentences.length < cfg.rhythmMinSentences) continue;
    const mean = s.sentences.reduce((a, b) => a + b, 0) / s.sentences.length;
    if (!mean) continue;
    const cv = Math.sqrt(s.sentences.reduce((a, b) => a + (b - mean) ** 2, 0) / s.sentences.length) / mean;
    if (cv >= cfg.rhythmCvFloor) continue;
    issues.push({ rule: "monotone_rhythm", severity: "warn", nodeId: s.id,
      message: `sentence lengths barely vary (CV ${cv.toFixed(2)}, mean ${mean.toFixed(1)} words) — flat cadence` });
  }

  // 3) name_soup — character-name density. Each character's FIRST name token, matched against the scene's
  // token list (token equality IS the word boundary; a trailing apostrophe-suffix like "mara's" still counts).
  for (const s of prosed) {
    const words = s.tokens.length;
    if (words < NAME_SOUP_MIN_WORDS) continue;
    const counts: { name: string; count: number }[] = [];
    for (const c of nodes) {
      if (c.kind !== "character") continue;
      const first = String((c.content as CharacterContent).name ?? "").trim().split(/\s+/)[0];
      if (!first) continue;
      const needle = first.toLowerCase();
      const count = s.tokens.filter((t) => t.replace(/'.*$/, "") === needle).length;
      if (count) counts.push({ name: first, count });
    }
    const total = counts.reduce((a, c) => a + c.count, 0);
    const per100 = (total / words) * 100;
    if (per100 <= cfg.nameDensityCeiling) continue;
    const worst = counts.reduce((a, c) => (c.count > a.count ? c : a));
    issues.push({ rule: "name_soup", severity: "warn", nodeId: s.id,
      message: `${total} character-name mentions in ${words} words (${per100.toFixed(1)} per 100 — ceiling ${cfg.nameDensityCeiling}); "${worst.name}" leads with ${worst.count}` });
  }

  // 4) dialogue_flatline — a run of ≥dialogueRunLen CONSECUTIVE prose-bearing scenes all at the SAME extreme
  // (≥90% or ≤10% dialogue by line share). A prose-less scene breaks the run (it may change the mix when
  // drafted); the FIRST scene of the run is flagged — that's where variation has to start.
  const extremeOf = (d: number): "high" | "low" | null => (d >= DIALOGUE_HIGH ? "high" : d <= DIALOGUE_LOW ? "low" : null);
  for (let i = 0; i < stats.length; ) {
    const st = stats[i];
    const ex = st ? extremeOf(st.dialogue) : null;
    if (!st || !ex) { i++; continue; }
    let j = i + 1;
    for (; j < stats.length; j++) {
      const nx = stats[j];
      if (!nx || extremeOf(nx.dialogue) !== ex) break;
    }
    if (j - i >= cfg.dialogueRunLen) {
      issues.push({ rule: "dialogue_flatline", severity: "warn", nodeId: st.id,
        message: `${j - i} scenes in a row are ${ex === "high" ? "≥90% dialogue" : "≤10% dialogue"} — the mix never varies` });
    }
    i = j;
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

export function validate(nodes: DnaNode[], cfg: LintConfig = DEFAULT_LINT_CONFIG): DnaIssue[] {
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
  issues.push(...meterLints(nodes, cfg));

  // Vertical fit (the timeline layer): each finer rung must refine, not contradict, the rung above it.
  issues.push(...verticalLints(nodes, cfg));

  // Sketch/direction axis: promise work shown as summary/far, or adjacent scenes repeating the same direction.
  issues.push(...sketchLints(nodes));

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
    if (typeof p.targetPct === "number" && Math.abs(p.driftPct) > cfg.pacingDriftTol) {
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

  // Emotional-topography axis (§6): a run of ≥ cfg.saggingRun same-polarity scenes = a sagging middle.
  const topo = topography(nodes);
  for (let i = 0; i < topo.length; ) {
    const pol = topo[i].polarity;
    if (pol == null) { i++; continue; }
    let j = i;
    while (j < topo.length && topo[j].polarity === pol) j++;
    if (j - i >= cfg.saggingRun) issues.push({ rule: "sagging_middle", severity: "warn", message: `${j - i} scenes in a row stay ${pol} — flat emotional charge`, nodeId: topo[i].sceneId });
    i = j;
  }

  // Continuity ledger (docs/true-agent.md Step 3): contradictions the read recorded on a scene's prose vs the
  // canon established before it. Pure — surfaces the stored flags so the editor handoff reuses this filter.
  for (const s of nodes.filter((n) => n.kind === "scene")) {
    for (const f of ((s.content as SceneContent).continuity_flags ?? [])) {
      issues.push({ rule: "continuity_break", severity: "error", nodeId: s.id,
        message: `prose contradicts established canon — "${f.key}" was "${f.was}", now "${f.now}"${f.note ? ` (${f.note})` : ""}` });
    }
    // Cold-reader confusion (read-confusion writes these): what a reader who knows ONLY the book so far
    // couldn't follow. warn (an affective judgment), unlike continuity_break's error (a factual one).
    for (const f of ((s.content as SceneContent).confusion_flags ?? [])) {
      issues.push({ rule: "reader_confusion", severity: "warn", nodeId: s.id,
        message: `a cold reader loses the thread here${f.kind ? ` (${f.kind})` : ""}${f.note ? ` — ${f.note}` : ""}` });
    }
  }

  // Dead fields (§dead-field lints): schema declares an arc/charge but nothing downstream consumes it.
  issues.push(...deadFieldLints(nodes));

  // Chronology (the timeline layer, deterministic floor): consecutive-scene travel with no time marker.
  issues.push(...chronologyLints(nodes));

  // Prose plane (W3): the deterministic read layer — mechanical repetition/monotony over drafted prose.
  // No-op on a prose-less book (every rule skips empty scenes), so pre-draft behaviour is unchanged.
  issues.push(...proseLints(nodes, cfg));
  return issues;
}

// ── DEAD-FIELD LINTS (the declared-never-consumed backstop) ──────────────────
// A character's lie/truth and a relationship's charge are ARC VOCABULARY — promises in all but name. When
// nothing on the plan side ever consumes them they are dead fields: the tool looks like it tracks the arc
// but doesn't. Both fire only once the plan is far enough along to have consumed them (early, not wrong):
// dead_arc needs beats (the pass that mints arc threads), static_relationship needs scenes (advances live there).
function deadFieldLints(nodes: DnaNode[]): DnaIssue[] {
  const issues: DnaIssue[] = [];
  // dead_arc: a lie-carrying character with no arc thread ABOUT them. The join is thread.owner → character id
  // (minted arc threads carry it); an ownerless thread never matches — pre-declared arcs must claim their owner.
  if (nodes.some((n) => n.kind === "beat")) {
    const arcOwners = new Set(nodes.filter((n) => n.kind === "thread" && (n.content as ThreadContent).kind === "arc")
      .map((n) => (n.content as ThreadContent).owner).filter(Boolean));
    for (const c of nodes.filter((n) => n.kind === "character")) {
      const cc = c.content as CharacterContent;
      if (!cc.lie?.trim()) continue;
      if (!arcOwners.has(c.id)) {
        issues.push({ rule: "dead_arc", severity: "warn", nodeId: c.id,
          message: `${cc.name ?? "a character"} carries a declared lie but no arc thread schedules it — the inner arc is invisible to the plan` });
      }
    }
  }
  // static_relationship: a charged edge no scene's `advances` ever moves — declared electricity that never arcs.
  const scenes = nodes.filter((n) => n.kind === "scene");
  if (scenes.length) {
    const advanced = new Set(scenes.flatMap((s) => ((s.content as SceneContent).advances ?? []).map((a) => a.ref)));
    for (const r of nodes.filter((n) => n.kind === "relationship")) {
      const rc = r.content as RelationshipContent;
      if (!rc.charge?.trim() || advanced.has(r.id)) continue;
      issues.push({ rule: "static_relationship", severity: "warn", nodeId: r.id,
        message: `relationship "${rc.bond ?? r.id}" declares a charge but no scene ever advances it — a charged edge that never turns` });
    }
  }
  return issues;
}

// ── CHRONOLOGY LINTS (the deterministic floor of the timeline projection) ────
// Free-text time is NEVER interpreted (per the timeline-layer doc) — only the machine-comparable subset
// fires: same POV character in two different locations across consecutive scenes with no time marker
// (`time.elapsed` empty and `time.when` absent-or-identical) reads as a teleport. All fields optional ⇒
// any missing side is "early", not "wrong".
function chronologyLints(nodes: DnaNode[]): DnaIssue[] {
  const issues: DnaIssue[] = [];
  const scenes = scenesInOrder(nodes);
  for (let i = 1; i < scenes.length; i++) {
    const a = scenes[i - 1].content as SceneContent, b = scenes[i].content as SceneContent;
    if (!a.pov || !b.pov || a.pov !== b.pov) continue;
    if (!a.loc || !b.loc || a.loc === b.loc) continue;
    const when = (s?: { when?: string }) => String(s?.when ?? "").trim().toLowerCase();
    const marked = String(b.time?.elapsed ?? "").trim() || (when(b.time) && when(b.time) !== when(a.time));
    if (!marked) {
      issues.push({ rule: "unmarked_travel", severity: "warn", nodeId: scenes[i].id,
        message: `the POV character changes location between consecutive scenes with no time marker (set time.elapsed or a new time.when) — reads as a teleport` });
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
export interface BookSettings { title?: string; author?: string; word_target?: number }

/** Can the book render at gold completeness? Returns the blocking reasons (empty = renderable). */
export function renderBlockers(nodes: DnaNode[], settings: BookSettings): string[] {
  const blockers: string[] = [];
  if (!settings.title?.trim()) blockers.push("no book title");
  if (!settings.author?.trim()) blockers.push("no author");
  if (!settings.word_target) blockers.push("no word_target in the mandate");

  const scenes = scenesInOrder(nodes);
  if (!scenes.length) { blockers.push("no scenes yet"); return blockers; }

  const unwritten = scenes.filter((s) => {
    const c = s.content as SceneContent;
    return !(c.prose?.text?.trim() && s.authoring.status === "accepted");
  });
  if (unwritten.length) blockers.push(`${unwritten.length} scene(s) without accepted prose`);
  return blockers;
}

export const isRenderable = (nodes: DnaNode[], settings: BookSettings): boolean => renderBlockers(nodes, settings).length === 0;

/** A fresh node slot in the requested status (the "hungry" empty slot the UI fills). */
export function emptyNode(book_id: number, kind: NodeKind, level: number, parent_id: string | null, position = 0): DnaNode {
  return { id: newId(), book_id, parent_id, level, kind, position, content: {}, authoring: { source: "user", locked: false, status: "empty" } };
}
