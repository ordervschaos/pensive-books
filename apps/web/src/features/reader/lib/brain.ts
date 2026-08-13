// brain.ts — the reader's mental model as an event-sourced state machine.
//
// THE CENTRAL IDEA. A book read is a sweep. At every unit the reader's model of the story changes a
// little. So we do NOT store 305 snapshots — we store per-unit DELTAS and reconstruct any snapshot
// by folding 0..t. Scrubbing the timeline is `foldTo(t)`, a cheap pure recompute.
//
// That is the same move `structure-as-render` makes elsewhere in this repo (the outline is the
// artifact, pages are a render) and the same prefix fold `ledgerBefore` already uses. It buys three
// things at once:
//   • O(deltas) storage instead of O(units × state)
//   • the ability to answer "what did this unit DO to me?" — the delta IS the answer
//   • causality for free: fold(0..t) can only ever contain what was read by t
//
// PURE. No network, no React, no model calls. The ops come from the forward pass (P1, one call per
// window); everything here is deterministic arithmetic over them, so activation decay, importance,
// and immersion cost nothing and are identical in the browser and in a script.

// ── the instruction set ──────────────────────────────────────────────────────────────────────────
// Every unit of prose is a small program that operates on the reader. These are its opcodes. Kept
// closed and small on purpose (MDL): a few bits per unit must explain many words of prose. If an op
// needs a paragraph to state, it is paraphrase, not structure.
export type EntityKind = "character" | "place" | "object" | "faction" | "concept";
export type SenseChannel = "sight" | "sound" | "smell" | "touch" | "taste" | "body";
export type QuestionKind = "mystery" | "threat" | "desire" | "irony";
/** How the reader came to believe something — shown beats told beats suspected. */
export type Ground = "shown" | "told" | "suspected";
/**
 * What a unit's causal grounding traces to. Deliberately excludes entities — reactivating a person,
 * place, or object already has its own op (`recall`); this is for the cases that aren't a re-
 * activatable thing: a fact paying off, or the diffuse shape of everything read so far. `unit` (a
 * pinpointed earlier moment that isn't a fact) is NOT in this set on purpose: the carried state a
 * window receives is entities/facts/questions only — no raw per-unit ledger survives compaction —
 * so a model has nothing to validate a bare unit reference against. Adding it needs carrying a gist
 * ledger forward first, not just a new enum value.
 */
export type GroundBasis = "fact" | "recap";

export type Op =
  /** A thing enters the reader's model for the first time. */
  | { op: "entity"; id: string; kind: EntityKind; name: string; note?: string }
  /** Canon: a durable, trackable truth. Re-asserting a key supersedes it. */
  | { op: "fact"; key: string; value: string; about?: string }
  /** What the reader now believes about someone — the belief register, which can be wrong. */
  | { op: "believe"; about: string; claim: string; ground: Ground }
  /** A typed edge between two entities. Valence −2 hostile … +2 warm. */
  | { op: "relate"; from: string; to: string; kind: string; valence: number; note?: string }
  /** The POV's location changed. */
  | { op: "move"; to: string }
  /** Who/what is on stage right now. */
  | { op: "present"; ids: string[] }
  /** Concrete sensory detail attached to an entity — this is what makes a thing FEEL real. */
  | { op: "sense"; about: string; channel: SenseChannel; detail: string }
  /** A question the reader now wants answered. `heat` 1–3 is how badly. */
  | { op: "open"; qid: string; text: string; kind: QuestionKind; heat: number }
  /** …and its close. `subverted` = answered, but not the way the question implied. */
  | { op: "answer"; qid: string; note?: string; subverted?: boolean }
  /** Mere reactivation: something dormant got touched. This is what separates a plant from scenery. */
  | { op: "touch"; ids: string[] }
  /** Something earlier is deliberately recalled — a callback the reader is asked to hold. */
  | { op: "recall"; id: string; note?: string }
  /**
   * THIS unit's content only makes sense because of something already established — not a person,
   * place, or object stirring back to life (`recall`'s job), but a fact paying off, or the general
   * shape of everything read so far. Always fired at the unit where the connection becomes visible,
   * pointing BACKWARD: a setup unit never forward-declares its own future importance, the same
   * asymmetry `recall` already relies on. Distinct from mere immersion (`sense`), which carries no
   * dependency on prior state at all.
   */
  | { op: "ground"; basis: GroundBasis; ref?: string; note: string }
  /** The felt state. tension 0–10, warmth −5…+5. */
  | { op: "affect"; tension: number; warmth: number };

