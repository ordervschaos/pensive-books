// dnaChat — client for the per-stage DNA reviser (dna-chat edge fn, bridge in dev). The edge fn owns the
// dna_chats thread; the rail watches it over Realtime. A proposed change rides in pending_proposal as node
// OPS the author reviews, then applies to book_nodes here. See docs/novel-dna-spec.md.
import { supabase } from "@/integrations/supabase/client";
import { BRIDGE, bridgeFetch } from "@/lib/bridge";
import { deleteNode, loadTree, saveNode } from "@/features/dna/lib/bookNodes";
import { blastRadius, byId, editContent, emptyNode, PARENT_KIND, pillarOf, stampInput, type DnaNode, type NodeContent, type NodeKind } from "@/features/dna/lib/novelDna";
import { KIND_LEVEL, LADDER_NEXT, sanitizeContent, validateContent, VALID_KINDS } from "@/features/dna/lib/dnaSchema";
import type { StageKey } from "@/features/dna/lib/dnaJourney";

export interface DnaChatMessage { role: "user" | "assistant"; text: string; ts: string; plan?: string }
export interface DnaSession { messages: DnaChatMessage[]; pending_proposal: DnaProposal | null; ended_at: string }

// A node to create, with its own descendants — the unit of a rebuild (replace_children). Nesting follows
// the ladder (act→beat→scene), so children's kinds are implied by their parent's.
export interface NewSubtree { content: NodeContent; children?: NewSubtree[] }
export type NodeOp =
  | { op: "edit"; id: string; content: NodeContent }
  // `id` (optional) presets the new node's id instead of minting one — so a batch can create a node AND have
  // a sibling reference it (e.g. auto-minted threads the same-batch beat sheet points at). System-set only.
  | { op: "add"; kind: NodeKind; parentId: string; content: NodeContent; id?: string }
  | { op: "delete"; id: string }
  // Rebuild a whole level: delete the parent's existing (non-locked) children of `childKind` — cascading
  // their subtrees — then create `children` fresh. The replace semantics `add` lacks, so a "rebuild" never
  // duplicates the acts/beats it means to replace.
  | { op: "replace_children"; parentId: string; childKind: NodeKind; children: NewSubtree[] };
export interface DnaProposal { summary: string; ops: NodeOp[] }

const countSubtree = (subs?: NewSubtree[]): number => (subs ?? []).reduce((n, s) => n + 1 + countSubtree(s.children), 0);

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

/** Replace bare node-id references (`[n_ab12cd]`) in the agent's prose with the node's human label, so the
 *  chat reads "Bram's door", not "[n_4qhr8say4]". The agent is told to point at nodes by id (TARGET NODE:
 *  [id]) and echoes those ids back; this rehydrates them for the reader. Absorbs an immediately-following
 *  parenthetical when it merely repeats the label (the agent often writes "[id] (Bram's door)"). An unknown
 *  id (a since-deleted node) falls back to that parenthetical, else is left untouched. Pure. */
export function humanizeNodeRefs(text: string, index: Map<string, DnaNode>): string {
  return text.replace(/\[(n_[a-z0-9]+)\](?:([ \t]*)(\(([^)]*)\)))?/gi, (whole, id: string, gap: string | undefined, paren: string | undefined, inner: string | undefined) => {
    const node = index.get(id);
    if (!node) return inner?.trim() ? inner.trim() : whole;
    const label = nodeLabel(node);
    if (inner?.trim()) {
      const p = inner.trim().toLowerCase(), l = label.toLowerCase();
      if (l.includes(p) || p.includes(l)) return label; // drop the redundant "(label)" the agent added
    }
    return label + (gap ?? "") + (paren ?? "");
  });
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

/** Turn proposal ops into display rows against the live `nodes` (for the accept/dismiss preview). A
 *  replace_children op expands into its delete rows (the children it removes) + add rows (the new set),
 *  so the author sees the real before/after of a rebuild — not one opaque line. */
export function describeOps(ops: NodeOp[], nodes: DnaNode[]): OpRow[] {
  const index = byId(nodes);
  return ops.flatMap((op): OpRow[] => {
    if (op.op === "replace_children") {
      const parentLabel = nodeLabel(index.get(op.parentId));
      const removed = nodes.filter((n) => n.parent_id === op.parentId && n.kind === op.childKind && !n.authoring.locked);
      const removals = removed.map((n): OpRow => ({ verb: "delete", kind: n.kind, label: nodeLabel(n), fields: [], restales: blastRadius(n.id, nodes).count || undefined }));
      const additions = op.children.map((sub): OpRow => {
        const fields = Object.entries(sub.content).map(([key, val]): OpField => ({ key, next: renderValue(val) }));
        const nested = countSubtree(sub.children);
        if (nested) fields.push({ key: "", next: `+${nested} below` });
        return { verb: "add", kind: op.childKind, label: nodeLabel({ content: sub.content, kind: op.childKind } as DnaNode), parentLabel, fields };
      });
      return [...removals, ...additions];
    }
    return [describeOp(op, index, nodes)];
  });
}

