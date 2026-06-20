// outline — the durable PLAN layer and its projection onto pages. See docs/structure-as-render.md.
//
// Hypothesis: a good story is good STRUCTURE rendered with prose. So the structure (books.outline) is
// the first-class, cheaply-revisable artifact; pages are a RENDER of it. Editing the outline is JSON
// writes (free); pages are (re)produced by reconcile() — the diff between the desired node list and the
// pages that currently exist. The outline is the virtual DOM, reconcile is React's diffing, pages are
// the real DOM.
//
// Blast radius is kept tiny by one move: pages.metadata.objective stays a MATERIALIZED COPY of the
// node's objective, so everything below the outline (beat-core, beat-to-prose, lints, planGraph, the
// dev bridge) keeps reading pages unchanged. Only the authoring SURFACE for structure moves up here.
import { supabase } from "@/integrations/supabase/client";
import { metaHash, stampEdge, type Delta, type PageMeta } from "@/lib/planProvenance";
import type { Foundations } from "@/lib/foundations";
import type { RevisionPlan } from "@/lib/beatSheet";

// ── Types ─────────────────────────────────────────────────────────────────────
export type NodeType = "section" | "scene";

export interface OutlineNode {
  id: string; // stable — survives reorder; the page↔node anchor (pages.metadata.node_id)
  type: NodeType;
  title: string;
  objective?: string; // scene only — what this unit must achieve, one sentence
  delta?: Delta[]; // scene only — the page's narrative contract (pin-driven flow)
  tentpoleId?: string; // scene only — the foundations tentpole this scene realizes
}

export interface OutlineThread {
  id: string;
  name: string;
  description?: string;
  setupNodeId?: string | null;
  payoffNodeId?: string | null;
  targetDistance?: number | null;
}

export interface Outline {
  structure: string;
  nodes: OutlineNode[];
  threads: OutlineThread[];
  spine_hash?: string; // metaHash(spine) the outline was built from → outline stale if the spine moves
  rev: number; // monotonic; bumped on every save
  compiled_rev: number; // the rev last reconcile()d into pages → "outline ahead of pages" badge
}

// ── Stable ids ──────────────────────────────────────────────────────────────
const rand = () => Math.random().toString(36).slice(2, 8);
export const newNodeId = () => `n_${rand()}${Date.now().toString(36).slice(-3)}`;
export const newThreadId = () => `t_${rand()}${Date.now().toString(36).slice(-3)}`;

// ── Read / write ──────────────────────────────────────────────────────────────
export async function readOutline(bookId: number): Promise<Outline | null> {
  const { data } = await supabase.from("books").select("outline").eq("id", bookId).maybeSingle();
  return (data?.outline as Outline | null) ?? null;
}

/** Persist the outline, bumping rev (so children can tell the outline moved ahead of the pages). */
export async function saveOutline(bookId: number, outline: Outline): Promise<Outline> {
  const next: Outline = { ...outline, rev: (outline.rev ?? 0) + 1 };
  const { error } = await supabase.from("books").update({ outline: next }).eq("id", bookId);
  if (error) throw error;
  return next;
}

/** Read-modify-write the outline (read fresh so one inline edit never clobbers another). */
export async function mutateOutline(bookId: number, fn: (o: Outline) => Outline): Promise<Outline> {
  const cur = await readOutline(bookId);
  if (!cur) throw new Error("This book has no outline yet.");
  return saveOutline(bookId, fn(cur));
}

/**
 * Build the first Outline from a producer proposal (spine-to-objectives). Mints stable ids and pins
 * the spine hash it was planned under. rev starts at 1; compiled_rev 0 (nothing rendered yet).
 */
export function buildOutlineFromProposal(
  structure: string,
  nodes: Array<Omit<OutlineNode, "id"> & { id?: string }>,
  threadsIn: Array<Omit<OutlineThread, "id" | "setupNodeId" | "payoffNodeId"> & {
    id?: string; setupNodeIndex?: number | null; payoffNodeIndex?: number | null;
  }>,
  spineText: string,
): Outline {
  const withIds: OutlineNode[] = nodes.map((n) => ({ ...n, id: n.id ?? newNodeId() }));
  const idAt = (i: number | null | undefined): string | null =>
    typeof i === "number" && i >= 0 && i < withIds.length ? withIds[i].id : null;
  const threads: OutlineThread[] = (threadsIn ?? []).map((t) => ({
    id: t.id ?? newThreadId(),
    name: t.name,
    description: t.description ?? "",
    setupNodeId: idAt(t.setupNodeIndex),
    payoffNodeId: idAt(t.payoffNodeIndex),
    targetDistance: t.targetDistance ?? null,
  }));
  return { structure, nodes: withIds, threads, spine_hash: metaHash(spineText), rev: 1, compiled_rev: 0 };
}

