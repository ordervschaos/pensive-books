// dnaExpand — Phase 5: the "expand" verb. Calls dna-expand (bridge in dev, edge in prod) and applies the
// result as ONE authoritative value (not proposals): child nodes get the generated content (source=ai,
// accepted); a scene gets its prose. The author then edits / regenerates / locks. See novel-dna-spec.md §6.
import { supabase } from "@/integrations/supabase/client";
import { BRIDGE, bridgeFetch } from "@/lib/bridge";
import { deleteNode, loadTree, saveNode, saveNodes } from "@/lib/bookNodes";
import { startNodeSceneGeneration } from "@/lib/nodeSceneImages";
import { ensurePortraitFor } from "@/lib/characterPortraits";
import { byId, deepMergeContent, newId, presentCharacters, stampIllus, stampInput, stampProse, type BeatContent, type DnaNode, type GameContent, type NodeContent, type NodeKind, type SceneContent, type ThreadRef } from "@/lib/novelDna";

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
  childKind?: NodeKind; childLevel?: number; children?: NodeContent[]; prose?: string; caption?: string;
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
export async function expandNode(
  bookId: number, node: DnaNode, target: string, opts: { startPosition?: number; replaceIds?: string[] } = {},
): Promise<{ added: number }> {
  const { startPosition = 0, replaceIds = [] } = opts;
  const res = await callExpand(bookId, node.id, target);

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
  const made: DnaNode[] = children.map((content, i) => ({
    id: newId(), book_id: bookId, parent_id: node.id,
    level: res.childLevel ?? node.level + 1, kind: (res.childKind ?? "scene") as NodeKind,
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
  // Scenes REALIZE their beat (root fix): inherit the beat's planned polarity and its thread schedule rather
  // than re-inventing them locally — so the global plan stays authoritative (novel-dna-flow.md §7).
  if (res.childKind === "scene" && node.kind === "beat") {
    const beat = node.content as BeatContent;
    made.forEach((s) => {
      const sc = s.content as SceneContent;
      if (beat.polarity && sc.value_shift && !sc.value_shift.polarity) sc.value_shift.polarity = beat.polarity;
    });
    // The beat's thread anchors land on its first (representative) scene — the beat's position in reading
    // order is what the promise axis checks; which inner scene realizes it is fine detail.
    if (made[0] && beat.threads?.length) (made[0].content as SceneContent).threads = beat.threads as ThreadRef[];
    // The beat's tentpole placements distribute across its scenes (one set-piece per scene, in order) so
    // each pinned tentpole gets realized by a scene (closes the registry-not-placed gap — same as threads).
    (beat.realizes ?? []).forEach((tpId, i) => { const s = made[i] ?? made[made.length - 1]; if (s) (s.content as SceneContent).realizes_tentpole = tpId; });
    // The beat's world-rule grounding lands on its LAST scene (the scene that resolves the beat's turn — so
    // the win fires the rule), making the climax's mechanism explicit (Lester Dent's law).
    if (beat.grounds_in?.length && made.length) (made[made.length - 1].content as SceneContent).grounds_in = beat.grounds_in;
    // The beat's game moves: `plays` lands on the first scene (the turn advances the contest); a `resolves`
    // (the game is decided) lands on the LAST scene (the contest's outcome scene).
    if (beat.plays?.length && made[0]) (made[0].content as SceneContent).plays = beat.plays;
    if (beat.resolves?.length && made.length) (made[made.length - 1].content as SceneContent).resolves = beat.resolves;
    // CAUSALITY: the beat's produced/depended state lands on its first scene (the move that earns/spends it).
    if (beat.establishes?.length && made[0]) (made[0].content as SceneContent).establishes = beat.establishes;
    if (beat.needs?.length && made[0]) (made[0].content as SceneContent).needs = beat.needs;
    // Chaptering: a beat opens a chapter (the legible default; author can merge/rename later).
    if (startPosition === 0 && made[0]) {
      const sc = made[0].content as SceneContent;
      if (!sc.chapter_start) sc.chapter_start = { title: chapterTitleFromBeat(node) };
    }
  }
  // Stamp each against its inputs (parent + the new siblings) so they don't read as stale on arrival.
  const index = byId([node, ...made]);
  await saveNodes(made.map((n) => stampInput(n, index)));
  for (const id of replaceIds) await deleteNode(id); // regenerate: drop the unlocked predecessors last
  return { added: made.length };
}

/**
 * ILLUSTRATE a scene (picture-book mode, docs/picture-book-mode.md) — the picture-mode analog of writing
 * prose. Two halves: (1) write the page CAPTION synchronously (cheap dna-expand call) onto the node and
 * stamp illus_src_hash against the CURRENT plan, then (2) kick the durable scene-image render (node-keyed,
 * pin:true) which writes the chosen image_url onto the node when ready (over Realtime). Stamping at caption
 * time records the plan the illustration is made from — if the plan changes before the image lands, the
 * scene correctly reads stale (isIllusStale). Returns once the caption is saved + the render is kicked.
 */
export async function illustrateScene(bookId: number, node: DnaNode): Promise<void> {
  if (node.kind !== "scene") throw new Error("illustrateScene expects a scene node");
  const res = await callExpand(bookId, node.id, "caption");
  const text = (res.caption ?? "").trim();
  if (!text) throw new Error("No caption was generated.");
  const updated: DnaNode = {
    ...node,
    content: deepMergeContent(node.content, { caption: { text, words: wordCount(text) } }), // canonical DNA merge
    authoring: { ...node.authoring, source: node.authoring.source === "user" ? "ai_then_user" : "ai", status: "accepted" },
  };
  await saveNode(stampIllus(updated)); // stamp against the current plan (image lands later, plan-only hash)

  // CONSISTENCY ANCHOR (docs/picture-book-mode.md): make sure every character this scene depicts has a
  // reference portrait BEFORE the scene render — the render reads portraits fresh from the DB and feeds them
  // in for likeness, so without this a cast that never visited "design the look" renders with NO anchor and
  // both identity AND style drift scene-to-scene. We read the LIVE tree (not the passed snapshot) so a bulk
  // "illustrate all" run reuses a portrait minted earlier in the loop instead of regenerating the character.
  // Sequential + idempotent; a portrait failure degrades to no-anchor (ensurePortraitFor returns []).
  const tree = await loadTree(bookId);
  const freshScene = tree.find((n) => n.id === node.id) ?? node;
  for (const character of presentCharacters(freshScene, tree)) await ensurePortraitFor(bookId, character);

  // Per-scene art direction (content.art_note) rides as the render's instruction — folded on top of the
  // book-wide house look for THIS scene only (docs/picture-book-mode.md). stampIllus already hashed it in.
  const artNote = (node.content as SceneContent).art_note?.trim() || undefined;
  await startNodeSceneGeneration(bookId, node.id, { pin: true, instruction: artNote }); // durable render → pins image_url on ready
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