/** What one unit of prose did to the reader. */
export interface UnitDelta {
  i: number;
  ops: Op[];
  /** One clause, in the reader's voice, on what this unit changed. Free-text, for the timeline. */
  gist?: string;
  /**
   * This unit was never actually read — its window failed and it folds as a no-op so that time (and
   * therefore forgetting) still advances across the gap.
   *
   * It MUST be marked. An unread stretch and a genuinely quiet stretch fold identically, so without
   * this flag a pipeline failure reads as a reader losing interest — a plausible, completely wrong
   * finding. It is also what lets a resumed run tell "already paid for" from "still owed".
   */
  failed?: true;
}

// ── the state a fold produces ────────────────────────────────────────────────────────────────────
export interface Entity {
  id: string;
  kind: EntityKind;
  name: string;
  note?: string;
  firstSeen: number;
  lastSeen: number;
  /** Every unit that mentioned/touched it — the raw material for importance. */
  mentions: number;
  /**
   * ACTIVATED MEMORY. Spikes on mention, decays with every unit that ignores it. This is the formal
   * model of "the reader forgot", and it is what makes importance measurable rather than asserted:
   * a detail is a plant iff something later REACTIVATES it.
   */
  activation: number;
  /** Peak activation ever reached — how loud this thing ever got. */
  peak: number;
  /** Distinct sensory channels the prose has attached. Immersion is built, not declared. */
  senses: { channel: SenseChannel; detail: string; at: number }[];
  beliefs: { claim: string; ground: Ground; at: number }[];
  /** Units at which this was deliberately recalled — callbacks the reader was asked to hold. */
  recalls: number[];
}

export interface Relation {
  from: string;
  to: string;
  kind: string;
  valence: number;
  note?: string;
  at: number;
}

export interface Question {
  qid: string;
  text: string;
  kind: QuestionKind;
  heat: number;
  openedAt: number;
  answeredAt?: number;
  subverted?: boolean;
  note?: string;
}

export interface Fact {
  key: string;
  value: string;
  about?: string;
  at: number;
}

/** One `ground` op, folded — a causal edge from the unit where it was recognised back to its basis. */
export interface Grounding {
  /** The PAYOFF unit — where the connection became visible, never the setup unit. */
  at: number;
  basis: GroundBasis;
  /** A fact key, present when basis is "fact"; absent (diffuse) when basis is "recap". */
  ref?: string;
  note: string;
}

export interface BrainState {
  /** The unit this snapshot is AFTER. −1 = before the first line. */
  at: number;
  entities: Record<string, Entity>;
  facts: Record<string, Fact>;
  relations: Relation[];
  questions: Question[];
  /** Where the POV is now. */
  place: string | null;
  /** Who is on stage now. */
  present: string[];
  affect: { tension: number; warmth: number };
  /** Every `ground` op read so far, in reading order — the causal graph's edge list. */
  groundings: Grounding[];
}

export const emptyBrain = (): BrainState => ({
  at: -1, entities: {}, facts: {}, relations: [], questions: [],
  place: null, present: [], affect: { tension: 0, warmth: 0 }, groundings: [],
});

// ── decay ────────────────────────────────────────────────────────────────────────────────────────
// The one tuned constant in the fold. 0.93 per unit puts an untouched thing at ~half strength after
// 10 units and ~5% after 40 — roughly a page. Chosen so "did the reader still have this in mind?"
// answers on the scale of a scene, not a chapter. Everything downstream (importance, immersion,
// cold-payoff detection) reads off this, so it is the number to tune first if the model feels wrong.
export const DECAY = 0.93;
const SPIKE = 1;
const CEILING = 3;

const touch = (e: Entity, at: number, by = SPIKE): void => {
  e.activation = Math.min(CEILING, e.activation + by);
  e.peak = Math.max(e.peak, e.activation);
  e.mentions += 1;
  e.lastSeen = at;
};

// ── the fold ─────────────────────────────────────────────────────────────────────────────────────
/**
 * Apply one unit's ops. Mutates `s` — callers that need history use `foldTo`, which rebuilds from
 * scratch, so no snapshot is ever aliased.
 */
