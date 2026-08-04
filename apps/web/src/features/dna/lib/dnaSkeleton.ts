// dnaSkeleton — the tree's PREVIEW of its own default shape: minimum cast, the structure template's acts
// and their causal beats, shown as read-only ghost rows before anything is generated. Pure, derived live
// from the tree (nothing stored) — mirrors dnaJourney's derivation style. A rung ghosts ONLY while it is
// entirely empty; the moment any real node lands there its ghost is gone for good, so a stale template guess
// never sits next to content the author actually chose (no partial merge between real and ghost siblings).
import { emptyNode, structureForBook, type DnaNode, type NodeKind } from "@/features/dna/lib/novelDna";
import { KIND_LEVEL } from "@/features/dna/lib/dnaSchema";

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

// ── THE SEEDER (P2, doc_1785673597000.md §6) ──────────────────────────────────────────────────────────────
// The other half of this module's job. Everything above PREVIEWS the default shape as read-only ghost rows;
// this MATERIALIZES it — the same GhostItem tree, minted as real `book_nodes` rows with `content: {}` — so
// every slot has a stable id you can type into, attach to, or point the agent at. That is what makes
// "start anywhere" possible: filling Act 2 first is just writing into a row that already exists.
//
// Three rules this obeys, and they are the whole design:
//   1. ONE-SHOT, NOT A RECONCILER. Runs at book creation and on an explicit structure change — never in the
//      background. If a reconciler re-minted slots, deleting a placeholder would silently come back and the
//      author would be fighting the tool.
//   2. IDEMPOTENT, keyed on `authoring.scaffold.slot` (beats) or kind+position (acts/cast). Re-running mints
//      only what is genuinely absent.
//   3. TEMPLATE TEXT LIVES IN `authoring.scaffold`, NEVER `content`. A slot minted as "The Hook" must still
//      read as EMPTY to the fill fold, or the whole dense-tree contract collapses on its first row.
//
// Tombstones (owner decision 2026-08-02): a slot key in the pillar's `authoring.waived_slots` was deleted on
// purpose. It is never re-minted, and `structureLints` already stops reporting it missing.

/** Slot keys the author has explicitly declined (pillar tombstones). */
export function waivedSlots(nodes: DnaNode[]): Set<string> {
  const pillar = nodes.find((n) => n.kind === "pillar");
  return new Set((pillar?.authoring?.waived_slots ?? []).map((k) => String(k).trim()).filter(Boolean));
}

/** Record a deleted slot as declined, so neither the linter nor the seeder asks for it again. Returns the
 *  pillar to save, or null when there's nothing to record (no pillar, no slot, or already waived). */
export function waiveSlot(nodes: DnaNode[], slot: string): DnaNode | null {
  const key = slot.trim();
  if (!key) return null;
  const pillar = nodes.find((n) => n.kind === "pillar");
  if (!pillar) return null;
  const have = pillar.authoring?.waived_slots ?? [];
  if (have.includes(key)) return null;
  return { ...pillar, authoring: { ...pillar.authoring, waived_slots: [...have, key] } };
}

const mint = (bookId: number, kind: DnaNode["kind"], parentId: string | null, position: number, scaffold: { title?: string; hint?: string; slot?: string }): DnaNode => {
  const n = emptyNode(bookId, kind, KIND_LEVEL[kind] ?? 5, parentId, position);
  return { ...n, authoring: { ...n.authoring, source: "ai", scaffold } };
};

/** The rows a book is MISSING relative to its structure template — the seeder's plan. Pure: returns new
 *  nodes to insert (parented to real ids), never mutates. Empty array = nothing to do (already seeded, or
 *  the book opted out with structure "none").
 *
 *  Depth stops at BEAT on purpose (§4c): the template knows how many acts and which slotted beats, but it
 *  does NOT know how many scenes a beat needs. Materialize exactly as deep as the template knows the shape. */
