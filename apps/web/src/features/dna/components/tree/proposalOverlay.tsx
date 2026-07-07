import { useState } from "react";
import { isEntityKind, pillarOf, type DnaNode, type NodeContent, type NodeKind } from "@/features/dna/lib/novelDna";
import { describeOps, renderValue, type NodeOp } from "@/features/dna/lib/dnaChat";
import { chooseNodeProposal, discardNodeProposals } from "@/features/dna/lib/dnaProposals";
import { ConnectorTick, detailRowStyle } from "./treeChrome";

// ── Proposal overlay (#1) ─────────────────────────────────────────────────────
// Resolve a pending proposal's ops into a per-node view the tree can render in place: which nodes are
// edited (field patch), which are deleted, and which phantom nodes are added under each parent. Entity adds
// are placed on the pillar (where applyNodeOps actually lands them, schema §4); replace_children expands
// into deletes (existing non-locked children of childKind) + adds.
export interface PhantomAdd { kind: NodeKind; content: NodeContent }
export interface ProposalView { edits: Map<string, NodeContent>; deletes: Set<string>; addsByParent: Map<string, PhantomAdd[]> }
export const addKey = (parentId: string, kind: string) => `${parentId}::${kind}`;
export function indexProposal(ops: NodeOp[] | undefined, nodes: DnaNode[]): ProposalView | null {
  if (!ops?.length) return null;
  const v: ProposalView = { edits: new Map(), deletes: new Set(), addsByParent: new Map() };
  const pillarId = pillarOf(nodes)?.id;
  const pushAdd = (parentId: string, kind: NodeKind, content: NodeContent) => {
    const key = addKey(parentId, kind);
    (v.addsByParent.get(key) ?? v.addsByParent.set(key, []).get(key)!).push({ kind, content });
  };
  for (const op of ops) {
    if (op.op === "edit") v.edits.set(op.id, op.content);
    else if (op.op === "delete") v.deletes.add(op.id);
    else if (op.op === "add") pushAdd(isEntityKind(op.kind) ? (pillarId ?? op.parentId) : op.parentId, op.kind, op.content);
    else if (op.op === "replace_children") {
      for (const n of nodes) if (n.parent_id === op.parentId && n.kind === op.childKind && !n.authoring.locked) v.deletes.add(n.id);
      for (const sub of op.children) pushAdd(op.parentId, op.childKind, sub.content);
    }
  }
  return v;
}

// ── Proposal overlay rows (#1) ────────────────────────────────────────────────
// The field-level before→after for a proposed EDIT, rendered inline under its node (always visible, not
// gated on expand) so the change is legible where it lands. Reuses describeOps so the diff matches the rail.
export function OpDiffBlock({ node, content, nodes, depth }: { node: DnaNode; content: NodeContent; nodes: DnaNode[]; depth: number }) {
  const row = describeOps([{ op: "edit", id: node.id, content }], nodes)[0];
  if (!row?.fields.length) return null;
  return (
    <div style={{ ...detailRowStyle(depth), flexDirection: "column", alignItems: "stretch", gap: 3, paddingTop: 3, paddingBottom: 4 }}>
      <ConnectorTick depth={depth} />
      {row.fields.map((f) => (
        <div key={f.key} style={{ paddingLeft: 20 }}>
          <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 9, letterSpacing: "0.06em", textTransform: "uppercase", color: "#555" }}>{f.key}</span>
          {f.old !== undefined && f.old !== f.next && <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, color: "#6a5050", textDecoration: "line-through", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{f.old}</div>}
          <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, color: "#7fae8f", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{f.next}</div>
        </div>
      ))}
    </div>
  );
}

