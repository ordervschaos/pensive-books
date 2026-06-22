// novelDna — the pure engine for the Novel DNA tree. The book IS this tree (docs/novel-dna-schema.md);
// pages/chapters are projections (docs/novel-dna-spec.md). This module is PURE: it operates on in-memory
// node arrays — no DB, no LLM — so the whole build system (edit/lock/choose, staleness, blast radius,
// validation, the render predicate) is unit-testable. Persistence + expand(LLM) + reconcile live elsewhere.
import { metaHash } from "@/lib/planProvenance";

// ── Kinds ─────────────────────────────────────────────────────────────────────
export const LADDER_KINDS = ["seed", "premise", "pillar", "movement", "beat", "scene"] as const;
export const ENTITY_KINDS = ["character", "relationship", "tentpole", "world_fact", "thread"] as const;
export type LadderKind = (typeof LADDER_KINDS)[number];
export type EntityKind = (typeof ENTITY_KINDS)[number];
export type NodeKind = LadderKind | EntityKind;
export const isEntityKind = (k: NodeKind): k is EntityKind => (ENTITY_KINDS as readonly string[]).includes(k);

export type AuthoringSource = "user" | "ai" | "ai_then_user";
export type AuthoringStatus = "empty" | "proposed" | "draft" | "accepted";

export interface Authoring {
  source: AuthoringSource;
  locked: boolean;
  status: AuthoringStatus;
  src_hash?: string; // hash of this node's INPUT SET when last generated/accepted
  prose_src_hash?: string; // scenes — hash of the scene plan the prose was written from
}

// ── Content shapes (the schema contract, §3/§4) ───────────────────────────────
// polarity: does the value end better (up) or worse (down) — feeds the emotional-topography axis (§6).
export interface ValueShift { value: string; from: string; to: string; polarity?: "up" | "down" }
export interface SeedContent { logline?: string }
export interface PremiseContent { genre?: string[]; tone?: string[]; dramatic_question?: string; shape?: { setup?: string; turn1?: string; turn2?: string; turn3?: string; resolution?: string } }
export interface PillarContent { controlling_idea?: string; ending?: string }
// target_pct: where this act's turning_point should land in the book (0–1) — the pacing intent (§6).
export interface MovementContent { title?: string; goal?: string; turning_point?: string; target_pct?: number; value?: ValueShift }
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
export interface BeatContent { summary?: string; connector?: "therefore" | "but"; polarity?: "up" | "down"; threads?: ThreadRef[]; realizes?: string[]; grounds_in?: string[] }
export interface ChapterStart { title?: string; pov?: string; epigraph?: string }
export interface SceneContent {
  pov?: string; loc?: string; time?: { when?: string; elapsed?: string };
  present?: string[]; goal?: string; conflict?: string; outcome?: string;
  value_shift?: ValueShift;
  threads?: ThreadRef[];               // promise anchors this scene plants/pays → thread registry
  advances?: { ref: string; how?: string }[];  // relationship charge this scene moves → relationship nodes
  realizes_tentpole?: string | null;
  grounds_in?: string[];               // world_fact ids whose mechanism this scene's outcome operates on
  chapter_start?: ChapterStart | null;
  prose?: { text?: string; words?: number };
}
export interface CharacterContent { name?: string; role?: "protagonist" | "antagonist" | "ally" | "love_interest" | "minor"; want?: string; need?: string; wound?: string; lie?: string; truth?: string; idiolect?: string; tag?: string }
export interface RelationshipContent { a?: string; b?: string; bond?: string; charge?: string }
export interface TentpoleContent { summary?: string }
// name = a short handle (so beats/scenes can reference the rule); mechanism = the OPERABLE rule — what it
// enables or forbids, with inputs→outputs — not just atmosphere. The climax's win must fire a mechanism.
export interface WorldFactContent { name?: string; rule?: string; mechanism?: string; category?: string }
// thread (← foundations.threads): the promise registry — one node both ends point at (§4.5).
export interface ThreadContent { name?: string; promise?: string; payoff?: string; kind?: "mystery" | "foreshadow" | "setup_payoff" | "arc" }
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
  proposals?: { id: string; content: NodeContent }[];
  chosen?: string | null;
}