export function step(s: BrainState, delta: UnitDelta): BrainState {
  // 1. Time passes for everything BEFORE this unit's ops land. Attention is what decays; the facts
  //    and relations stay — the reader hasn't unlearned them, they have just gone quiet.
  for (const e of Object.values(s.entities)) e.activation *= DECAY;
  s.at = delta.i;

  for (const op of delta.ops) {
    switch (op.op) {
      case "entity": {
        if (!s.entities[op.id]) {
          s.entities[op.id] = {
            id: op.id, kind: op.kind, name: op.name, note: op.note,
            firstSeen: delta.i, lastSeen: delta.i, mentions: 0,
            activation: 0, peak: 0, senses: [], beliefs: [], recalls: [],
          };
        }
        touch(s.entities[op.id], delta.i);
        break;
      }
      case "fact":
        // Last write wins — re-asserting a key IS the supersede, the same lifecycle the DNA fact
        // ledger uses (assert / supersede / resolve).
        s.facts[op.key] = { key: op.key, value: op.value, about: op.about, at: delta.i };
        if (op.about && s.entities[op.about]) touch(s.entities[op.about], delta.i, 0.5);
        break;
      case "believe":
        s.entities[op.about]?.beliefs.push({ claim: op.claim, ground: op.ground, at: delta.i });
        if (s.entities[op.about]) touch(s.entities[op.about], delta.i, 0.5);
        break;
      case "relate": {
        // A relationship is re-stated, not duplicated: the latest reading of the pair wins, so the
        // graph shows what the reader believes NOW rather than every historical assertion.
        const idx = s.relations.findIndex((r) => r.from === op.from && r.to === op.to && r.kind === op.kind);
        const rel = { from: op.from, to: op.to, kind: op.kind, valence: op.valence, note: op.note, at: delta.i };
        if (idx >= 0) s.relations[idx] = rel; else s.relations.push(rel);
        for (const id of [op.from, op.to]) if (s.entities[id]) touch(s.entities[id], delta.i, 0.5);
        break;
      }
      case "move":
        s.place = op.to;
        if (s.entities[op.to]) touch(s.entities[op.to], delta.i);
        break;
      case "present":
        s.present = op.ids;
        for (const id of op.ids) if (s.entities[id]) touch(s.entities[id], delta.i, 0.5);
        break;
      case "sense":
        s.entities[op.about]?.senses.push({ channel: op.channel, detail: op.detail, at: delta.i });
        if (s.entities[op.about]) touch(s.entities[op.about], delta.i);
        break;
      case "open":
        if (!s.questions.some((q) => q.qid === op.qid)) {
          s.questions.push({ qid: op.qid, text: op.text, kind: op.kind, heat: op.heat, openedAt: delta.i });
        }
        break;
      case "answer": {
        const q = s.questions.find((x) => x.qid === op.qid && x.answeredAt === undefined);
        if (q) { q.answeredAt = delta.i; q.subverted = op.subverted; q.note = op.note; }
        break;
      }
      case "touch":
        for (const id of op.ids) if (s.entities[id]) touch(s.entities[id], delta.i);
        break;
      case "recall":
        if (s.entities[op.id]) {
          // A recall is a HARDER spike than a mention: the prose is deliberately hauling something
          // back from the cold. This is the event that turns a passed-over detail into a plant.
          touch(s.entities[op.id], delta.i, SPIKE * 2);
          s.entities[op.id].recalls.push(delta.i);
        }
        break;
      case "ground":
        // A fact does not decay (facts are canon, not attention), so unlike `recall` there is no
        // activation to spike here — just the edge itself, which is the whole point: this is the
        // causal graph's edge list, read back retrospectively via `groundedIn`, never at fold time.
        s.groundings.push({ at: delta.i, basis: op.basis, ref: op.ref, note: op.note });
        break;
      case "affect":
        s.affect = { tension: op.tension, warmth: op.warmth };
        break;
    }
  }
  return s;
}

/** The reader's brain immediately after unit `at`. Pure: rebuilds from the deltas every time. */
export function foldTo(deltas: UnitDelta[], at: number): BrainState {
  const s = emptyBrain();
  for (const d of deltas) {
    if (d.i > at) break;
    step(s, d);
  }
  return s;
}

/** One row per unit, for the timeline tracks. */
export interface Track {
  i: number;
  pull: number;
  tension: number;
  warmth: number;
  immersion: number;
  /** Entities known by now — the model the reader has accumulated. */
  known: number;
  /** Entities still live in attention — the model they are actually holding. */
  live: number;
  open: number;
}

