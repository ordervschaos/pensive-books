// dna-decompose-core — the PURE half of the imported-draft semantic ascent: read shapes, chapter
// assembly, and op builders. Lives in _shared so the dna-decompose edge fn (Deno) and the web test
// suite (vitest — same trick as novelDna.parity.test.ts) import the SAME file: no client/edge mirror
// to drift. No I/O, no Deno APIs — only ./novel-dna.ts (the engine twin, itself pure).
//
// Ops are a deliberately narrow subset of the web validateOps vocabulary: content EDITS to named
// nodes and ADDS with PRE-MINTED ids (so a batch can self-reference: relationships → characters,
// games → world facts, beat links → threads/games/tentpoles). The edge fn applies them fail-closed:
// locked nodes are never edited, adds are stamped and appended.
import {
  gameTwins, newId, pillarOf,
  type DnaNode, type NodeContent, type NodeKind,
} from "./novel-dna.ts";

// ── Read shapes (what the LLM steps return, post-rails) ──────────────────────────────────────────
export interface ChapterRead { beat: { summary?: string; connector?: string; polarity?: string }; digest: string }
export interface TopRead {
  seed?: { logline?: string };
  premise?: { dramatic_question?: string; shape?: { name?: string; movements?: string[]; ending_feel?: string } };
  pillar?: { controlling_idea?: string; ending?: string };
}
export interface EntitiesRead {
  characters?: { name?: string; role?: string; want?: string; need?: string; wound?: string; tag?: string }[];
  relationships?: { a?: string; b?: string; bond?: string; charge?: string }[];
  locations?: { name?: string; summary?: string; mood?: string; sight?: string; sound?: string; smell?: string }[];
  voice?: { pov?: string; tense?: string; style?: string; constraints?: string[] };
}
export interface SystemsRead {
  world_facts?: { name?: string; rule?: string; mechanism?: string; category?: string }[];
  threads?: { name?: string; kind?: string; promise?: string; payoff?: string; setup_chapter?: number; payoff_chapter?: number }[];
  games?: { name?: string; players?: string[]; win_condition?: string; lose_condition?: string; stake?: string; governing_rules?: string[]; outcome?: string; resolved_chapter?: number }[];
  tentpoles?: { name?: string; summary?: string; realized_chapter?: number }[];
  meters?: { name?: string; kind?: string; poles?: { low?: string; high?: string }; scale?: { min?: number; max?: number } }[];
}
export interface ActsRead {
  acts?: { title?: string; goal?: string; turning_point?: string; start_chapter?: number }[];
}

// ── Ops (the narrow apply vocabulary) ─────────────────────────────────────────────────────────────
export type CoreOp =
  | { op: "edit"; id: string; content: NodeContent }
  | { op: "add"; kind: NodeKind; parentId: string; id: string; content: NodeContent }
  // move/delete exist for act re-segmentation: beats re-home onto the new acts BEFORE the old act is
  // deleted (FK cascade would otherwise take the whole spine down with it).
  | { op: "move"; id: string; parentId: string; position: number }
  | { op: "delete"; id: string };
export interface CoreOps { ops: CoreOp[]; skipped: string[] }

const drop = (c: Record<string, unknown>): NodeContent =>
  Object.fromEntries(Object.entries(c).filter(([, v]) => v != null && v !== "" && (!Array.isArray(v) || v.length))) as NodeContent;

/** Lowercased identity of an existing entity node, for idempotent re-runs (a re-run must not
 *  double-mint the cast/world). Every kind keys on name; a legacy tentpole with no name falls back to summary. */
const identityOf = (n: DnaNode): string => {
  const c = n.content as { name?: string; summary?: string };
  return String((n.kind === "tentpole" ? c.name || c.summary : c.name) ?? "").trim().toLowerCase();
};
const existingIdentities = (nodes: DnaNode[], kind: NodeKind): Set<string> =>
  new Set(nodes.filter((n) => n.kind === kind).map(identityOf).filter(Boolean));

// ── Chapter assembly ──────────────────────────────────────────────────────────────────────────────
export interface DecomposeChapter { beatId: string; title: string; text: string }
const proseOf = (n: DnaNode): string => ((n.content as { prose?: { text?: string } }).prose?.text ?? "").trim();
const posSort = (a: DnaNode, b: DnaNode) => a.position - b.position;

