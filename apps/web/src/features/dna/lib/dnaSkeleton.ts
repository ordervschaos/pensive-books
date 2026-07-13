// dnaSkeleton — the tree's PREVIEW of its own default shape: minimum cast, the structure template's acts
// and their causal beats, shown as read-only ghost rows before anything is generated. Pure, derived live
// from the tree (nothing stored) — mirrors dnaJourney's derivation style. A rung ghosts ONLY while it is
// entirely empty; the moment any real node lands there its ghost is gone for good, so a stale template guess
// never sits next to content the author actually chose (no partial merge between real and ghost siblings).
import { structureForBook, type DnaNode, type NodeKind } from "@/features/dna/lib/novelDna";

export interface GhostItem { kind: NodeKind; title: string; hint?: string; children?: GhostItem[] }

const CAST_MIN: { title: string; hint: string }[] = [
  { title: "Protagonist", hint: "want · need · wound · lie" },
  { title: "Antagonist", hint: "want · need · wound · lie" },
];
const REGISTRY_HINT = "locations, world rules, threads, tentpoles, games — added as the story needs them";

/** The minimum cast (protagonist/antagonist, per the journey's `cast` step recipe) — gone once ANY real
 *  character exists, even one, since the author is now casting by hand. */
export function ghostCast(nodes: DnaNode[]): GhostItem[] {
  if (nodes.some((n) => n.kind === "character")) return [];
  return CAST_MIN.map((c) => ({ kind: "character", title: c.title, hint: c.hint }));
}

/** The book's structure template acts (Weiland 3-act by default; "none" = no ghost), each carrying its
 *  slotted beats — gone once any real act exists. */
export function ghostActs(nodes: DnaNode[]): GhostItem[] {
  if (nodes.some((n) => n.kind === "act")) return [];
  const tpl = structureForBook(nodes);
  if (!tpl) return [];
  return tpl.acts.map((a, i): GhostItem => ({
    kind: "act", title: a.title, hint: `${Math.round(a.target_pct * 100)}% of the book · ${a.purpose}`,
    children: tpl.slots.filter((s) => s.act === i + 1).map((s): GhostItem => ({ kind: "beat", title: s.label, hint: s.craft })),
  }));
}

/** The slotted beats for one REAL act that has none yet, matched by the act's ORDER among its siblings (not
 *  its title) so an author-renamed act still previews its template beats. */
export function ghostBeatsForAct(nodes: DnaNode[], act: DnaNode): GhostItem[] {
  if (nodes.some((n) => n.parent_id === act.id && n.kind === "beat")) return [];
  const tpl = structureForBook(nodes);
  if (!tpl) return [];
  const siblings = nodes.filter((n) => n.parent_id === act.parent_id && n.kind === "act").sort((a, b) => a.position - b.position);
  const actIndex = siblings.findIndex((a) => a.id === act.id);
  if (actIndex < 0) return [];
  return tpl.slots.filter((s) => s.act === actIndex + 1).map((s): GhostItem => ({ kind: "beat", title: s.label, hint: s.craft }));
}

function ghostPillarBranch(nodes: DnaNode[]): GhostItem {
  const children: GhostItem[] = [];
  const cast = ghostCast(nodes);
  if (cast.length) children.push({ kind: "character", title: "cast", children: cast });
  const acts = ghostActs(nodes);
  if (acts.length) children.push({ kind: "act", title: "story", hint: "the acts and their causal beats", children: acts });
  children.push({ kind: "world_fact", title: "registry", hint: REGISTRY_HINT });
  return { kind: "pillar", title: "Pillar", hint: "controlling idea · ending", children };
}

/** What to preview under the SEED when neither premise nor pillar exist yet. */
export function ghostFromSeed(nodes: DnaNode[]): GhostItem[] {
  if (nodes.some((n) => n.kind === "premise" || n.kind === "pillar")) return [];
  return [{ kind: "premise", title: "Premise", hint: "the dramatic question", children: [ghostPillarBranch(nodes)] }];
}

/** What to preview under the PREMISE (real) when the pillar doesn't exist yet. */
export function ghostFromPremise(nodes: DnaNode[]): GhostItem[] {
  if (nodes.some((n) => n.kind === "pillar")) return [];
  return [ghostPillarBranch(nodes)];
}