// ── Ids ───────────────────────────────────────────────────────────────────────
export const newId = () => `n_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;

// ── Tree helpers ──────────────────────────────────────────────────────────────
export const byId = (nodes: DnaNode[]): Map<string, DnaNode> => new Map(nodes.map((n) => [n.id, n]));
export const childrenOf = (nodes: DnaNode[], parentId: string | null): DnaNode[] =>
  nodes.filter((n) => n.parent_id === parentId).sort((a, b) => a.position - b.position);

/** Scenes in reading order: DFS of the narrative spine (movements→beats→scenes, each by position). */
export function scenesInOrder(nodes: DnaNode[]): DnaNode[] {
  const out: DnaNode[] = [];
  const walk = (n: DnaNode) => {
    if (n.kind === "scene") out.push(n);
    for (const c of childrenOf(nodes, n.id)) if (!isEntityKind(c.kind)) walk(c);
  };
  for (const root of nodes.filter((n) => n.parent_id === null)) walk(root);
  // Also handle trees whose roots are movements directly (no single root) — entities excluded above.
  if (!out.length) for (const m of nodes.filter((n) => n.kind === "movement")) walk(m);
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
// A chapter → a SECTION page (title) + a TEXT page (its scenes' prose, concatenated). Pure: the DB
// reconcile (novelDnaRender.reconcileDna) applies this list to `pages`. nodeId is the stable page key.
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
    if (Array.isArray(c.present)) out.push(...c.present);
    if (c.realizes_tentpole) out.push(c.realizes_tentpole);
    if (Array.isArray(c.threads)) out.push(...c.threads.map((t) => t.ref).filter(Boolean));
    if (Array.isArray(c.advances)) out.push(...c.advances.map((a) => a.ref).filter(Boolean));
    if (Array.isArray(c.grounds_in)) out.push(...c.grounds_in.filter(Boolean));
  } else if (node.kind === "beat") {
    const c = node.content as BeatContent;
    if (Array.isArray(c.threads)) out.push(...c.threads.map((t) => t.ref).filter(Boolean));
    if (Array.isArray(c.grounds_in)) out.push(...c.grounds_in.filter(Boolean));
  } else if (node.kind === "relationship") {
    const c = node.content as RelationshipContent;
    if (c.a) out.push(c.a);
    if (c.b) out.push(c.b);
  }
  return [...new Set(out)];
}

/** Hash of a node's full input set: its parent's content + every referenced entity's content. */
export function inputHash(node: DnaNode, index: Map<string, DnaNode>): string {
  const parent = node.parent_id ? index.get(node.parent_id) : null;
  const refs = refsOf(node).map((id) => index.get(id)?.content ?? null);
  return metaHash(stableStringify([parent?.content ?? null, ...refs]));
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
  const { prose: _p, ...plan } = c;
  return scene.authoring.prose_src_hash !== metaHash(stableStringify(plan));
}

/** Stamp a node's input hash (call when it's generated/accepted from its current inputs). */
export function stampInput(node: DnaNode, index: Map<string, DnaNode>): DnaNode {
  return { ...node, authoring: { ...node.authoring, src_hash: inputHash(node, index) } };
}
/** Stamp a scene's prose hash (call after prose is written from the current plan). */
export function stampProse(scene: DnaNode): DnaNode {
  const { prose: _p, ...plan } = scene.content as SceneContent;
  return { ...scene, authoring: { ...scene.authoring, prose_src_hash: metaHash(stableStringify(plan)) } };
}

// ── Pure edits ────────────────────────────────────────────────────────────────
export function editContent(node: DnaNode, patch: NodeContent): DnaNode {
  const wasEmpty = node.authoring.status === "empty";
  return {
    ...node,
    content: { ...node.content, ...patch },
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

const PACING_DRIFT_TOL = 0.1;   // a movement turn >10 percentage-points off its target_pct = drift
const SAGGING_RUN = 4;          // ≥4 consecutive same-polarity scenes = a sagging middle

/** PACING (when): each movement's turning point gets an actual % (cumulative words, or scene count
 *  pre-prose) and the drift from its authored target_pct. */
export interface PacingPoint { movementId: string; title?: string; targetPct?: number; actualPct: number; driftPct: number }
export function pacing(nodes: DnaNode[]): PacingPoint[] {
  const index = byId(nodes);
  const scenes = scenesInOrder(nodes);
  const hasProse = scenes.some((s) => proseWords(s) > 0);
  const w = (s: DnaNode) => (hasProse ? proseWords(s) : 1); // pre-prose: weight every scene equally
  const total = scenes.reduce((a, s) => a + w(s), 0) || 1;
  const movementOf = (s: DnaNode): string | null => {
    const beat = s.parent_id ? index.get(s.parent_id) : null;
    const mv = beat?.parent_id ? index.get(beat.parent_id) : null;
    return mv?.kind === "movement" ? mv.id : null;
  };
  let cum = 0;
  const endFrac = new Map<string, number>(); // cumulative fraction at a movement's LAST scene = where its turn lands
  for (const s of scenes) { cum += w(s); const m = movementOf(s); if (m) endFrac.set(m, cum / total); }
  return nodes.filter((n) => n.kind === "movement").sort((a, b) => a.position - b.position).map((m) => {
    const c = m.content as MovementContent;
    const actualPct = endFrac.get(m.id) ?? 0;
    return { movementId: m.id, title: c.title, targetPct: c.target_pct, actualPct, driftPct: typeof c.target_pct === "number" ? actualPct - c.target_pct : 0 };
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

/** A compact plain-text STORY ANALYSIS — the three axes + lints — handed to the dna-chat reviser as context
 *  so it can act on pacing drift / dangling promises / sagging runs. The UI renders the same data visually. */
export function analysisText(nodes: DnaNode[], settings: BookSettings): string {
  const lines: string[] = [];
  const pace = pacing(nodes);
  if (pace.length) {
    lines.push("PACING (turning point position vs target):");
    for (const p of pace) lines.push(`  ${p.title ?? p.movementId}: actual ${Math.round(p.actualPct * 100)}%${typeof p.targetPct === "number" ? ` / target ${Math.round(p.targetPct * 100)}%${Math.abs(p.driftPct) > 0.1 ? " ⚠ DRIFT" : ""}` : ""}`);
  }
  const ledger = promiseLedger(nodes);
  if (ledger.length) {
    lines.push("PROMISES (thread registry — setups/payoffs):");
    for (const r of ledger) lines.push(`  "${r.name}": setups ${r.setups}, payoffs ${r.payoffs}${r.setups && !r.payoffs ? " ⚠ DANGLING" : ""}`);
  }
  const topo = topography(nodes).map((t) => (t.polarity === "up" ? "+" : t.polarity === "down" ? "-" : "·"));
  if (topo.length) lines.push(`TOPOGRAPHY (value polarity in reading order): ${topo.join("")}`);
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

export function validate(nodes: DnaNode[]): DnaIssue[] {
  const index = byId(nodes);
  const issues: DnaIssue[] = [];

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

  // Beat causality: every non-first beat in a movement needs a therefore/but connector.
  for (const m of nodes.filter((n) => n.kind === "movement")) {
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

  // Pacing axis (§6): a movement's turning point drifting off its authored target_pct.
  for (const p of pacing(nodes)) {
    if (typeof p.targetPct === "number" && Math.abs(p.driftPct) > PACING_DRIFT_TOL) {
      issues.push({ rule: "pacing_drift", severity: "warn", message: `act turn lands at ${Math.round(p.actualPct * 100)}% (target ${Math.round(p.targetPct * 100)}%)`, nodeId: p.movementId });
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
  return issues;
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