/** The beats in reading order, each with its chapter title + concatenated scene prose. */
export function chaptersOf(nodes: DnaNode[]): DecomposeChapter[] {
  const acts = nodes.filter((n) => n.kind === "act").sort(posSort);
  const out: DecomposeChapter[] = [];
  for (const act of acts) {
    for (const beat of nodes.filter((n) => n.kind === "beat" && n.parent_id === act.id).sort(posSort)) {
      const text = nodes.filter((n) => n.kind === "scene" && n.parent_id === beat.id).sort(posSort)
        .map(proseOf).filter(Boolean).join("\n\n");
      if (!text) continue; // nothing to read
      const c = beat.content as { summary?: string; title?: string };
      out.push({ beatId: beat.id, title: (c.summary ?? c.title ?? "").trim(), text });
    }
  }
  return out;
}

// ── Op builders ───────────────────────────────────────────────────────────────────────────────────
/** The three top-rung edit ops from a "top" read (only rungs that exist and got content). */
export function topOps(nodes: DnaNode[], top: TopRead): CoreOp[] {
  const ops: CoreOp[] = [];
  const rung = (kind: string, content: NodeContent | undefined) => {
    const node = nodes.find((n) => n.kind === kind);
    if (node && content && Object.values(content).some((v) => v != null && v !== "")) {
      ops.push({ op: "edit", id: node.id, content });
    }
  };
  rung("seed", top.seed as NodeContent | undefined);
  rung("premise", top.premise as NodeContent | undefined);
  rung("pillar", top.pillar as NodeContent | undefined);
  return ops;
}

/** Act re-segmentation ops from an "acts" read: mint the new act rung under the pillar, MOVE every
 *  beat onto its act by chapter range, then DELETE the old acts (safe: their beats have re-homed —
 *  emitted in that order on purpose). Rails: needs ≥2 valid acts (else the single act stands),
 *  boundaries clamped into range, first act always starts at chapter 1, non-increasing starts drop. */
export function actOps(nodes: DnaNode[], read: ActsRead, chapterBeatIds: string[]): CoreOps {
  const pillar = pillarOf(nodes);
  if (!pillar) return { ops: [], skipped: ["no pillar to attach acts to"] };
  const total = chapterBeatIds.length;
  const starts: { title?: string; goal?: string; turning_point?: string; start: number }[] = [];
  for (const a of read.acts ?? []) {
    const start = a.start_chapter;
    if (typeof start !== "number" || start < 1 || start > total) continue;
    if (starts.length && start <= starts[starts.length - 1].start) continue; // must strictly increase
    starts.push({ title: a.title, goal: a.goal, turning_point: a.turning_point, start });
  }
  if (starts.length >= 1) starts[0].start = 1; // the first act owns the opening no matter what the model said
  if (starts.length < 2) return { ops: [], skipped: [`act read returned ${starts.length} usable act(s) — keeping the single act`] };

  const ops: CoreOp[] = [];
  const oldActs = nodes.filter((n) => n.kind === "act");
  starts.forEach((a, i) => {
    const actId = newId();
    ops.push({
      op: "add", kind: "act", parentId: pillar.id, id: actId,
      content: drop({ title: a.title, goal: a.goal, turning_point: a.turning_point }),
    });
    const end = i + 1 < starts.length ? starts[i + 1].start - 1 : total;
    for (let ch = a.start; ch <= end; ch++) {
      ops.push({ op: "move", id: chapterBeatIds[ch - 1], parentId: actId, position: ch - a.start });
    }
  });
  for (const act of oldActs) ops.push({ op: "delete", id: act.id });
  return { ops, skipped: [] };
}

/** Entity ops from an "entities" read. Characters get PRE-MINTED ids so same-batch relationships can
 *  reference them; name→id resolution happens here — a relationship naming an unknown character is
 *  skipped (rail), never guessed. Re-run safe: names already in the tree are not re-added. */