/**
 * The whole sweep's curves in ONE pass. Deliberately not "clone the brain at every unit": the
 * entity records accumulate senses and beliefs, so 305 deep clones is megabytes to say what a few
 * numbers per unit already say. Scrubbing re-folds for the single snapshot it needs (`foldTo`);
 * the curves come from here.
 */
export function tracks(deltas: UnitDelta[]): Track[] {
  const s = emptyBrain();
  return deltas.map((d) => {
    step(s, d);
    return {
      i: d.i,
      pull: Number(pull(s).toFixed(2)),
      tension: s.affect.tension,
      warmth: s.affect.warmth,
      immersion: Number(sceneImmersion(s).toFixed(2)),
      known: Object.keys(s.entities).length,
      live: workingSet(s).length,
      open: openQuestions(s).length,
    };
  });
}

// ── derived reads ────────────────────────────────────────────────────────────────────────────────
/** Open questions at this moment, hottest first. The reason the reader turns the page. */
export const openQuestions = (s: BrainState): Question[] =>
  s.questions.filter((q) => q.answeredAt === undefined).sort((a, b) => b.heat - a.heat || a.openedAt - b.openedAt);

/**
 * PULL — how much unresolved want is live right now. Heat sums, but each question also fades: a
 * thread nobody has touched in 80 units is not pulling the way it did when it opened, even though
 * it is still technically unanswered. That fade is why "dangling thread" and "dead stretch" are
 * different findings.
 */
export function pull(s: BrainState): number {
  return openQuestions(s).reduce((n, q) => n + q.heat * Math.pow(0.995, s.at - q.openedAt), 0);
}

/**
 * IMMERSION for one entity — how vividly instantiated it is right now. Distinct sense channels
 * (breadth of the picture) × how live the thing currently is (activation). A character described
 * once 200 units ago is known but not FELT; the two are different registers and this separates them.
 */
export function immersion(e: Entity | undefined): number {
  if (!e) return 0;
  const channels = new Set(e.senses.map((x) => x.channel)).size;
  return channels * Math.min(1, e.activation / 2);
}

/** Immersion in the scene as a whole — the current place plus whoever is on stage. */
export function sceneImmersion(s: BrainState): number {
  const ids = [s.place, ...s.present].filter(Boolean) as string[];
  if (!ids.length) return 0;
  return ids.reduce((n, id) => n + immersion(s.entities[id]), 0) / ids.length;
}

/**
 * IMPORTANCE — deliberately retrospective. It is not a property of the sentence that introduced a
 * thing; it is how often the story came BACK to it, how loud it ever got, how many other things it
 * is tied to, and whether it was ever deliberately recalled. That is why it can only be computed
 * over a finished sweep, and why the forward pass must not be asked to guess it.
 */
export function importance(s: BrainState, id: string): number {
  const e = s.entities[id];
  if (!e) return 0;
  const degree = s.relations.filter((r) => r.from === id || r.to === id).length;
  return e.mentions + e.peak * 2 + degree * 1.5 + e.recalls.length * 3;
}

/** Entities ranked by importance — the cast list the story actually earned. */
export const ranked = (s: BrainState): { entity: Entity; score: number }[] =>
  Object.values(s.entities)
    .map((entity) => ({ entity, score: importance(s, entity.id) }))
    .sort((a, b) => b.score - a.score);

/**
 * Every unit that later paid a fact off, oldest first — the same retrospective move as
 * `entity.recalls`, generalised to facts. A fact does not know at assertion time whether it will
 * matter again; this is where that gets revealed, by scanning forward through the groundings that
 * named it rather than by anything stamped on the fact itself.
 */
export const groundedIn = (s: BrainState, factKey: string): Grounding[] =>
  s.groundings.filter((g) => g.basis === "fact" && g.ref === factKey);

/**
 * GROUPING, derived rather than declared. Connected components of the relation graph: the clumps a
 * reader actually holds together ("the Sorrengail family", "everyone at the college") without anyone
 * having to name them. Each cluster is titled by its highest-importance member, because that is how
 * readers refer to a group they have no word for — by its most salient person.
 *
 * Singletons are dropped: a thing tied to nothing is not a group, it is a loose end, and it is
 * already visible in the working set and the importance ranking.
 */
