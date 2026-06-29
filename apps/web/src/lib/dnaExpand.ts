// dnaExpand — Phase 5: the "expand" verb. Calls dna-expand (bridge in dev, edge in prod) and applies the
// result as ONE authoritative value (not proposals): child nodes get the generated content (source=ai,
// accepted); a scene gets its prose. The author then edits / regenerates / locks. See novel-dna-spec.md §6.
import { supabase } from "@/integrations/supabase/client";
import { BRIDGE, bridgeFetch } from "@/lib/bridge";
import { deleteNode, loadTree, saveNode, saveNodes } from "@/lib/bookNodes";
import { composeSceneImage, renderNodeSceneImage, type ComposedSceneImage } from "@/lib/nodeSceneImages";
import { ensurePortraitFor } from "@/lib/characterPortraits";
import { byId, deepMergeContent, newId, PARENT_KIND, pillarOf, presentCharacters, stampIllus, stampInput, stampProse, type BeatContent, type DnaNode, type GameContent, type NodeContent, type NodeKind, type SceneContent, type ThreadRef } from "@/lib/novelDna";
import { stageGeneratedProposal, type AgentProposal } from "@/lib/agentThread";
import type { NewSubtree, NodeOp } from "@/lib/dnaChat";

/** A short, legible chapter title from a beat's summary (the working title; the author renames). */
function chapterTitleFromBeat(beat: DnaNode): string {
  const summary = (beat.content as BeatContent).summary?.trim() ?? "";
  if (!summary) return "Untitled";
  const firstClause = summary.split(/[—–.;:]/)[0].trim();
  const words = firstClause.split(/\s+/).slice(0, 7).join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

interface BeatSheetEntry { movement: number; content: BeatContent }
interface ExpandResult {
  childKind?: NodeKind; childLevel?: number; children?: NodeContent[]; prose?: string; caption?: string; logline?: string;
  beatsheet?: boolean; beats?: BeatSheetEntry[]; movementIds?: string[];
}

async function callExpand(bookId: number, nodeId: string, target: string): Promise<ExpandResult> {
  if (BRIDGE) {
    const r = await bridgeFetch(`/dna-expand`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bookId, nodeId, target }) });
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    return d as ExpandResult;
  }
  const { data, error } = await supabase.functions.invoke("dna-expand", { body: { bookId, nodeId, target } });
  if (error) throw error;
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
  return data as ExpandResult;
}

const wordCount = (t: string) => (t.trim() ? t.trim().split(/\s+/).length : 0);

/**
 * Expand a node toward `target`: generate prose (scene) or the next-rung children (one true set), persist.
 * `replaceIds` (regenerate) are deleted AFTER the new children land — so a regenerate swaps the unlocked
 * siblings without ever leaving the tree empty mid-flight; locked siblings are simply not passed in.
 */
// Scenes REALIZE their beat (root fix, novel-dna-flow.md §7): inherit the beat's planned polarity, thread
// anchors, set-piece placements, game moves, causal state and chaptering rather than re-inventing them
// locally — so the global plan stays authoritative. Mutates `scenes` in place. Shared by the COMMIT path
// (expandNode) and the PROPOSE path (generateExpansionOps) so a proposed scene set carries the SAME plan.
export function realizeScenesFromBeat(beatNode: DnaNode, scenes: SceneContent[], startPosition: number): void {
  const beat = beatNode.content as BeatContent;
  scenes.forEach((sc) => {
    if (beat.polarity && sc.value_shift && !sc.value_shift.polarity) sc.value_shift.polarity = beat.polarity;
  });
  // The beat's thread anchors land on its first (representative) scene — the beat's position in reading order
  // is what the promise axis checks; which inner scene realizes it is fine detail.
  if (scenes[0] && beat.threads?.length) scenes[0].threads = beat.threads as ThreadRef[];
  // The beat's tentpole placements distribute across its scenes (one set-piece per scene, in order).
  (beat.realizes ?? []).forEach((tpId, i) => { const s = scenes[i] ?? scenes[scenes.length - 1]; if (s) s.realizes_tentpole = tpId; });
  // World-rule grounding lands on the LAST scene (the scene that resolves the beat's turn — the win fires the rule).
  if (beat.grounds_in?.length && scenes.length) scenes[scenes.length - 1].grounds_in = beat.grounds_in;
  // Game moves: `plays` advances the contest (first scene); `resolves` decides it (last scene).
  if (beat.plays?.length && scenes[0]) scenes[0].plays = beat.plays;
  if (beat.resolves?.length && scenes.length) scenes[scenes.length - 1].resolves = beat.resolves;
  // CAUSALITY: the beat's produced/depended state lands on its first scene (the move that earns/spends it).
  if (beat.establishes?.length && scenes[0]) scenes[0].establishes = beat.establishes;
  if (beat.needs?.length && scenes[0]) scenes[0].needs = beat.needs;
  // Chaptering: a beat opens a chapter (the legible default; author can merge/rename later).
  if (startPosition === 0 && scenes[0] && !scenes[0].chapter_start) scenes[0].chapter_start = { title: chapterTitleFromBeat(beatNode) };
}