export function entityOps(nodes: DnaNode[], e: EntitiesRead): CoreOps {
  const pillar = pillarOf(nodes);
  if (!pillar) return { ops: [], skipped: ["no pillar to attach entities to"] };
  const ops: CoreOp[] = [];
  const skipped: string[] = [];

  const idByName = new Map<string, string>();
  for (const n of nodes.filter((x) => x.kind === "character")) {
    const name = identityOf(n);
    if (name) idByName.set(name, n.id);
  }
  for (const c of e.characters ?? []) {
    const key = (c.name ?? "").trim().toLowerCase();
    if (!key || idByName.has(key)) continue;
    const id = newId();
    idByName.set(key, id);
    ops.push({ op: "add", kind: "character", parentId: pillar.id, id, content: drop({ ...c }) });
  }
  // Relationship identity = the unordered character pair — dedupe against the tree AND the batch
  // (a re-run must not re-add Mara↔Postman just because the bond text came back worded differently).
  const relSeen = new Set(
    nodes.filter((n) => n.kind === "relationship").map((n) => {
      const c = n.content as { a?: string; b?: string };
      return [c.a ?? "", c.b ?? ""].sort().join("↔");
    }),
  );
  for (const r of e.relationships ?? []) {
    const a = idByName.get((r.a ?? "").trim().toLowerCase());
    const b = idByName.get((r.b ?? "").trim().toLowerCase());
    if (!a || !b || a === b) { skipped.push(`relationship ${r.a ?? "?"} ↔ ${r.b ?? "?"} (unresolved character)`); continue; }
    const key = [a, b].sort().join("↔");
    if (relSeen.has(key)) continue;
    relSeen.add(key);
    ops.push({ op: "add", kind: "relationship", parentId: pillar.id, id: newId(), content: drop({ a, b, bond: r.bond, charge: r.charge }) });
  }
  const locSeen = existingIdentities(nodes, "location");
  for (const l of e.locations ?? []) {
    const key = (l.name ?? "").trim().toLowerCase();
    if (!key || locSeen.has(key)) continue;
    locSeen.add(key);
    ops.push({ op: "add", kind: "location", parentId: pillar.id, id: newId(), content: drop({ ...l }) });
  }
  const v = e.voice ?? {};
  if (v.style) {
    const existing = nodes.find((n) => n.kind === "voice_profile");
    const content = drop({ ...v });
    ops.push(existing
      ? { op: "edit", id: existing.id, content }
      : { op: "add", kind: "voice_profile", parentId: pillar.id, id: newId(), content });
  }
  return { ops, skipped };
}

/** Story-system ops from a "systems" read: world facts / threads / games / tentpoles / meters onto
 *  the pillar, PLUS beat-level links assembled from the read's 1-based chapter numbers (threads'
 *  setup/payoff, tentpoles' realizes, games' resolves) — the joins the obligation ledger and vertical
 *  lints run on. Games resolve player names against the (post-entities) cast and rule names against
 *  this batch's world facts. `chapterBeatIds` = beat id per digest index, in digest order. */