export function clusters(s: BrainState): { label: string; members: Entity[] }[] {
  const parent: Record<string, string> = {};
  const find = (x: string): string => (parent[x] === undefined || parent[x] === x ? (parent[x] = x) : (parent[x] = find(parent[x])));
  const union = (a: string, b: string) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  for (const id of Object.keys(s.entities)) find(id);
  for (const r of s.relations) if (s.entities[r.from] && s.entities[r.to]) union(r.from, r.to);

  const groups = new Map<string, Entity[]>();
  for (const e of Object.values(s.entities)) {
    const root = find(e.id);
    groups.set(root, [...(groups.get(root) ?? []), e]);
  }
  return [...groups.values()]
    .filter((members) => members.length > 1)
    .map((members) => {
      const sorted = members.slice().sort((a, b) => importance(s, b.id) - importance(s, a.id));
      return { label: sorted[0].name, members: sorted };
    })
    .sort((a, b) => b.members.length - a.members.length);
}

// ── depth of mind ────────────────────────────────────────────────────────────────────────────────
/**
 * The reader's model, stratified by how present each thing is — not by what type it is.
 *
 * This is the layout axis for the reader view, and the reason it is here rather than in a component:
 * a mind is not organised by category. A person, a place, a fact and an unanswered question can all
 * be equally on top of mind, and the same item sinks as the story moves on. Grouping by *kind* is a
 * filing cabinet; grouping by *depth* is a mind.
 *
 * It is also the Global Workspace shape (`.doc_1786257284000`): `front` is roughly the ignited
 * workspace, `back` is the store you hold but are not thinking with.
 */
export type MindItem =
  | { type: "entity"; salience: number; entity: Entity }
  | { type: "question"; salience: number; question: Question }
  | { type: "fact"; salience: number; fact: Fact };

export interface MindLayers {
  /** On top of mind — what the reader is thinking WITH right now. */
  front: MindItem[];
  /** Drifting — still reachable without effort, but no longer in hand. */
  middle: MindItem[];
  /** Back of mind — known, and currently quiet. */
  back: MindItem[];
}

const FRONT = 1.0;
const MIDDLE = 0.25;

/**
 * Salience is deliberately comparable ACROSS types, because the bands mix them. The three decay
 * differently, and that difference is the interesting part:
 *   • an entity fades with attention (it is forgotten),
 *   • an open question fades only halfway (an unanswered question keeps nagging — that is what
 *     makes it a question), and
 *   • a fact settles into background knowledge (you do not forget it, you stop thinking about it).
 */
export function mindLayers(s: BrainState): MindLayers {
  const items: MindItem[] = [
    ...Object.values(s.entities).map((entity): MindItem => ({ type: "entity", salience: entity.activation, entity })),
    ...s.questions.filter((q) => q.answeredAt === undefined).map((question): MindItem => ({
      type: "question",
      // Floor at half its heat: a nagging thread never drops all the way out of mind.
      salience: (question.heat / 3) * 2 * (0.5 + 0.5 * Math.pow(0.99, Math.max(0, s.at - question.openedAt))),
      question,
    })),
    ...Object.values(s.facts).map((fact): MindItem => ({
      type: "fact",
      salience: 1.5 * Math.pow(0.97, Math.max(0, s.at - fact.at)),
      fact,
    })),
  ].sort((a, b) => b.salience - a.salience);

  return {
    front: items.filter((i) => i.salience >= FRONT),
    middle: items.filter((i) => i.salience < FRONT && i.salience >= MIDDLE),
    back: items.filter((i) => i.salience < MIDDLE),
  };
}

/** A stable label for a mind item, whatever its type. */
export const itemLabel = (i: MindItem): string =>
  i.type === "entity" ? i.entity.name
  : i.type === "question" ? i.question.text
  : `${i.fact.key.replace(/_/g, " ")}: ${i.fact.value}`;

/** A stable key for React lists. */
export const itemKey = (i: MindItem): string =>
  i.type === "entity" ? `e:${i.entity.id}` : i.type === "question" ? `q:${i.question.qid}` : `f:${i.fact.key}`;

// ── what just happened ───────────────────────────────────────────────────────────────────────────
/**
 * The change between two consecutive frames. Derived by comparing two folds rather than by reading
 * the unit's ops, and that difference matters: the ops say what the prose *asserted*, the diff says
 * what actually *landed*. An op naming an already-known fact with the same value changes nothing; a
 * single `touch` can move an entity from forgotten to foreground. Only the diff knows which.
 *
 * Free, because both frames are pure folds of the same delta list.
 */