export function seedSkeleton(nodes: DnaNode[], bookId: number): DnaNode[] {
  const tpl = structureForBook(nodes);
  if (!tpl) return []; // structure: "none" — deliberately skeleton-free
  const waived = waivedSlots(nodes);
  const out: DnaNode[] = [];

  // The LADDER SPINE first, anchored on whatever rung the book ALREADY has. A book that is only a seed is
  // the single most important case to scaffold — the fresh-book state, and where "start anywhere" has to
  // work — but premise and pillar are the rungs everything below hangs from, so they must be mintable too
  // (mirroring what ghostFromSeed previews). Anchoring on the highest EXISTING rung rather than demanding a
  // specific one keeps this working for partially-built and migrated books alike; only a book with no
  // ladder at all has nothing to attach to.
  const seed = nodes.find((n) => n.kind === "seed");
  let premise = nodes.find((n) => n.kind === "premise");
  let pillar = nodes.find((n) => n.kind === "pillar");
  if (!pillar) {
    if (!premise && seed) {
      premise = mint(bookId, "premise", seed.id, 0, { title: "Premise", hint: "the dramatic question" });
      out.push(premise);
    }
    if (!premise) return out; // no seed and no premise — nothing to hang a pillar from
    pillar = mint(bookId, "pillar", premise.id, 0, { title: "Pillar", hint: "controlling idea · ending" });
    out.push(pillar);
  }

  // Cast floor — only while the book has NO characters at all; once the author has cast anyone by hand we
  // stop guessing (same "no partial merge with real siblings" rule the ghost preview follows).
  if (!nodes.some((n) => n.kind === "character")) {
    CAST_MIN.forEach((c, i) => out.push(mint(bookId, "character", pillar.id, i, { title: c.title, hint: c.hint })));
  }

  // Acts: mint any the template declares and the book lacks, matched BY POSITION (an author-renamed act
  // still counts as that act). Existing acts are left completely alone.
  const acts = nodes.filter((n) => n.parent_id === pillar.id && n.kind === "act").sort((a, b) => a.position - b.position);
  const actAt: (DnaNode | undefined)[] = tpl.acts.map((_, i) => acts[i]);
  tpl.acts.forEach((a, i) => {
    if (actAt[i]) return;
    const node = mint(bookId, "act", pillar.id, i, { title: a.title, hint: `${Math.round(a.target_pct * 100)}% of the book · ${a.purpose}` });
    actAt[i] = node;
    out.push(node);
  });

  // Beats: one per template slot, under the act that slot belongs to. Skipped when a beat already CLAIMS
  // that slot (content.slot) or already carries it as scaffold, and skipped for waived slots.
  const claimed = new Set<string>();
  for (const n of nodes) {
    if (n.kind !== "beat") continue;
    const c = String((n.content as { slot?: string }).slot ?? "").trim();
    if (c) claimed.add(c);
    const s = String(n.authoring?.scaffold?.slot ?? "").trim();
    if (s) claimed.add(s);
  }
  const beatPos = new Map<string, number>();
  for (const n of nodes) if (n.kind === "beat" && n.parent_id) beatPos.set(n.parent_id, Math.max(beatPos.get(n.parent_id) ?? -1, n.position) + 1);
  for (const slot of tpl.slots) {
    if (claimed.has(slot.key) || waived.has(slot.key)) continue;
    const parent = actAt[slot.act - 1];
    if (!parent) continue;
    const pos = beatPos.get(parent.id) ?? 0;
    beatPos.set(parent.id, pos + 1);
    out.push(mint(bookId, "beat", parent.id, pos, { title: slot.label, hint: slot.craft, slot: slot.key }));
  }
  return out;
}

// ── CHOOSING THE METHOD (the structure entry door) ────────────────────────────────────────────────────────
// seedSkeleton above materializes whatever template the book ALREADY resolves to. This picks that template
// first — the author's answer to "which plot skeleton?" before a word is written — and then materializes it,
// so the two halves land in ONE save and the tree never sits in a state where the pillar says one method and
// the rows underneath came from another.
//
// The method is written to `pillar.content.structure`, which `structureForBook` reads. It does NOT make the
// pillar authored: `structure` is in novelDna's NON_CONTENT_FIELDS, so an otherwise-blank pillar carrying only
// a method still reads as an empty placeholder to the fill fold — which is what keeps the interview from
// thinking the book is already built (dnaJourney's grandfather clause runs on liveNodes).

/** Pick the book's structure method and materialize it, as ONE list of rows to save. `method` is a
 *  STRUCTURE_TEMPLATES key, or "none" for a deliberately skeleton-free book (which still mints the spine, so
 *  the author has a premise and pillar to write into — it just declines to guess at acts and beats). */
export function chooseStructure(nodes: DnaNode[], bookId: number, method: string): DnaNode[] {
  const staged: DnaNode[] = [];
  let next = nodes;
  const push = (n: DnaNode) => { staged.push(n); next = [...next, n]; };

  const pillar = nodes.find((n) => n.kind === "pillar");
  if (pillar) {
    // An existing pillar is EDITED, never re-minted — switching method on a started book is a legitimate
    // gesture, and the rows already under it are the author's.
    const updated: DnaNode = { ...pillar, content: { ...(pillar.content as Record<string, unknown>), structure: method } };
    staged.push(updated);
    next = nodes.map((n) => (n.id === pillar.id ? updated : n));
  } else {
    const seed = nodes.find((n) => n.kind === "seed");
    let premise = nodes.find((n) => n.kind === "premise");
    if (!premise) {
      if (!seed) return []; // no ladder at all to hang anything from
      premise = mint(bookId, "premise", seed.id, 0, { title: "Premise", hint: "the dramatic question" });
      push(premise);
    }
    // Minted carrying the method from birth, so `structureForBook` below resolves to the chosen template
    // rather than the house default.
    const fresh = mint(bookId, "pillar", premise.id, 0, { title: "Pillar", hint: "controlling idea · ending" });
    push({ ...fresh, content: { structure: method } });
  }

  // "none" stops here on purpose: the author asked for no skeleton, so minting acts would be the tool
  // overruling them. seedSkeleton would return [] anyway (structureForBook gives undefined) — being explicit
  // keeps the intent readable at the call site.
  if (method === "none") return staged;
  return [...staged, ...seedSkeleton(next, bookId)];
}