export function systemsOps(nodes: DnaNode[], s: SystemsRead, chapterBeatIds: string[]): CoreOps {
  const pillar = pillarOf(nodes);
  if (!pillar) return { ops: [], skipped: ["no pillar to attach systems to"] };
  const ops: CoreOp[] = [];
  const skipped: string[] = [];
  const charIdByName = new Map<string, string>();
  for (const n of nodes.filter((x) => x.kind === "character")) {
    const name = identityOf(n);
    if (name) charIdByName.set(name, n.id);
  }
  const beatAt = (chapter: number | undefined): string | undefined =>
    chapter != null && chapter >= 1 && chapter <= chapterBeatIds.length ? chapterBeatIds[chapter - 1] : undefined;

  // Beat-link accumulator — several systems can point at the same chapter; merge into one edit per beat.
  const beatPatch = new Map<string, { threads: { ref: string; role: string }[]; realizes: string[]; resolves: { ref: string; outcome: string }[] }>();
  const patchFor = (beatId: string) => {
    let p = beatPatch.get(beatId);
    if (!p) { p = { threads: [], realizes: [], resolves: [] }; beatPatch.set(beatId, p); }
    return p;
  };
  const link = (chapter: number | undefined, what: string, apply: (beatId: string) => void) => {
    if (chapter == null) return;
    const beatId = beatAt(chapter);
    if (beatId) apply(beatId);
    else skipped.push(`${what} → chapter ${chapter} (out of range)`);
  };

  const seen = {
    world_fact: existingIdentities(nodes, "world_fact"),
    thread: existingIdentities(nodes, "thread"),
    game: existingIdentities(nodes, "game"),
    tentpole: existingIdentities(nodes, "tentpole"),
    meter: existingIdentities(nodes, "meter"),
  };
  const fresh = (kind: keyof typeof seen, key: string | undefined): boolean => {
    const k = (key ?? "").trim().toLowerCase();
    if (!k || seen[kind].has(k)) return false;
    seen[kind].add(k);
    return true;
  };

  const wfIdByName = new Map<string, string>();
  for (const n of nodes.filter((x) => x.kind === "world_fact")) {
    const name = identityOf(n);
    if (name) wfIdByName.set(name, n.id);
  }
  for (const w of s.world_facts ?? []) {
    if (!fresh("world_fact", w.name)) continue;
    const id = newId();
    if (w.name) wfIdByName.set(w.name.trim().toLowerCase(), id);
    ops.push({ op: "add", kind: "world_fact", parentId: pillar.id, id, content: drop({ ...w }) });
  }
  for (const t of s.threads ?? []) {
    if (!fresh("thread", t.name)) continue;
    const { setup_chapter, payoff_chapter, ...content } = t;
    const id = newId();
    ops.push({ op: "add", kind: "thread", parentId: pillar.id, id, content: drop({ ...content }) });
    link(setup_chapter, `thread "${t.name}" setup`, (b) => patchFor(b).threads.push({ ref: id, role: "setup" }));
    link(payoff_chapter, `thread "${t.name}" payoff`, (b) => patchFor(b).threads.push({ ref: id, role: "payoff" }));
  }
  for (const g of s.games ?? []) {
    if (!fresh("game", g.name)) continue;
    const { players, governing_rules, outcome, resolved_chapter, ...content } = g;
    const id = newId();
    const resolvedPlayers = (players ?? []).map((p) => charIdByName.get(p.trim().toLowerCase())).filter((x): x is string => !!x);
    const resolvedRules = (governing_rules ?? []).map((r) => wfIdByName.get(r.trim().toLowerCase())).filter((x): x is string => !!x);
    ops.push({ op: "add", kind: "game", parentId: pillar.id, id, content: drop({ ...content, players: resolvedPlayers, governing_rules: resolvedRules }) });
    if (outcome) link(resolved_chapter, `game "${g.name}" resolution`, (b) => patchFor(b).resolves.push({ ref: id, outcome }));
  }
  for (const t of s.tentpoles ?? []) {
    if (!fresh("tentpole", t.name || t.summary)) continue;
    const { realized_chapter, ...content } = t;
    const id = newId();
    ops.push({ op: "add", kind: "tentpole", parentId: pillar.id, id, content: drop({ ...content }) });
    link(realized_chapter, `tentpole "${(t.name || t.summary || "").slice(0, 40)}"`, (b) => patchFor(b).realizes.push(id));
  }
  for (const m of s.meters ?? []) {
    if (!fresh("meter", m.name)) continue;
    ops.push({ op: "add", kind: "meter", parentId: pillar.id, id: newId(), content: drop({ ...m }) });
  }

  for (const [beatId, p] of beatPatch) {
    ops.push({ op: "edit", id: beatId, content: drop({ threads: p.threads, realizes: p.realizes, resolves: p.resolves }) });
  }
  return { ops, skipped };
}

/** Game-twin ops (mirror of the web reconcileGameTwins, expressed as CoreOps): mint the missing
 *  `game_score` meter + resolution thread for every game, keyed on content.owner = game id. */
export function gameTwinOps(nodes: DnaNode[]): CoreOp[] {
  const pillar = pillarOf(nodes);
  if (!pillar) return [];
  const hasMeter = new Set(nodes.filter((n) => n.kind === "meter").map((n) => `${(n.content as { owner?: string }).owner}:${(n.content as { kind?: string }).kind}`));
  const hasThread = new Set(nodes.filter((n) => n.kind === "thread").map((n) => (n.content as { owner?: string }).owner));
  const ops: CoreOp[] = [];
  for (const game of nodes.filter((n) => n.kind === "game")) {
    const twins = gameTwins(game);
    if (!hasMeter.has(`${game.id}:game_score`)) ops.push({ op: "add", kind: "meter", parentId: pillar.id, id: newId(), content: twins.meter as NodeContent });
    if (!hasThread.has(game.id)) ops.push({ op: "add", kind: "thread", parentId: pillar.id, id: newId(), content: twins.thread as NodeContent });
  }
  return ops;
}