export interface BrainDiff {
  met: Entity[];
  recalled: Entity[];
  /** Entities whose activation rose — the reader's attention moving. */
  woke: { entity: Entity; from: number; to: number }[];
  /** Entities that dropped out of the working set entirely — the reader letting go. */
  faded: Entity[];
  learned: Fact[];
  revised: { key: string; was: string; now: string }[];
  wondered: Question[];
  resolved: Question[];
  tied: Relation[];
  /** `ground` ops that fired on this frame — this unit's causal dependency on earlier material. */
  grounded: Grounding[];
  sensed: { entity: Entity; channel: SenseChannel; detail: string }[];
  believed: { entity: Entity; claim: string; ground: Ground }[];
  moved: { from: Entity | null; to: Entity | null } | null;
  entered: Entity[];
  left: Entity[];
  felt: { tension: number; warmth: number; dTension: number } | null;
}

export function diffBrains(prev: BrainState, next: BrainState): BrainDiff {
  const ent = (id: string) => next.entities[id];
  const prevOpen = new Set(prev.questions.filter((q) => q.answeredAt === undefined).map((q) => q.qid));
  const nextOpen = new Set(next.questions.filter((q) => q.answeredAt === undefined).map((q) => q.qid));
  const LIVE = 0.15;   // same floor workingSet uses, so "faded" means "left the working set"

  return {
    met: Object.values(next.entities).filter((e) => !prev.entities[e.id]),
    recalled: Object.values(next.entities)
      .filter((e) => e.recalls.length > (prev.entities[e.id]?.recalls.length ?? 0)),
    woke: Object.values(next.entities)
      .filter((e) => prev.entities[e.id] && e.activation > prev.entities[e.id].activation + 0.01)
      .map((e) => ({ entity: e, from: prev.entities[e.id].activation, to: e.activation }))
      .sort((a, b) => (b.to - b.from) - (a.to - a.from)),
    faded: Object.values(next.entities)
      .filter((e) => (prev.entities[e.id]?.activation ?? 0) >= LIVE && e.activation < LIVE),
    learned: Object.values(next.facts).filter((f) => !prev.facts[f.key]),
    revised: Object.values(next.facts)
      .filter((f) => prev.facts[f.key] && prev.facts[f.key].value !== f.value)
      .map((f) => ({ key: f.key, was: prev.facts[f.key].value, now: f.value })),
    wondered: next.questions.filter((q) => !prevOpen.has(q.qid) && nextOpen.has(q.qid)),
    resolved: next.questions.filter((q) => prevOpen.has(q.qid) && !nextOpen.has(q.qid)),
    tied: next.relations.filter((r) => r.at === next.at),
    grounded: next.groundings.filter((g) => g.at === next.at),
    sensed: Object.values(next.entities).flatMap((e) =>
      e.senses.filter((s) => s.at === next.at).map((s) => ({ entity: e, channel: s.channel, detail: s.detail }))),
    believed: Object.values(next.entities).flatMap((e) =>
      e.beliefs.filter((b) => b.at === next.at).map((b) => ({ entity: e, claim: b.claim, ground: b.ground }))),
    moved: prev.place !== next.place
      ? { from: prev.place ? prev.entities[prev.place] ?? null : null, to: next.place ? ent(next.place) ?? null : null }
      : null,
    entered: next.present.filter((id) => !prev.present.includes(id)).map(ent).filter(Boolean) as Entity[],
    left: prev.present.filter((id) => !next.present.includes(id)).map(ent).filter(Boolean) as Entity[],
    felt: prev.affect.tension !== next.affect.tension || prev.affect.warmth !== next.affect.warmth
      ? { ...next.affect, dTension: next.affect.tension - prev.affect.tension }
      : null,
  };
}

/** Did this unit change anything at all? Used to mark the "nothing happened" frames honestly. */
export const diffIsEmpty = (d: BrainDiff): boolean =>
  !d.met.length && !d.recalled.length && !d.learned.length && !d.revised.length && !d.wondered.length &&
  !d.resolved.length && !d.tied.length && !d.grounded.length && !d.sensed.length && !d.believed.length &&
  !d.moved && !d.entered.length && !d.left.length && !d.felt && !d.woke.length;

/** What is live in the reader's head right now, loudest first — the working set. */
export const workingSet = (s: BrainState, min = 0.15): Entity[] =>
  Object.values(s.entities).filter((e) => e.activation >= min).sort((a, b) => b.activation - a.activation);
