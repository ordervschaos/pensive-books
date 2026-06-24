// dnaChat — client for the per-stage DNA reviser (dna-chat edge fn, bridge in dev). The edge fn owns the
// dna_chats thread; the rail watches it over Realtime. A proposed change rides in pending_proposal as node
// OPS the author reviews, then applies to book_nodes here. See docs/novel-dna-spec.md.
import { supabase } from "@/integrations/supabase/client";
import { BRIDGE, bridgeFetch } from "@/lib/bridge";
import { deleteNode, loadTree, saveNode } from "@/lib/bookNodes";
import { blastRadius, byId, editContent, emptyNode, stampInput, type DnaNode, type NodeContent, type NodeKind } from "@/lib/novelDna";
import type { StageKey } from "@/lib/dnaJourney";

export interface DnaChatMessage { role: "user" | "assistant"; text: string; ts: string; plan?: string }
export type NodeOp =
  | { op: "edit"; id: string; content: NodeContent }
  | { op: "add"; kind: NodeKind; parentId: string; content: NodeContent }
  | { op: "delete"; id: string };
export interface DnaProposal { summary: string; ops: NodeOp[] }

const KIND_LEVEL: Record<NodeKind, number> = {
  seed: 0, premise: 1, pillar: 2, character: 2, relationship: 2, tentpole: 2, world_fact: 2, thread: 2, game: 2, movement: 3, beat: 4, scene: 5,
};
const VALID_KINDS = new Set<string>(Object.keys(KIND_LEVEL));

/** Send one message in a (book, stage) thread. The edge fn appends + persists; the rail re-reads over Realtime.
 *  `analysis` = the three-axis story analysis (pacing/promises/topography/lints), computed client-side from the
 *  live tree (the engine lives in the web app) and handed to the reviser so it can act on drift/dangling/sag. */
export async function sendDnaMessage(bookId: number, stage: StageKey, message: string, analysis?: string): Promise<void> {
  const body = { bookId, stage, message, analysis };
  if (BRIDGE) {
    const r = await bridgeFetch(`/dna-chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    return;
  }
  const { data, error } = await supabase.functions.invoke("dna-chat", { body });
  if (error) throw error;
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
}

// ── Proposal preview ──────────────────────────────────────────────────────────────────────────────
// Resolve a proposal's ops against the LIVE tree into render-ready rows, so the rail can show the author
// EXACTLY what will change (target node, each field, old → new) before they accept. Pure.

/** A short human handle for a node: its name/title/logline/summary, else "<kind> <short-id>". */
export function nodeLabel(node: DnaNode | undefined, fallbackKind?: string): string {
  const c = (node?.content ?? {}) as Record<string, unknown>;
  const handle = c.name ?? c.title ?? c.logline ?? c.summary ?? c.goal;
  const kind = node?.kind ?? fallbackKind ?? "node";
  if (typeof handle === "string" && handle.trim()) return handle.trim().slice(0, 80);
  return `${kind}${node ? ` ${node.id.slice(0, 6)}` : ""}`;
}

// Nested values (array items, sub-objects) render inline so they read as one phrase, not a JSON blob.
function renderInline(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(renderInline).join(", ");
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.text === "string") return o.text; // prose: { text, words }
    return Object.entries(o).filter(([, x]) => x != null && x !== "").map(([k, x]) => `${k}: ${renderInline(x)}`).join(", ");
  }
  return String(v);
}

/** Render a content value as readable text for the diff. Scalars verbatim, arrays joined; a structured field
 *  (e.g. value_shift, shape, time) becomes one "subkey: value" line PER entry, never raw JSON. */
export function renderValue(v: unknown): string {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    if (typeof o.text === "string") return o.text; // prose: { text, words }
    return Object.entries(o).filter(([, x]) => x != null && x !== "").map(([k, x]) => `${k}: ${renderInline(x)}`).join("\n");
  }
  return renderInline(v);
}

export interface OpField { key: string; old?: string; next: string }
// restales = how many downstream nodes this op marks stale (edit) or removes (delete) — the blast radius, so
// the author sees the WEIGHT of a high-leverage change (e.g. editing the throughline restales the whole tree).
export interface OpRow { verb: "edit" | "add" | "delete"; kind: string; label: string; parentLabel?: string; fields: OpField[]; restales?: number }

/** Turn proposal ops into display rows against the live `nodes` (for the accept/dismiss preview). */
export function describeOps(ops: NodeOp[], nodes: DnaNode[]): OpRow[] {
  const index = byId(nodes);
  return ops.map((op): OpRow => {
    if (op.op === "edit") {
      const node = index.get(op.id);
      const cur = (node?.content ?? {}) as Record<string, unknown>;
      const fields = Object.entries(op.content).map(([key, val]): OpField => ({
        key, old: key in cur ? renderValue(cur[key]) : undefined, next: renderValue(val),
      }));
      const restales = blastRadius(op.id, nodes).count;
      return { verb: "edit", kind: node?.kind ?? "node", label: nodeLabel(node), fields, restales: restales || undefined };
    }
    if (op.op === "delete") {
      const node = index.get(op.id);
      const removed = blastRadius(op.id, nodes).count; // descendants that go with it
      return { verb: "delete", kind: node?.kind ?? "node", label: nodeLabel(node), fields: [], restales: removed || undefined };
    }
    const fields = Object.entries(op.content).map(([key, val]): OpField => ({ key, next: renderValue(val) }));
    return { verb: "add", kind: op.kind, label: nodeLabel(undefined, op.kind), parentLabel: nodeLabel(index.get(op.parentId)), fields };
  });
}

/** Apply a reviewed proposal: run its node ops against book_nodes, then clear the pending proposal. */
export async function applyDnaProposal(bookId: number, stage: StageKey, proposal: DnaProposal): Promise<void> {
  const nodes = await loadTree(bookId);
  const index = byId(nodes);
  const childCount = (parentId: string) => nodes.filter((n) => n.parent_id === parentId).length;
  let added = 0;
  for (const op of proposal.ops) {
    if (op.op === "edit") {
      const node = index.get(op.id);
      if (node && !node.authoring.locked) await saveNode(editContent(node, op.content));
    } else if (op.op === "delete") {
      const node = index.get(op.id);
      if (node && !node.authoring.locked) await deleteNode(op.id);
    } else if (op.op === "add" && index.has(op.parentId) && VALID_KINDS.has(op.kind as string)) {
      const fresh = emptyNode(bookId, op.kind, KIND_LEVEL[op.kind] ?? 5, op.parentId, childCount(op.parentId) + added++);
      const node: DnaNode = { ...fresh, content: op.content, authoring: { source: "ai", locked: false, status: "accepted" } };
      await saveNode(stampInput(node, byId([...nodes, node])));
    }
  }
  await clearDnaProposal(bookId, stage);
}

/** Discard the pending proposal without applying it. */
export async function clearDnaProposal(bookId: number, stage: StageKey): Promise<void> {
  await supabase.from("dna_chats").update({ pending_proposal: null }).eq("book_id", bookId).eq("stage", stage);
}