// A phantom node the proposal would ADD — rendered in its target container/group, before the ＋ add row, at
// full tree width so the author can actually READ it (the rail's card is a narrow sidebar; this is the same
// data, describeOps'd the same way, just laid out where the node would actually land). Read-only: apply/
// discard still live in the rail (AgentRail owns that transaction).
export function PhantomRow({ add, depth }: { add: PhantomAdd; depth: number }) {
  const fields = Object.entries(add.content).filter(([, val]) => val != null && val !== "");
  const title = String((add.content as Record<string, unknown>).name ?? (add.content as Record<string, unknown>).title ?? (add.content as Record<string, unknown>).summary ?? (add.content as Record<string, unknown>).goal ?? "");
  return (
    <div style={{ position: "relative", paddingLeft: depth * 20 + 20, paddingRight: 12, paddingTop: 4, paddingBottom: 6, boxShadow: "inset 3px 0 0 #60a070", background: "#60a07012" }}>
      <ConnectorTick depth={depth} />
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ width: 12, flexShrink: 0 }} />
        <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "#60a070", border: "1px solid #60a07040", borderRadius: 3, padding: "1px 5px", flexShrink: 0 }}>＋ {add.kind}</span>
        {title && <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, color: "#a8c8b0", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>}
      </div>
      <div style={{ paddingLeft: 20, paddingTop: 3, display: "flex", flexDirection: "column", gap: 4 }}>
        {fields.length === 0 && <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, color: "#4a5a4e", fontStyle: "italic" }}>(no content yet)</div>}
        {fields.map(([key, val]) => (
          <div key={key}>
            <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", color: "#5c8a6a" }}>{key}</span>
            <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, color: "#c8ddce", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{renderValue(val)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Options / picker (the candidate+judge channel) ───────────────────────────
// The agent (the rail) generates options via propose_options; here we only PICK among them:
//  • ProposalPicker — the agent's propose_options stages 2–4 candidates onto node.proposals; this renders
//    them as before→after cards. Picking commits (chooseProposal) + re-stales descendants; both pick and
//    discard log a turn back to the agent thread (dnaProposals.ts).

// The picker: render each staged option as a before→after card (reusing describeOps, like the proposal
// overlay). "use this" commits it; "discard all" clears. Both register a turn on the agent thread.
export function ProposalPicker({ node, nodes, depth }: { node: DnaNode; nodes: DnaNode[]; depth: number }) {
  const [busy, setBusy] = useState<string | null>(null);
  const props = node.proposals ?? [];
  const mono = "ui-monospace, monospace";
  if (!props.length) return null;
  const choose = async (id: string) => {
    setBusy(id);
    try { await chooseNodeProposal(node, id, nodes); } // commit + re-stale descendants + log a turn
    catch (e) { alert(`Couldn't apply the option: ${(e as Error).message}`); setBusy(null); }
  };
  const discard = async () => {
    setBusy("discard");
    try { await discardNodeProposals(node); }
    catch (e) { alert(`Discard failed: ${(e as Error).message}`); setBusy(null); }
  };
  return (
    <div style={{ position: "relative", paddingLeft: depth * 20 + 20, paddingRight: 12, paddingTop: 2, paddingBottom: 8 }} onClick={(e) => e.stopPropagation()}>
      <ConnectorTick depth={depth} />
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, paddingBottom: 4 }}>
        <span style={{ width: 12, flexShrink: 0 }} />
        <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: "0.16em", textTransform: "uppercase", color: "#60a070" }}>✦ {props.length} option{props.length === 1 ? "" : "s"} — pick one</span>
        <span onClick={() => !busy && void discard()} style={{ fontFamily: mono, fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", color: busy ? "#444" : "#7a3030", cursor: busy ? "default" : "pointer", marginLeft: "auto" }}>discard all ✕</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingLeft: 20 }}>
        {props.map((p, i) => {
          const fields = describeOps([{ op: "edit", id: node.id, content: p.content }], nodes)[0]?.fields ?? [];
          return (
            <div key={p.id} style={{ border: "1px solid #2a3a2e", borderRadius: 5, background: "#0e140f", padding: "7px 10px" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "#7fae8f" }}>
                  option {i + 1}
                </span>
                <span onClick={() => !busy && void choose(p.id)} style={{
                  fontFamily: mono, fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", marginLeft: "auto",
                  color: busy === p.id ? "#555" : "#9fe0b0", cursor: busy ? "default" : "pointer",
                  border: "1px solid #4a7a5a", borderRadius: 4, padding: "2px 9px", background: "#1a2a1e",
                }}>{busy === p.id ? "applying…" : "use this →"}</span>
              </div>
              {p.note && <div style={{ fontFamily: mono, fontSize: 10, color: "#6a8a72", paddingTop: 4, fontStyle: "italic" }}>{p.note}</div>}
              <div style={{ paddingTop: 5, display: "flex", flexDirection: "column", gap: 3 }}>
                {fields.length === 0 && <div style={{ fontFamily: mono, fontSize: 11, color: "#555" }}>(no fields)</div>}
                {fields.map((f) => (
                  <div key={f.key}>
                    <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: "0.06em", textTransform: "uppercase", color: "#4a5a4e" }}>{f.key}</span>
                    {f.old !== undefined && f.old !== f.next && <div style={{ fontFamily: mono, fontSize: 11.5, color: "#6a5050", textDecoration: "line-through", whiteSpace: "pre-wrap", lineHeight: 1.45 }}>{f.old}</div>}
                    <div style={{ fontFamily: mono, fontSize: 11.5, color: "#bfcfc3", whiteSpace: "pre-wrap", lineHeight: 1.45 }}>{f.next}</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