export async function expandNode(
  bookId: number, node: DnaNode, target: string, opts: { startPosition?: number; replaceIds?: string[] } = {},
): Promise<{ added: number }> {
  const { startPosition = 0, replaceIds = [] } = opts;
  const res = await callExpand(bookId, node.id, target);

  if (target === "logline") {
    // Seed → logline: write the seed's OWN logline (a polished refinement of brief.idea), not a child node.
    const text = (res.logline ?? "").trim();
    if (!text) throw new Error("No logline was generated.");
    const updated: DnaNode = {
      ...node,
      content: deepMergeContent(node.content, { logline: text }),
      authoring: { ...node.authoring, source: node.authoring.source === "user" ? "ai_then_user" : "ai", status: "accepted" },
    };
    await saveNode(updated);
    return { added: 0 };
  }

  if (target === "prose") {
    const text = (res.prose ?? "").trim();
    if (!text) throw new Error("No prose was generated.");
    const updated: DnaNode = {
      ...node,
      content: deepMergeContent(node.content, { prose: { text, words: wordCount(text) } }), // canonical DNA merge
      authoring: { ...node.authoring, source: node.authoring.source === "user" ? "ai_then_user" : "ai", status: "accepted" },
    };
    await saveNode(stampProse(updated));
    return { added: 0 };
  }

  if (res.beatsheet) return persistBeatSheet(bookId, res);

  const children = res.children ?? [];
  if (!children.length) throw new Error("No children were generated.");
  // INVARIANT (schema §4): any kind whose schema parent is the (singleton) pillar — every entity AND the
  // movement rung — ALWAYS hangs off the real pillar, never whatever node triggered the expand. Drive this
  // off PARENT_KIND (the single source of truth for attachment) so a stray caller (wrong focused node) can't
  // orphan tentpoles / voice / cast / movements onto premise — where dna-expand's pillar-scoped filters
  // silently can't see them. Beats/scenes keep their focused parent (which movement/beat is contextual).
  const wantsPillar = res.childKind && PARENT_KIND[res.childKind] === "pillar";
  const parentNode = wantsPillar && node.kind !== "pillar"
    ? (pillarOf(await loadTree(bookId)) ?? node)
    : node;
  const made: DnaNode[] = children.map((content, i) => ({
    id: newId(), book_id: bookId, parent_id: parentNode.id,
    level: res.childLevel ?? parentNode.level + 1, kind: (res.childKind ?? "scene") as NodeKind,
    position: startPosition + i, content,
    authoring: { source: "ai", locked: false, status: "accepted" },
  }));
  // Games: couples.to references a SIBLING game by NAME (the edge fn couldn't resolve it — ids are minted
  // here). Resolve name→id across the freshly-minted batch; drop couples to a game that didn't resolve.
  if (res.childKind === "game") {
    const nameToId = new Map(made.map((g) => [String((g.content as GameContent).name ?? "").trim().toLowerCase(), g.id]));
    for (const g of made) {
      const c = g.content as GameContent;
      if (Array.isArray(c.couples)) {
        c.couples = c.couples
          .map((k) => ({ ...k, to: nameToId.get(String(k.to ?? "").trim().toLowerCase()) ?? "" }))
          .filter((k) => k.to && k.to !== g.id); // resolved + not self-coupling
      }
    }
  }
  // Scenes REALIZE their beat (root fix): inherit the beat's plan rather than re-inventing it locally.
  if (res.childKind === "scene" && node.kind === "beat") {
    realizeScenesFromBeat(node, made.map((s) => s.content as SceneContent), startPosition);
  }
  // Stamp each against its inputs (parent + the new siblings) so they don't read as stale on arrival.
  const index = byId([parentNode, ...made]);
  await saveNodes(made.map((n) => stampInput(n, index)));
  for (const id of replaceIds) await deleteNode(id); // regenerate: drop the unlocked predecessors last
  return { added: made.length };
}