// ── Pure edits (the cheap layer) ──────────────────────────────────────────────
// These rewrite the JSON only — no page churn. The author renders to pages on demand (reconcile).
export function withNodePatch(o: Outline, nodeId: string, patch: Partial<OutlineNode>): Outline {
  return { ...o, nodes: o.nodes.map((n) => (n.id === nodeId ? { ...n, ...patch } : n)) };
}

/** Insert a new node after `afterId` (or at the end). Returns [outline, newNodeId]. */
export function withNodeAdded(o: Outline, node: Omit<OutlineNode, "id">, afterId?: string): [Outline, string] {
  const id = newNodeId();
  const nodes = [...o.nodes];
  const at = afterId ? nodes.findIndex((n) => n.id === afterId) + 1 : nodes.length;
  nodes.splice(at <= 0 ? nodes.length : at, 0, { ...node, id });
  return [{ ...o, nodes }, id];
}

/** Remove nodes, and null out any thread anchor that pointed at one of them (never lose a thread row). */
export function withNodesRemoved(o: Outline, ids: string[]): Outline {
  const gone = new Set(ids);
  const clear = (nid?: string | null) => (nid && gone.has(nid) ? null : nid ?? null);
  return {
    ...o,
    nodes: o.nodes.filter((n) => !gone.has(n.id)),
    threads: (o.threads ?? []).map((t) => ({ ...t, setupNodeId: clear(t.setupNodeId), payoffNodeId: clear(t.payoffNodeId) })),
  };
}

/** Move the node `id` to a new absolute index in nodes[] (clamped). */
export function withNodeMoved(o: Outline, id: string, toIndex: number): Outline {
  const from = o.nodes.findIndex((n) => n.id === id);
  if (from < 0) return o;
  const nodes = [...o.nodes];
  const [n] = nodes.splice(from, 1);
  nodes.splice(Math.max(0, Math.min(toIndex, nodes.length)), 0, n);
  return { ...o, nodes };
}

// ── AI outline path: translate a page-keyed RevisionPlan into outline node ops ─
// The outline-layer chat (revise-chat) emits a page-id-keyed RevisionPlan. For a structure-first book
// we DON'T apply that to pages via build-revision — we translate it into outline nodes (each plan page
// maps to its node via the page's node_id, or a fresh id when added), make books.outline the truth, and
// reconcile. Cold start (no outline yet) mints one — this is also how a chat-drafted outline is born.
export async function applyOutlinePlan(bookId: number, plan: RevisionPlan): Promise<ReconcileResult> {
  const { data: pageData } = await supabase
    .from("pages").select("id, metadata").eq("book_id", bookId).eq("archived", false);
  const pageIdToNode = new Map<number, string>();
  for (const p of (pageData as Array<{ id: number; metadata: PageMeta | null }> | null) ?? []) {
    const nid = p.metadata?.node_id; if (nid) pageIdToNode.set(p.id, nid);
  }
  const cur = await readOutline(bookId);
  const curById = new Map((cur?.nodes ?? []).map((n) => [n.id, n] as const));

  // Plan order becomes node order; pages absent from the plan are dropped (reconcile archives them).
  const nodes: OutlineNode[] = (plan.pages ?? []).map((pp) => {
    const id = (pp.ref != null ? pageIdToNode.get(pp.ref) : undefined) ?? newNodeId();
    const prev = curById.get(id);
    const type: NodeType = pp.pageType === "section" ? "section" : "scene";
    return {
      id, type, title: (pp.title ?? "").trim(),
      ...(type === "scene" ? { objective: (pp.objective ?? "").trim() } : {}),
      ...(prev?.delta?.length ? { delta: prev.delta } : {}), // preserve plan-level state the chat doesn't carry
      ...(prev?.tentpoleId ? { tentpoleId: prev.tentpoleId } : {}),
    };
  });

  // Keep planned threads; clear anchors that pointed at a node the plan dropped.
  const live = new Set(nodes.map((n) => n.id));
  const threads = (cur?.threads ?? []).map((t) => ({
    ...t,
    setupNodeId: t.setupNodeId && live.has(t.setupNodeId) ? t.setupNodeId : null,
    payoffNodeId: t.payoffNodeId && live.has(t.payoffNodeId) ? t.payoffNodeId : null,
  }));

  const { data: b } = await supabase.from("books").select("spine").eq("id", bookId).maybeSingle();
  const spineText = ((b?.spine as { text?: string } | null)?.text ?? "").trim();
  const next: Outline = {
    structure: cur?.structure ?? "", nodes, threads,
    spine_hash: metaHash(spineText), rev: (cur?.rev ?? 0) + 1, compiled_rev: cur?.compiled_rev ?? 0,
  };
  const { error } = await supabase.from("books").update({ outline: next }).eq("id", bookId);
  if (error) throw error;
  return reconcile(bookId);
}

