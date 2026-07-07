// dnaDecompose — client orchestrator for the SEMANTIC ASCENT (Layer B of the epub import): infer the
// plan rungs of a prose-bearing tree bottom-up. Chapter reads map over the beats (each one edge call,
// applied immediately so the tree fills in live over Realtime), then two fold calls (top rungs,
// entity branch). Every write goes through applyNodeOps — the same fail-closed validateOps boundary
// the agent uses — so locked nodes (the imported prose) are structurally untouchable.
//
// The finishing "seal" pass re-stamps provenance across the tree: the plan was derived FROM the
// prose, so declaring plan↔prose in sync (stampInput + stampProse) is the honest baseline — without
// it every locked scene would read stale the moment its beat gains a real summary.
import { supabase } from "@/integrations/supabase/client";
import { loadTree, saveNodes } from "@/features/dna/lib/bookNodes";
import { applyNodeOps, type NodeOp, type OpRejection } from "@/features/dna/lib/dnaChat";
import { byId, newId, pillarOf, stampInput, stampProse, type DnaNode, type NodeContent } from "@/features/dna/lib/novelDna";

export interface DecomposeChapter { beatId: string; title: string; text: string }
export interface ChapterRead { beat: { summary?: string; connector?: string; polarity?: string }; digest: string }
export interface TopRead {
  seed?: { logline?: string };
  premise?: { dramatic_question?: string; shape?: { name?: string; movements?: string[]; ending_feel?: string } };
  pillar?: { controlling_idea?: string; ending?: string };
}
export interface EntitiesRead {
  characters?: { name?: string; role?: string; want?: string; need?: string; wound?: string; tag?: string }[];
  relationships?: { a?: string; b?: string; bond?: string; charge?: string }[];
  world_facts?: { name?: string; rule?: string; category?: string }[];
  threads?: { name?: string; kind?: string; promise?: string; payoff?: string }[];
  voice?: { pov?: string; tense?: string; style?: string; constraints?: string[] };
}
export interface DecomposeProgress { phase: "chapters" | "top" | "entities" | "seal"; done: number; total: number }
export interface DecomposeResult { chapters: number; entitiesAdded: number; stopped: boolean; rejected: OpRejection[]; skipped: string[] }

const proseOf = (n: DnaNode): string => ((n.content as { prose?: { text?: string } }).prose?.text ?? "").trim();
const posSort = (a: DnaNode, b: DnaNode) => a.position - b.position;

/** The beats in reading order, each with its chapter title + concatenated scene prose. Pure. */
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