// Re-export so callers don't need a second lib import.
export type { ComposedSceneImage };

/**
 * Phase 1 of the two-phase illustrate flow: write the page CAPTION synchronously, stamp illus_src_hash
 * against the current plan, ensure every present character has a reference portrait, then COMPOSE (but do
 * NOT render) the scene image prompt. The caller shows the returned ComposedSceneImage to the author for
 * editing, then calls renderSceneIllustration.
 *
 * Caption is page text (prose-adjacent, generated by dna-expand); only the IMAGE prompt gets the preview
 * gate. Stamping at caption time records what the illustration is made from — plan changes → stale (isIllusStale).
 */
export async function composeSceneIllustration(bookId: number, node: DnaNode): Promise<ComposedSceneImage> {
  if (node.kind !== "scene") throw new Error("composeSceneIllustration expects a scene node");

  // Write the caption + stamp (the plan-only hash; image_url arrives later via render).
  const res = await callExpand(bookId, node.id, "caption");
  const text = (res.caption ?? "").trim();
  if (!text) throw new Error("No caption was generated.");
  const updated: DnaNode = {
    ...node,
    content: deepMergeContent(node.content, { caption: { text, words: wordCount(text) } }),
    authoring: { ...node.authoring, source: node.authoring.source === "user" ? "ai_then_user" : "ai", status: "accepted" },
  };
  await saveNode(stampIllus(updated));

  // CONSISTENCY ANCHOR: ensure every present character has a reference portrait before the scene render.
  // Read the live tree so a bulk "illustrate all" loop reuses a portrait minted earlier in the run.
  const tree = await loadTree(bookId);
  const freshScene = tree.find((n) => n.id === node.id) ?? node;
  for (const character of presentCharacters(freshScene, tree)) await ensurePortraitFor(bookId, character);

  // Compose the image prompt (synchronous, no render, no row inserted).
  const artNote = (node.content as SceneContent).art_note?.trim() || undefined;
  return composeSceneImage(bookId, node.id, { instruction: artNote });
}

/**
 * Phase 2 of the two-phase illustrate flow: render the (possibly author-edited) ComposedSceneImage and
 * pin the chosen image onto the scene node (content.image_url → render reads this). Durable: the insert
 * returns immediately; the image lands over Realtime when ready.
 */
export async function renderSceneIllustration(bookId: number, nodeId: string, c: ComposedSceneImage): Promise<void> {
  await renderNodeSceneImage(bookId, nodeId, { prompt: c.prompt, refImages: c.refImages, model: c.model, pin: true });
}

/**
 * Persist the GLOBAL beat sheet (root fix): a flat, movement-indexed beat list (thread refs already resolved
 * to ids and the setup→payoff schedule already enforced server-side). Beats are grouped under their movement;
 * existing UNLOCKED beats under those movements are replaced (cascade drops their scenes). See §7 of the flow.
 */
async function persistBeatSheet(bookId: number, res: ExpandResult): Promise<{ added: number }> {
  const movementIds = res.movementIds ?? [];
  const entries = res.beats ?? [];
  if (!movementIds.length || !entries.length) throw new Error("Empty beat sheet.");
  const tree = await loadTree(bookId);
  const movements = movementIds.map((id) => tree.find((n) => n.id === id)).filter(Boolean) as DnaNode[];
  const oldBeats = tree.filter((n) => n.kind === "beat" && movementIds.includes(n.parent_id ?? "") && !n.authoring.locked);

  const posByMovement: Record<string, number> = {};
  const made: DnaNode[] = entries.map((e) => {
    const parent_id = movementIds[e.movement] ?? movementIds[0];
    const position = (posByMovement[parent_id] = (posByMovement[parent_id] ?? 0) + 1) - 1;
    return { id: newId(), book_id: bookId, parent_id, level: res.childLevel ?? 4, kind: "beat" as NodeKind, position, content: e.content as NodeContent, authoring: { source: "ai" as const, locked: false, status: "accepted" as const } };
  });
  // Stamp against each beat's movement parent so they don't read stale on arrival.
  const index = byId([...movements, ...made]);
  await saveNodes(made.map((n) => stampInput(n, index)));
  for (const b of oldBeats) await deleteNode(b.id); // replace last — cascade removes their scenes
  return { added: made.length };
}