// ── Reconcile (the projection) ────────────────────────────────────────────────
export interface ReconcileResult { created: number; updated: number; archived: number; threads: number }

// Signature of the page-metadata fields reconcile OWNS — so an unchanged node skips its DB write.
const metaSig = (m: PageMeta): string =>
  JSON.stringify([m.node_id ?? "", m.objective ?? "", m.planned_delta ?? null, m.sync?.spine_objective ?? null]);

interface PageRow {
  id: number;
  page_index: number;
  page_type: string | null;
  title: string | null;
  archived: boolean | null;
  metadata: PageMeta | null;
}

/**
 * Render the outline onto pages — the minimum page CRUD to make the page list match outline.nodes.
 * Non-destructive: archives removed nodes' pages (never hard-deletes prose). A page with no node_id is
 * SOVEREIGN (legacy / author-created) and is left alone, appended after the outline's pages.
 */
export async function reconcile(bookId: number): Promise<ReconcileResult> {
  const { data: book } = await supabase
    .from("books").select("spine, outline, foundations").eq("id", bookId).maybeSingle();
  const outline = (book?.outline as Outline | null) ?? null;
  if (!outline?.nodes?.length) throw new Error("No outline to reconcile.");
  const spineText = ((book?.spine as { text?: string } | null)?.text ?? "").trim();

  const { data: pageData } = await supabase
    .from("pages").select("id, page_index, page_type, title, archived, metadata").eq("book_id", bookId);
  const pages = (pageData as PageRow[] | null) ?? [];

  // node_id → its page (prefer an active one; we'll un-archive if only an archived match exists).
  const byNode = new Map<string, PageRow>();
  for (const p of pages) {
    const nid = (p.metadata as PageMeta | null)?.node_id;
    if (!nid) continue;
    const prev = byNode.get(nid);
    if (!prev || (prev.archived && !p.archived)) byNode.set(nid, p);
  }

  const result: ReconcileResult = { created: 0, updated: 0, archived: 0, threads: 0 };
  const nodeToPageId = new Map<string, number>();
  const liveNodeIds = new Set(outline.nodes.map((n) => n.id));

  // Walk nodes in order; ensure each has a page, patch it, and stamp its page_index to the node order.
  // INCREMENTAL: only write a page that actually changed, so eager reconcile-after-edit touches one row.
  for (let i = 0; i < outline.nodes.length; i++) {
    const node = outline.nodes[i];
    let page = byNode.get(node.id);
    if (!page) {
      const { data: created, error } = await supabase.rpc("create_next_page", { p_book_id: bookId }).select().single();
      if (error) throw error;
      page = { ...(created as PageRow), metadata: {} };
      result.created += 1;
    }
    nodeToPageId.set(node.id, page.id);

    // Materialize the node onto the page: copy objective (stamp spine_objective so beat/prose go stale
    // iff the objective changed), set node_id + planned delta. Preserve everything else in metadata.
    let meta: PageMeta = { ...((page.metadata as PageMeta | null) ?? {}), node_id: node.id };
    if (node.type === "scene") {
      meta.objective = node.objective ?? "";
      meta = stampEdge(meta, "spine_objective", spineText, node.objective ?? "");
      if (node.delta?.length) { meta.planned_delta = node.delta; meta.delta_sync = "planned_only"; }
    }
    const prev = (page.metadata as PageMeta | null) ?? {};
    const unchanged =
      page.title === node.title && page.page_type === node.type && page.page_index === i && !page.archived &&
      metaSig(prev) === metaSig(meta);
    if (!unchanged) {
      const { error: upErr } = await supabase.from("pages").update({
        title: node.title, page_type: node.type, archived: false, page_index: i, metadata: meta,
      }).eq("id", page.id);
      if (upErr) throw upErr;
      result.updated += 1;
    }
  }

  // Archive pages that used to be in the outline but no longer are (soft — prose survives).
  let tail = outline.nodes.length;
  for (const p of pages) {
    const nid = (p.metadata as PageMeta | null)?.node_id;
    if (nid && !liveNodeIds.has(nid) && !p.archived) {
      await supabase.from("pages").update({ archived: true }).eq("id", p.id);
      result.archived += 1;
    } else if (!nid && !p.archived) {
      // Sovereign page (no node) — keep it, but push it after the outline's pages so indexes don't collide.
      if (p.page_index !== tail) await supabase.from("pages").update({ page_index: tail }).eq("id", p.id);
      tail++;
    }
  }

  await reconcileThreads(bookId, outline, nodeToPageId, result);
  await reconcileTentpoles(bookId, book?.foundations as Foundations | null, outline, nodeToPageId);

  await supabase.from("books").update({ outline: { ...outline, compiled_rev: outline.rev } }).eq("id", bookId);
  return result;
}