function describeOp(op: Exclude<NodeOp, { op: "replace_children" }>, index: Map<string, DnaNode>, nodes: DnaNode[]): OpRow {
  {
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
  }
}

// ── The fail-closed generation boundary ──────────────────────────────────────
// Before any proposed op touches book_nodes, validate it against the live tree + the content schema. An
// invalid op is REJECTED with reasons (surfaced to the author), never silently dropped or coerced — this is
// what stops the "entity orphaned onto premise / character with no name" class from ever landing. Edits are
// validated as PATCHES (absent fields untouched); adds + replace_children children as full nodes.
export interface OpRejection { op: NodeOp; reasons: string[] }
export interface OpValidation { ok: NodeOp[]; rejected: OpRejection[] }

export function validateOps(ops: NodeOp[], nodes: DnaNode[]): OpValidation {
  const index = byId(nodes);
  const pillar = pillarOf(nodes);
  const ok: NodeOp[] = [], rejected: OpRejection[] = [];
  // INVARIANT (schema §4): a node attaches per PARENT_KIND (the single source of truth) — never to whatever
  // node the model named. Pillar-parented kinds (every entity AND the act rung) re-home to THE pillar at
  // apply, so here we only require a pillar to exist. Contextual rungs (beat→act, scene→beat) must name a
  // parent that resolves to the required kind. This is what stops the "act/entity orphaned onto premise"
  // class from landing — the bug that made acts invisible to the pillar-scoped STORY group + generation.
  const parentageReason = (childKind: NodeKind, parentId: string): string | null => {
    const want = PARENT_KIND[childKind];
    if (want === null) return null;                                              // a root kind — no parent
    if (want === "pillar") return pillar ? null : `no pillar exists yet for ${childKind} to attach to`;
    const parent = index.get(parentId);
    if (!parent) return "parent node no longer exists";
    if (parent.kind !== want) return `${childKind} must hang off ${want}, not ${parent.kind}`;
    return null;
  };
  for (const op of ops) {
    const reasons: string[] = [];
    // Validate the SANITIZED content (enum case coerced, soft issues fixed) and only HARD-reject on errors —
    // a capitalized role or a comma-string list is repaired by sanitizeContent at apply, not a rejection.
    const msgs = (kind: NodeKind, content: NodeContent, partial = false, prefix = "") =>
      validateContent(kind, sanitizeContent(kind, content as Record<string, unknown>), { partial })
        .filter((i) => i.severity === "error").forEach((i) => reasons.push(prefix + i.message));
    if (op.op === "edit" || op.op === "delete") {
      const node = index.get(op.id);
      if (!node) reasons.push("target node no longer exists");
      else if (node.authoring.locked) reasons.push("target node is pinned (🔒) — can't change it");
      else if (op.op === "edit") msgs(node.kind, op.content, true);
    } else if (op.op === "add") {
      if (!VALID_KINDS.has(op.kind as string)) reasons.push(`unknown kind "${op.kind}"`);
      else {
        const r = parentageReason(op.kind, op.parentId);
        if (r) reasons.push(r);
        msgs(op.kind, op.content);
      }
    } else if (op.op === "replace_children") {
      const parent = index.get(op.parentId);
      if (parent?.authoring.locked) reasons.push("parent node is pinned (🔒)");
      if (!VALID_KINDS.has(op.childKind as string)) reasons.push(`unknown child kind "${op.childKind}"`);
      else {
        const r = parentageReason(op.childKind, op.parentId);
        if (r) reasons.push(r);
        op.children.forEach((sub, i) => msgs(op.childKind, sub.content, false, `child ${i + 1}: `));
      }
    }
    if (reasons.length) rejected.push({ op, reasons }); else ok.push(op);
  }
  return { ok, rejected };
}

/** Run a set of node ops against book_nodes (edit/add/delete), honoring LOCKED nodes and the schema. Only
 *  VALID ops land (validateOps is the fail-closed gate); the returned `rejected` lets callers report why.
 *  The reusable core shared by the per-stage chat (applyDnaProposal) and the omni-rail agent. */