// ── The PROPOSE path — generate, but don't commit ────────────────────────────
// expandNode commits the engine's output as authoritative, accepted nodes. generateExpansionOps runs the
// SAME engine (callExpand) but converts the result into reviewable node OPS instead of saving — so a
// post-pillar "✦ generate" can ride the agent thread's review channel (phantoms in the tree, apply/discard
// in the rail) exactly like the chat agent's propose_node_ops. Engine quality + proposal review.
const GEN_LABEL: Partial<Record<NodeKind, string>> = {
  character: "cast", world_fact: "world", relationship: "relationships", tentpole: "set-pieces",
  game: "games", thread: "threads", voice_profile: "voice", movement: "acts", scene: "scenes", location: "locations",
};

/** Generate via the dna-expand engine and return the result as reviewable ops (no writes). One network call
 *  plus the SAME local enrichment the commit path applies (scene→beat realization). */
export async function generateExpansionOps(bookId: number, node: DnaNode, target: string): Promise<{ ops: NodeOp[]; summary: string }> {
  const res = await callExpand(bookId, node.id, target);

  if (target === "logline") {
    const text = (res.logline ?? "").trim();
    if (!text) throw new Error("No logline was generated.");
    return { ops: [{ op: "edit", id: node.id, content: { logline: text } }], summary: "Refine the logline" };
  }
  if (target === "prose") {
    const text = (res.prose ?? "").trim();
    if (!text) throw new Error("No prose was generated.");
    return { ops: [{ op: "edit", id: node.id, content: { prose: { text, words: wordCount(text) } } }], summary: `Write prose (${wordCount(text)}w)` };
  }
  if (res.beatsheet) {
    const movementIds = res.movementIds ?? [];
    const entries = res.beats ?? [];
    if (!movementIds.length || !entries.length) throw new Error("Empty beat sheet.");
    // One replace_children per movement — mirrors persistBeatSheet's replace semantics, so the review shows a
    // real before→after (the unlocked beats it removes + the new set) and a regenerate never duplicates beats.
    const byMovement = new Map<string, NewSubtree[]>();
    for (const e of entries) {
      const pid = movementIds[e.movement] ?? movementIds[0];
      (byMovement.get(pid) ?? byMovement.set(pid, []).get(pid)!).push({ content: e.content as NodeContent });
    }
    const ops: NodeOp[] = [...byMovement].map(([parentId, children]) => ({ op: "replace_children", parentId, childKind: "beat", children }));
    return { ops, summary: `Generate beat sheet (${entries.length} beats)` };
  }

  const children = res.children ?? [];
  if (!children.length) throw new Error("No children were generated.");
  const childKind = (res.childKind ?? "scene") as NodeKind;
  // Scenes inherit their beat's plan before being proposed (parity with the commit path).
  if (childKind === "scene" && node.kind === "beat") realizeScenesFromBeat(node, children as SceneContent[], 0);
  // parentId = the triggering node; applyNodeOps re-homes pillar-parented kinds (entities + movements) onto
  // the pillar at apply, so the named parent only matters for the contextual rungs (scene→beat).
  const ops: NodeOp[] = children.map((content) => ({ op: "add", kind: childKind, parentId: node.id, content }));
  return { ops, summary: `Generate ${GEN_LABEL[childKind] ?? childKind} (${children.length})` };
}

/** Generate via the engine and STAGE the result as a proposal on the book's agent thread (review in the rail). */
export async function proposeGeneration(bookId: number, node: DnaNode, target: string): Promise<void> {
  const { ops, summary } = await generateExpansionOps(bookId, node, target);
  const proposal: AgentProposal = { id: newId(), layer: "dna", summary, ops };
  await stageGeneratedProposal(bookId, proposal);
}