// Upsert book_threads from the planned outline threads, re-anchored via the node→page map. Idempotent
// on plan_thread_id. The DURABLE anchor is the node id (setup_node_id/payoff_node_id on book_threads);
// the page anchors are DERIVED into book_thread_anchors (role 'promise'/'resolution', sequence 0), so a
// reorder re-points the same anchor row instead of losing the thread. Author-locked or already-
// progressed (open/closed) rows keep their content — only their planned page anchors are re-pointed.
async function reconcileThreads(
  bookId: number, outline: Outline, nodeToPageId: Map<string, number>, result: ReconcileResult,
): Promise<void> {
  const planned = (outline.threads ?? []).filter((t) => t.name?.trim());
  if (!planned.length) return;
  const { data: existing } = await supabase
    .from("book_threads").select("id, plan_thread_id, status, author_locked").eq("book_id", bookId);
  const byPlan = new Map((existing ?? []).map((r) => [r.plan_thread_id as string, r]));

  for (const t of planned) {
    const setupId = t.setupNodeId ? nodeToPageId.get(t.setupNodeId) ?? null : null;
    const payoffId = t.payoffNodeId ? nodeToPageId.get(t.payoffNodeId) ?? null : null;
    const planAnchors = { setup_node_id: t.setupNodeId ?? null, payoff_node_id: t.payoffNodeId ?? null };

    let threadId = byPlan.get(t.id)?.id as number | undefined;
    const row = byPlan.get(t.id);
    if (!row) {
      const { data: ins } = await supabase.from("book_threads").insert({
        book_id: bookId, plan_thread_id: t.id, name: t.name.trim(), description: t.description ?? "",
        status: "planned", source: "ai", target_distance: t.targetDistance ?? null, ...planAnchors,
      }).select("id").single();
      threadId = (ins as { id: number } | null)?.id;
      result.threads += 1;
    } else {
      // planned & unlocked → keep plan fresh; progressed/locked → only re-point the node anchors.
      const patch = (row.status === "planned" && !row.author_locked)
        ? { name: t.name.trim(), description: t.description ?? "", target_distance: t.targetDistance ?? null, ...planAnchors }
        : planAnchors;
      await supabase.from("book_threads").update(patch).eq("id", row.id);
      result.threads += 1;
    }
    if (threadId) {
      await pointAnchor(threadId, "promise", setupId);
      await pointAnchor(threadId, "resolution", payoffId);
    }
  }
}

// Re-point (or create) a thread's planned sequence-0 anchor for the given role. NON-DESTRUCTIVE: a null
// target is a no-op (the plan doesn't name this anchor) — we never delete an existing anchor here, since
// the prose scan also writes anchors and clobbering them would lose real setup/payoff evidence.
async function pointAnchor(threadId: number, role: "promise" | "resolution", pageId: number | null): Promise<void> {
  if (!pageId) return;
  const { data: a } = await supabase
    .from("book_thread_anchors").select("id").eq("thread_id", threadId).eq("role", role).eq("sequence", 0).maybeSingle();
  if (a) await supabase.from("book_thread_anchors").update({ page_id: pageId }).eq("id", a.id);
  else await supabase.from("book_thread_anchors").insert({ thread_id: threadId, page_id: pageId, role, sequence: 0 });
}

// Re-point each placed tentpole's foundations.tentpoles[].placed_page_id via the node→page map.
async function reconcileTentpoles(
  bookId: number, foundations: Foundations | null, outline: Outline, nodeToPageId: Map<string, number>,
): Promise<void> {
  if (!foundations?.tentpoles?.length) return;
  const byTentpole = new Map<string, number>();
  for (const n of outline.nodes) {
    if (n.tentpoleId && nodeToPageId.has(n.id)) byTentpole.set(n.tentpoleId, nodeToPageId.get(n.id)!);
  }
  if (!byTentpole.size) return;
  const tentpoles = foundations.tentpoles.map((t) =>
    byTentpole.has(t.id) ? { ...t, placed_page_id: byTentpole.get(t.id) } : t);
  await supabase.from("books").update({ foundations: { ...foundations, tentpoles } }).eq("id", bookId);
}