/** The three top-rung edit ops from a "top" read (only rungs that exist and got content). Pure. */
export function topOps(nodes: DnaNode[], top: TopRead): NodeOp[] {
  const ops: NodeOp[] = [];
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

/** Entity add ops from an "entities" read. Characters get PRE-MINTED ids so same-batch relationships
 *  can reference them (the op contract's `id` preset); name→id resolution happens here — a
 *  relationship naming an unknown character is skipped (rail), never guessed. Pure. */
export function entityOps(nodes: DnaNode[], e: EntitiesRead): { ops: NodeOp[]; skipped: string[] } {
  const pillar = pillarOf(nodes);
  if (!pillar) return { ops: [], skipped: ["no pillar to attach entities to"] };
  const ops: NodeOp[] = [];
  const skipped: string[] = [];
  const drop = (c: Record<string, unknown>): NodeContent =>
    Object.fromEntries(Object.entries(c).filter(([, v]) => v != null && v !== "" && (!Array.isArray(v) || v.length))) as NodeContent;

  // Characters: dedupe by name (case-insensitive) against both the batch and any existing cast.
  const idByName = new Map<string, string>();
  for (const n of nodes.filter((x) => x.kind === "character")) {
    const name = ((n.content as { name?: string }).name ?? "").trim().toLowerCase();
    if (name) idByName.set(name, n.id);
  }
  for (const c of e.characters ?? []) {
    const key = (c.name ?? "").trim().toLowerCase();
    if (!key || idByName.has(key)) continue;
    const id = newId();
    idByName.set(key, id);
    ops.push({ op: "add", kind: "character", parentId: pillar.id, id, content: drop({ ...c }) });
  }
  for (const r of e.relationships ?? []) {
    const a = idByName.get((r.a ?? "").trim().toLowerCase());
    const b = idByName.get((r.b ?? "").trim().toLowerCase());
    if (!a || !b || a === b) { skipped.push(`relationship ${r.a ?? "?"} ↔ ${r.b ?? "?"} (unresolved character)`); continue; }
    ops.push({ op: "add", kind: "relationship", parentId: pillar.id, content: drop({ a, b, bond: r.bond, charge: r.charge }) });
  }
  for (const w of e.world_facts ?? []) ops.push({ op: "add", kind: "world_fact", parentId: pillar.id, content: drop({ ...w }) });
  for (const t of e.threads ?? []) ops.push({ op: "add", kind: "thread", parentId: pillar.id, content: drop({ ...t }) });
  const v = e.voice ?? {};
  if (v.style) {
    const existing = nodes.find((n) => n.kind === "voice_profile");
    const content = drop({ ...v });
    ops.push(existing ? { op: "edit", id: existing.id, content } : { op: "add", kind: "voice_profile", parentId: pillar.id, content });
  }
  return { ops, skipped };
}

async function invokeStep<T>(bookId: number, step: string, payload: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("dna-decompose", { body: { bookId, step, ...payload } });
  if (error) throw error;
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
  return data as T;
}

/** Run the whole ascent. `shouldStop` is checked between calls (cooperative cancel — the run is
 *  client-owned, there is no server task row to resurrect). Applies land incrementally; the tree
 *  page's Realtime subscription shows them as they arrive. */
export async function decomposeBook(
  bookId: number,
  opts: { onProgress?: (p: DecomposeProgress) => void; shouldStop?: () => boolean } = {},
): Promise<DecomposeResult> {
  const { onProgress, shouldStop } = opts;
  const rejected: OpRejection[] = [];
  const skippedAll: string[] = [];
  const tree = await loadTree(bookId);
  const chapters = chaptersOf(tree);
  if (!chapters.length) throw new Error("No prose-bearing chapters to decompose.");

  // Map: one read per chapter, applied as it lands.
  const digests: { title: string; digest: string }[] = [];
  let stopped = false;
  for (let i = 0; i < chapters.length; i++) {
    if (shouldStop?.()) { stopped = true; break; }
    onProgress?.({ phase: "chapters", done: i, total: chapters.length });
    const ch = chapters[i];
    const read = await invokeStep<ChapterRead>(bookId, "chapter", {
      chapter: { title: ch.title, position: i + 1, total: chapters.length, text: ch.text },
      prev: digests[i - 1]?.digest,
    });
    digests.push({ title: ch.title, digest: read.digest });
    const patch = Object.fromEntries(Object.entries(read.beat ?? {}).filter(([, v]) => v != null && v !== "")) as NodeContent;
    if (Object.keys(patch).length) {
      const v = await applyNodeOps(bookId, [{ op: "edit", id: ch.beatId, content: patch }]);
      rejected.push(...v.rejected);
    }
  }

  // Fold: top rungs, then the entity branch (both need the full digest set).
  let entitiesAdded = 0;
  if (!stopped && digests.length) {
    onProgress?.({ phase: "top", done: 0, total: 1 });
    const top = await invokeStep<TopRead>(bookId, "top", { digests });
    const v1 = await applyNodeOps(bookId, topOps(tree, top));
    rejected.push(...v1.rejected);

    if (!shouldStop?.()) {
      onProgress?.({ phase: "entities", done: 0, total: 1 });
      const entities = await invokeStep<EntitiesRead>(bookId, "entities", { digests, sample: chapters[0].text.slice(0, 3000) });
      const { ops, skipped } = entityOps(await loadTree(bookId), entities);
      const v2 = await applyNodeOps(bookId, ops);
      rejected.push(...v2.rejected);
      skippedAll.push(...skipped);
      entitiesAdded = v2.ok.length;
    } else stopped = true;
  }

  // Seal: the plan was derived FROM the prose — stamp the whole tree so nothing reads falsely stale.
  onProgress?.({ phase: "seal", done: 0, total: 1 });
  const finalTree = await loadTree(bookId);
  const index = byId(finalTree);
  await saveNodes(finalTree.map((n) => {
    let out = stampInput(n, index);
    if (n.kind === "scene" && proseOf(n)) out = stampProse(out);
    return out;
  }));

  return { chapters: digests.length, entitiesAdded, stopped, rejected, skipped: skippedAll };
}