export async function applyNodeOps(bookId: number, ops: NodeOp[]): Promise<OpValidation> {
  const nodes = await loadTree(bookId);
  const validation = validateOps(ops, nodes);
  const index = byId(nodes);
  const childCount = (parentId: string) => nodes.filter((n) => n.parent_id === parentId).length;
  // Resolve the REAL attachment per PARENT_KIND: a pillar-parented kind (every entity AND the act rung)
  // re-homes onto the pillar, never the parentId the model named (the premise-orphaning class). Contextual
  // rungs (beat→act, scene→beat) keep their named parent. validateOps already guaranteed the pillar /
  // correct-kind parent exists for anything that reached `ok`, so a `?? parentId` fall-through is only a
  // belt-and-braces no-op here.
  const effectiveParent = (kind: NodeKind, parentId: string): string =>
    PARENT_KIND[kind] === "pillar" ? (pillarOf(nodes)?.id ?? parentId) : parentId;
  let added = 0;
  // Create one new node (+ its descendants) under `parentId`, recursing down the ladder. Mirrors the
  // `add` branch's stamping; used by replace_children to build a fresh subtree atomically.
  const addSubtree = async (sub: NewSubtree, kind: NodeKind, parentId: string, position: number): Promise<void> => {
    const fresh = emptyNode(bookId, kind, KIND_LEVEL[kind] ?? 5, parentId, position);
    const node: DnaNode = { ...fresh, content: sanitizeContent(kind, sub.content as Record<string, unknown>), authoring: { source: "ai", locked: false, status: "accepted" } };
    await saveNode(stampInput(node, byId([...nodes, node])));
    const childKind = LADDER_NEXT[kind];
    if (childKind && Array.isArray(sub.children)) {
      let i = 0;
      for (const child of sub.children) await addSubtree(child, childKind, node.id, i++);
    }
  };
  for (const op of validation.ok) {
    if (op.op === "edit") {
      const node = index.get(op.id);
      if (node && !node.authoring.locked) await saveNode(editContent(node, sanitizeContent(node.kind, op.content as Record<string, unknown>)));
    } else if (op.op === "delete") {
      const node = index.get(op.id);
      if (node && !node.authoring.locked) await deleteNode(op.id);
    } else if (op.op === "add") {
      const parentId = effectiveParent(op.kind, op.parentId);
      const fresh = emptyNode(bookId, op.kind, KIND_LEVEL[op.kind] ?? 5, parentId, childCount(parentId) + added++);
      const node: DnaNode = { ...fresh, ...(op.id ? { id: op.id } : {}), content: sanitizeContent(op.kind, op.content as Record<string, unknown>), authoring: { source: "ai", locked: false, status: "accepted" } };
      await saveNode(stampInput(node, byId([...nodes, node])));
    } else if (op.op === "replace_children") {
      // Wipe the (re-homed) parent's existing non-locked children of this kind (FK cascade takes their
      // subtrees), keeping any locked ones, then build the new set after them. Resolving the parent through
      // PARENT_KIND means a act rebuild deletes + rebuilds under the PILLAR, never the named premise.
      const parentId = effectiveParent(op.childKind, op.parentId);
      const existing = nodes.filter((n) => n.parent_id === parentId && n.kind === op.childKind);
      for (const child of existing) if (!child.authoring.locked) await deleteNode(child.id);
      let pos = existing.filter((n) => n.authoring.locked).length;
      for (const sub of op.children) await addSubtree(sub, op.childKind, parentId, pos++);
    }
  }
  return validation;
}

/** Apply a reviewed proposal: run its node ops against book_nodes, then clear the pending proposal. Returns
 *  the validation so the UI can report any ops that were rejected at the boundary (and didn't land). */
export async function applyDnaProposal(bookId: number, stage: StageKey, proposal: DnaProposal): Promise<OpValidation> {
  const validation = await applyNodeOps(bookId, proposal.ops);
  await clearDnaProposal(bookId, stage);
  return validation;
}

/** Discard the pending proposal without applying it. */
export async function clearDnaProposal(bookId: number, stage: StageKey): Promise<void> {
  await supabase.from("dna_chats").update({ pending_proposal: null }).eq("book_id", bookId).eq("stage", stage);
}

/** Archive the current thread into `sessions` and start a fresh conversation. */
export async function startNewDnaSession(bookId: number, stage: StageKey): Promise<void> {
  const { data } = await supabase.from("dna_chats").select("messages, pending_proposal, sessions").eq("book_id", bookId).eq("stage", stage).maybeSingle();
  const messages = Array.isArray(data?.messages) ? (data!.messages as DnaChatMessage[]) : [];
  if (messages.length === 0) return; // nothing to archive
  const sessions = Array.isArray(data?.sessions) ? (data!.sessions as DnaSession[]) : [];
  const archived: DnaSession = { messages, pending_proposal: (data?.pending_proposal as DnaProposal | null) ?? null, ended_at: new Date().toISOString() };
  await supabase.from("dna_chats").update({ messages: [], pending_proposal: null, sessions: [archived, ...sessions], status: "idle" })
    .eq("book_id", bookId).eq("stage", stage);
}

/** Restore a past session as the live thread, archiving the current one. */
export async function resumeDnaSession(bookId: number, stage: StageKey, index: number): Promise<void> {
  const { data } = await supabase.from("dna_chats").select("messages, pending_proposal, sessions").eq("book_id", bookId).eq("stage", stage).maybeSingle();
  const sessions = Array.isArray(data?.sessions) ? (data!.sessions as DnaSession[]) : [];
  const target = sessions[index];
  if (!target) return;
  const messages = Array.isArray(data?.messages) ? (data!.messages as DnaChatMessage[]) : [];
  const remaining = sessions.filter((_, i) => i !== index);
  const nextSessions: DnaSession[] =
    messages.length > 0
      ? [{ messages, pending_proposal: (data?.pending_proposal as DnaProposal | null) ?? null, ended_at: new Date().toISOString() }, ...remaining]
      : remaining;
  await supabase.from("dna_chats").update({ messages: target.messages, pending_proposal: target.pending_proposal ?? null, sessions: nextSessions, status: "idle" })
    .eq("book_id", bookId).eq("stage", stage);
}
