// DnaTreePage — /books/:slug/dna/tree
// Visual tree of the live book_nodes hierarchy. No app chrome; nav suppressed via ConditionalNav.
// Color-coded by node kind; connector lines via CSS borders; collapsible per-node.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { deleteNode, saveNode } from "@/lib/bookNodes";
import { analysisText, byId, childrenOf, editContent, isEntityKind, isProseStale, isStale, newId, pillarOf, type BookSettings, type DnaNode, type BeatContent, type NodeContent, type NodeKind, type SceneContent } from "@/lib/novelDna";
import { editSpecs, KIND_LEVEL, type EditSpec } from "@/lib/dnaSchema";
import { applyDnaProposal, clearDnaProposal, describeOps, sendDnaMessage, validateOps, type DnaChatMessage, type DnaProposal, type NodeOp, type OpRejection } from "@/lib/dnaChat";
import { DNA_STAGES, buildJourney, dnaHealth, type StageKey } from "@/lib/dnaJourney";

const getNumericId = (p: string | undefined) => { const m = p?.match(/^(\d+)/); return m ? parseInt(m[1]) : 0; };

// ── Kind color map — groups: spine (seed→pillar), entities, structure, leaf ───
const KIND_COLOR: Record<string, string> = {
  seed: "#a78bfa",       // violet — the origin
  premise: "#818cf8",    // indigo
  pillar: "#6366f1",     // indigo darker
  character: "#38bdf8",  // sky — entities
  relationship: "#7dd3fc",
  world_fact: "#bae6fd",
  tentpole: "#e0f2fe",
  game: "#93c5fd",
  thread: "#f9a8d4",     // pink — cross-cutting promises
  movement: "#fb923c",   // orange — acts
  beat: "#fbbf24",       // amber — causal units
  scene: "#4ade80",      // green — the leaf scenes
};

const KIND_BG: Record<string, string> = {
  seed: "#1e1a2e", premise: "#1a1a2e", pillar: "#16163a",
  character: "#0c1e2e", relationship: "#0c1e2e", world_fact: "#0c1e2e", tentpole: "#0c1e2e", game: "#0c1e2e",
  thread: "#2a1020",
  movement: "#1e1200", beat: "#1e1600", scene: "#001a10",
};

// ── Title extraction per kind (first meaningful field) ───────────────────────
function nodeTitle(n: DnaNode): string {
  const c = n.content as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : "");
  switch (n.kind) {
    case "seed": return s(c.logline);
    case "premise": return s(c.dramatic_question) || s((c.shape as Record<string, unknown>)?.setup);
    case "pillar": return s(c.controlling_idea);
    case "character": return s(c.name);
    case "relationship": return s(c.bond);
    case "world_fact": return s(c.name) || s(c.rule);
    case "tentpole": return s(c.summary);
    case "game": return s(c.name);
    case "thread": return s(c.name) || s(c.promise);
    case "movement": return s(c.title) || s(c.goal);
    case "beat": return s((c as BeatContent).summary);
    case "scene": return s((c as SceneContent).chapter_start?.title) || s((c as SceneContent).goal);
    case "voice_profile": return s(c.style) || "voice profile";
    default: return "";
  }
}

// Editable fields per kind + KIND_LEVEL now live in @/lib/dnaSchema (the single source of truth); the
// editor below renders straight off editSpecs(kind). EditSpec carries an optional `required` flag the
// schema's validateContent() reads — the editor ignores it (every field is still editable).

// ── Active-context highlight (#2) ─────────────────────────────────────────────
// MIRRORS supabase/functions/dna-chat STAGE_KINDS. The reviser always receives the WHOLE tree as context;
// `stage` only sets its FOCUS (these kinds) and whether scene prose is included (draft only). So the
// highlight marks the focus kinds — NOT "the only nodes sent" — which the legend states honestly.
const STAGE_FOCUS_KINDS: Record<StageKey, DnaNode["kind"][]> = {
  premise: ["seed", "premise"],
  foundations: ["pillar", "character", "relationship", "tentpole", "world_fact", "voice_profile"],
  structure: ["movement", "beat", "thread"],
  scenes: ["scene"],
  draft: ["scene"],
};

// ── Proposal overlay (#1) ─────────────────────────────────────────────────────
// Resolve a pending proposal's ops into a per-node view the tree can render in place: which nodes are
// edited (field patch), which are deleted, and which phantom nodes are added under each parent. Entity adds
// are placed on the pillar (where applyNodeOps actually lands them, schema §4); replace_children expands
// into deletes (existing non-locked children of childKind) + adds.
interface PhantomAdd { kind: NodeKind; content: NodeContent }
interface ProposalView { edits: Map<string, NodeContent>; deletes: Set<string>; addsByParent: Map<string, PhantomAdd[]> }
const addKey = (parentId: string, kind: string) => `${parentId}::${kind}`;
function indexProposal(ops: NodeOp[] | undefined, nodes: DnaNode[]): ProposalView | null {
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

// ── Connector glyph for beats ────────────────────────────────────────────────
function beatGlyph(n: DnaNode): string {
  if (n.kind !== "beat") return "";
  const c = (n.content as BeatContent).connector;
  return c === "therefore" ? "∴ " : c === "but" ? "↯ " : "";
}

// ── Shared geometry + atoms for a detail field row ────────────────────────────
const detailRowStyle = (depth: number): React.CSSProperties => ({ position: "relative", display: "flex", alignItems: "baseline", gap: 8, paddingLeft: depth * 20 + 20, paddingRight: 12, paddingTop: 1, paddingBottom: 1 });
const labelStyle: React.CSSProperties = { fontFamily: "ui-monospace, monospace", fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "#5c5c5c", width: 92, flexShrink: 0, textAlign: "right" };
const ConnectorTick = ({ depth }: { depth: number }) => <div style={{ position: "absolute", left: (depth - 1) * 20 + 8, top: 9, width: 12, height: 1, background: "#ffffff12" }} />;
const fieldRowStart = (depth: number) => (
  <>
    <ConnectorTick depth={depth} />
    <span style={{ width: 12, flexShrink: 0 }} />
  </>
);
const inputStyle: React.CSSProperties = { fontFamily: "ui-monospace, monospace", fontSize: 12, color: "#e6e6e6", background: "#16161a", border: "1px solid #3a3a55", borderRadius: 3, padding: "3px 6px", lineHeight: 1.5, outline: "none" };

// ── Field value helpers ───────────────────────────────────────────────────────
const contentAt = (node: DnaNode, parentKey?: string): Record<string, unknown> =>
  (parentKey ? ((node.content as Record<string, unknown>)[parentKey] as Record<string, unknown>) ?? {} : node.content) as Record<string, unknown>;
const refName = (id: unknown, index: Map<string, DnaNode>): string =>
  typeof id === "string" ? (index.has(id) ? nodeTitle(index.get(id)!) || id : id) : "";
/** The display string for a field given its type (refs resolved to names, percent rendered, etc.). */
function displayValue(node: DnaNode, spec: EditSpec, index: Map<string, DnaNode>, parentKey?: string): string {
  const raw = contentAt(node, parentKey)[spec.key];
  switch (spec.type) {
    case "ref": return refName(raw, index);
    case "refs": return Array.isArray(raw) ? raw.map((r) => refName(r, index)).filter(Boolean).join(", ") : "";
    case "list": return Array.isArray(raw) ? raw.join(", ") : "";
    case "percent": return typeof raw === "number" ? `${Math.round(raw * 100)}%` : "";
    default: return typeof raw === "string" ? raw : raw != null ? String(raw) : "";
  }
}

// ── An editable content field: typed editor by spec.type ──────────────────────
// Self-contained — writes straight through saveNode(editContent(...)) so the nested patch deep-merges and
// Realtime reflects it back. Locked nodes are read-only. `parentKey` nests the patch for object sub-fields.
function EditableField({ node, spec, depth, index, parentKey }: {
  node: DnaNode; spec: EditSpec; depth: number; index: Map<string, DnaNode>; parentKey?: string;
}) {
  const locked = node.authoring.locked;
  const value = displayValue(node, spec, index, parentKey);
  const raw = contentAt(node, parentKey)[spec.key];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement | HTMLInputElement | HTMLSelectElement | null>(null);
  useEffect(() => { if (editing) { const el = ref.current; el?.focus(); if (el && "selectionStart" in el) (el as HTMLInputElement).selectionStart = el.value.length; } }, [editing]);

  const write = async (next: unknown) => {
    setBusy(true);
    try { await saveNode(editContent(node, (parentKey ? { [parentKey]: { [spec.key]: next } } : { [spec.key]: next }) as NodeContent)); }
    catch (e) { alert(`Save failed: ${(e as Error).message}`); }
    finally { setBusy(false); }
  };

  // ── object: a header label, then its sub-fields nested one level deeper ──────
  if (spec.type === "object") {
    return (
      <>
        <div style={detailRowStyle(depth)}>{fieldRowStart(depth)}<span style={{ ...labelStyle, color: "#6e6e6e" }}>{spec.label}</span></div>
        {spec.fields!.map((sub) => <EditableField key={sub.key} node={node} spec={sub} depth={depth + 1} index={index} parentKey={spec.key} />)}
      </>
    );
  }

  const emptyRow = (
    <div style={detailRowStyle(depth)}>{fieldRowStart(depth)}<span style={labelStyle}>{spec.label}</span>
      <span onClick={() => !locked && setEditing(true)} style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, color: locked ? "#333" : "#4a4a4a", flex: 1, cursor: locked ? "default" : "pointer", fontStyle: "italic" }}>
        {locked ? "—" : `＋ ${spec.label}`}
      </span>
    </div>
  );

  // ── refs: chips + an add-dropdown; always-interactive when expanded ──────────
  if (spec.type === "refs") {
    const ids = Array.isArray(raw) ? (raw as string[]) : [];
    const candidates = [...index.values()].filter((n) => n.kind === spec.refKind && !ids.includes(n.id));
    return (
      <div style={detailRowStyle(depth)}>{fieldRowStart(depth)}<span style={labelStyle}>{spec.label}</span>
        <span style={{ display: "flex", flexWrap: "wrap", gap: 4, flex: 1, alignItems: "center" }}>
          {ids.map((id) => (
            <span key={id} style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, color: "#cfcfcf", background: "#1c1c26", border: "1px solid #2a2a3a", borderRadius: 3, padding: "1px 5px", display: "inline-flex", gap: 4, alignItems: "center" }}>
              {refName(id, index)}
              {!locked && <span onClick={() => !busy && void write(ids.filter((x) => x !== id))} style={{ cursor: "pointer", color: "#666" }}>✕</span>}
            </span>
          ))}
          {!locked && candidates.length > 0 && (
            <select value="" disabled={busy} onChange={(e) => e.target.value && void write([...ids, e.target.value])}
              style={{ ...inputStyle, fontSize: 11, padding: "1px 4px" }}>
              <option value="">＋ add…</option>
              {candidates.map((c) => <option key={c.id} value={c.id}>{nodeTitle(c) || c.id}</option>)}
            </select>
          )}
          {!ids.length && locked && <span style={{ color: "#333", fontFamily: "ui-monospace, monospace", fontSize: 11 }}>—</span>}
        </span>
      </div>
    );
  }

  // ── ref / select: a dropdown revealed on click ───────────────────────────────
  if (spec.type === "ref" || spec.type === "select") {
    if (!editing) {
      if (!value) return emptyRow;
      return (
        <div style={detailRowStyle(depth)}>{fieldRowStart(depth)}<span style={labelStyle}>{spec.label}</span>
          <span onClick={() => !locked && setEditing(true)} style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, color: busy ? "#666" : "#cfcfcf", flex: 1, cursor: locked ? "default" : "pointer" }}>{value}</span>
          {!locked && <span onClick={() => !busy && void write(spec.type === "ref" ? "" : "")} title="clear field" style={{ fontSize: 11, color: "#4a4a4a", cursor: "pointer", flexShrink: 0, alignSelf: "center", padding: "0 2px" }}>✕</span>}
        </div>
      );
    }
    const opts = spec.type === "select" ? (spec.options ?? []).map((o) => ({ id: o, label: o }))
      : [...index.values()].filter((n) => n.kind === spec.refKind).map((n) => ({ id: n.id, label: nodeTitle(n) || n.id }));
    return (
      <div style={detailRowStyle(depth)}>{fieldRowStart(depth)}<span style={labelStyle}>{spec.label}</span>
        <select ref={ref as React.RefObject<HTMLSelectElement>} value={typeof raw === "string" ? raw : ""} disabled={busy}
          onChange={(e) => { void write(e.target.value); setEditing(false); }} onBlur={() => setEditing(false)}
          style={{ ...inputStyle, flex: 1 }}>
          <option value="">(none)</option>
          {opts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </div>
    );
  }

  // ── text / list / percent: click-to-edit input or textarea ───────────────────
  if (!editing && !value) return emptyRow;
  if (!editing) {
    return (
      <div style={detailRowStyle(depth)}>{fieldRowStart(depth)}<span style={labelStyle}>{spec.label}</span>
        <span onClick={() => !locked && (setDraft(rawAsDraft(raw, spec)), setEditing(true))} style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, color: busy ? "#666" : "#cfcfcf", whiteSpace: "pre-wrap", wordBreak: "break-word", flex: 1, lineHeight: 1.5, cursor: locked ? "default" : "text" }}>{value}</span>
        {!locked && <span onClick={() => !busy && void write(spec.type === "list" ? [] : "")} title="clear field" style={{ fontSize: 11, color: "#4a4a4a", cursor: "pointer", flexShrink: 0, alignSelf: "center", padding: "0 2px" }}>✕</span>}
      </div>
    );
  }
  const commit = async () => {
    setEditing(false);
    const next: unknown = spec.type === "list" ? draft.split(",").map((s) => s.trim()).filter(Boolean)
      : spec.type === "percent" ? (draft.trim() ? Math.max(0, Math.min(1, parseFloat(draft.replace("%", "")) / 100)) : "")
      : draft.trim();
    await write(next);
  };
  const common = {
    ref: ref as never, value: draft, disabled: busy,
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => setDraft(e.target.value),
    onBlur: () => void commit(),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); setEditing(false); }
      else if (e.key === "Enter" && (!spec.multiline || e.metaKey || e.ctrlKey)) { e.preventDefault(); void commit(); }
    },
    style: { ...inputStyle, flex: 1, resize: "vertical" as const },
  };
  return (
    <div style={detailRowStyle(depth)} onClick={(e) => e.stopPropagation()}>{fieldRowStart(depth)}<span style={labelStyle}>{spec.label}</span>
      {spec.multiline ? <textarea rows={Math.min(8, Math.max(2, draft.split("\n").length))} {...common} /> : <input {...common} />}
      <span style={{ fontSize: 9, color: "#555", flexShrink: 0, alignSelf: "center" }}>{spec.multiline ? "⌘↵ · esc" : "↵ · esc"}</span>
    </div>
  );
}
/** The editor's starting string for text/list/percent fields. */
function rawAsDraft(raw: unknown, spec: EditSpec): string {
  if (spec.type === "list") return Array.isArray(raw) ? raw.join(", ") : "";
  if (spec.type === "percent") return typeof raw === "number" ? String(Math.round(raw * 100)) : "";
  return typeof raw === "string" ? raw : raw != null ? String(raw) : "";
}

// ── Single tree row ──────────────────────────────────────────────────────────
function TreeRow({ node, index, depth, expandable, open, onToggle, onDelete, mark, focus }: {
  node: DnaNode; index: Map<string, DnaNode>; depth: number;
  expandable: boolean; open: boolean; onToggle: () => void; onDelete?: () => void;
  mark?: "edit" | "delete"; focus?: boolean; // mark = proposed change (#1); focus = in the rail's stage focus (#2)
}) {
  const stale = isStale(node, index) || (node.kind === "scene" && isProseStale(node));
  const color = KIND_COLOR[node.kind] ?? "#888";
  const bg = KIND_BG[node.kind] ?? "transparent";
  const title = nodeTitle(node);
  const glyph = beatGlyph(node);
  const markColor = mark === "delete" ? "#c06060" : mark === "edit" ? "#8a8aff" : null;

  return (
    <div style={{ position: "relative" }}>
      {/* Vertical connector line from this node down to its last child / detail */}
      {expandable && open && (
        <div style={{
          position: "absolute",
          left: depth * 20 + 8,
          top: 22,
          bottom: 0,
          width: 1,
          background: `${color}30`,
          pointerEvents: "none",
        }} />
      )}

      {/* The node row */}
      <div
        onClick={expandable ? onToggle : undefined}
        style={{
          display: "flex", alignItems: "baseline", gap: 8,
          paddingLeft: depth * 20 + (depth > 0 ? 20 : 4),
          paddingRight: 12, paddingTop: 3, paddingBottom: 3,
          cursor: expandable ? "pointer" : "default",
          position: "relative",
          // #1 proposal mark: left accent + tint. #2 focus: faint accent bar when no proposal mark.
          boxShadow: markColor ? `inset 3px 0 0 ${markColor}` : focus ? "inset 2px 0 0 #8a8aff66" : undefined,
          background: markColor ? `${markColor}12` : focus ? "#8a8aff08" : undefined,
        }}
      >
        {/* Horizontal connector line from parent spine to this node */}
        {depth > 0 && (
          <div style={{
            position: "absolute",
            left: (depth - 1) * 20 + 8,
            top: "50%",
            width: 12,
            height: 1,
            background: `${color}40`,
            transform: "translateY(-50%)",
          }} />
        )}

        {/* Expand/collapse chevron */}
        <span style={{ width: 12, flexShrink: 0, color: expandable ? `${color}80` : "transparent", fontSize: 9, lineHeight: 1 }}>
          {expandable ? (open ? "▼" : "▶") : "·"}
        </span>

        {/* Kind badge */}
        <span style={{
          fontFamily: "ui-monospace, monospace", fontSize: 9, letterSpacing: "0.1em",
          textTransform: "uppercase", color, background: bg,
          padding: "1px 5px", borderRadius: 3, border: `1px solid ${color}30`,
          whiteSpace: "nowrap", flexShrink: 0,
        }}>
          {node.kind}
        </span>

        {/* Title / content preview */}
        {(glyph || title) && (
          <span style={{
            fontFamily: "ui-monospace, monospace", fontSize: 12, color: mark === "delete" ? "#9a7070" : "#c9c9c9",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1,
            textDecoration: mark === "delete" ? "line-through" : undefined,
          }}>
            {glyph && <span style={{ color: "#fbbf24", marginRight: 2 }}>{glyph}</span>}
            {title}
          </span>
        )}

        {/* Status + stale + locked chips */}
        <span style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, marginLeft: "auto" }}>
          {markColor && <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 8, textTransform: "uppercase", letterSpacing: "0.12em", color: markColor }}>{mark === "delete" ? "− remove" : "✎ edit"}</span>}
          {stale && <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 8, textTransform: "uppercase", letterSpacing: "0.12em", color: "#f59e0b" }}>stale</span>}
          {node.authoring.locked && <span style={{ fontSize: 10, color: color }}>🔒</span>}
          <span style={{
            width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
            background: node.authoring.status === "accepted" ? (stale ? "#f59e0b" : "#4ade80")
              : node.authoring.status === "draft" ? "#fbbf24"
                : "#444",
          }} title={node.authoring.status ?? "empty"} />
          <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 9, color: "#444", letterSpacing: "0.05em" }}>
            {node.id}
          </span>
          {onDelete && (
            <span onClick={(e) => { e.stopPropagation(); onDelete(); }} title="delete node + its subtree"
              style={{ fontSize: 11, color: "#5a3030", cursor: "pointer", padding: "0 2px" }}>🗑</span>
          )}
        </span>
      </div>
    </div>
  );
}

// ── Proposal overlay rows (#1) ────────────────────────────────────────────────
// The field-level before→after for a proposed EDIT, rendered inline under its node (always visible, not
// gated on expand) so the change is legible where it lands. Reuses describeOps so the diff matches the rail.
function OpDiffBlock({ node, content, nodes, depth }: { node: DnaNode; content: NodeContent; nodes: DnaNode[]; depth: number }) {
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

// A phantom node the proposal would ADD — rendered in its target container/group, before the ＋ add row.
function PhantomRow({ add, depth }: { add: PhantomAdd; depth: number }) {
  const fields = Object.entries(add.content).filter(([, val]) => val != null && val !== "");
  const title = String((add.content as Record<string, unknown>).name ?? (add.content as Record<string, unknown>).title ?? (add.content as Record<string, unknown>).summary ?? (add.content as Record<string, unknown>).goal ?? "");
  return (
    <div style={{ position: "relative", paddingLeft: depth * 20 + 20, paddingRight: 12, paddingTop: 2, paddingBottom: 2, boxShadow: "inset 3px 0 0 #60a070", background: "#60a07012" }}>
      <ConnectorTick depth={depth} />
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ width: 12, flexShrink: 0 }} />
        <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "#60a070", border: "1px solid #60a07040", borderRadius: 3, padding: "1px 5px", flexShrink: 0 }}>＋ {add.kind}</span>
        <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, color: "#a8c8b0", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
      </div>
    </div>
  );
}

// ── A render-only grouping of the pillar's children ──────────────────────────
// The pillar parents two kinds of thing (schema §3 ladder vs §4 entities), and the entity side spans seven
// kinds. This projects the `kind` axis into legible buckets without moving any node; a synthetic
// `${pillar}::story|::world|::world::<kind>` id wires each group into the existing collapse machinery.
const ENTITY_GROUPS: { kind: DnaNode["kind"]; label: string }[] = [
  { kind: "character", label: "characters" },
  { kind: "relationship", label: "relationships" },
  { kind: "thread", label: "threads" },
  { kind: "game", label: "games" },
  { kind: "world_fact", label: "world facts" },
  { kind: "tentpole", label: "tentpoles" },
  { kind: "voice_profile", label: "voice" },
];

// A clickable "＋ <label>" affordance — adds a node (footer of a group or container).
function AddRow({ label, depth, onAdd }: { label: string; depth: number; onAdd: () => void | Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <div style={detailRowStyle(depth)}>
      <ConnectorTick depth={depth} />
      <span style={{ width: 12, flexShrink: 0 }} />
      <span onClick={async () => { if (busy) return; setBusy(true); try { await onAdd(); } finally { setBusy(false); } }}
        style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, color: busy ? "#555" : "#4a7a5a", cursor: busy ? "default" : "pointer", letterSpacing: "0.04em" }}>
        ＋ {label}
      </span>
    </div>
  );
}

// A collapsible labeled section — pure layout, not a real node. `children` is whatever renders inside.
// `alwaysShow` keeps an empty group visible (so its add affordance is reachable); `footer` renders after.
function NodeGroup({ groupId, label, hint, count, depth, collapsedSet, onToggle, children, alwaysShow, footer }: {
  groupId: string; label: string; hint?: string; count: number; depth: number;
  collapsedSet: Set<string>; onToggle: (id: string) => void; children: React.ReactNode;
  alwaysShow?: boolean; footer?: React.ReactNode;
}) {
  if (!count && !alwaysShow) return null;
  const collapsed = collapsedSet.has(groupId);
  return (
    <div style={{ position: "relative" }}>
      {!collapsed && (
        <div style={{ position: "absolute", left: depth * 20 + 8, top: 22, bottom: 0, width: 1, background: "#ffffff14", pointerEvents: "none" }} />
      )}
      <div onClick={() => onToggle(groupId)} style={{
        display: "flex", alignItems: "baseline", gap: 8,
        paddingLeft: depth * 20 + 20, paddingRight: 12, paddingTop: 7, paddingBottom: 3, cursor: "pointer",
      }}>
        <span style={{ width: 12, flexShrink: 0, color: "#555", fontSize: 9, lineHeight: 1 }}>{collapsed ? "▶" : "▼"}</span>
        <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 10, letterSpacing: "0.2em", textTransform: "uppercase", color: count ? "#8a8a8a" : "#555" }}>{label}</span>
        <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 9, letterSpacing: "0.06em", color: "#3a3a3a" }}>{hint ? `${hint} · ` : ""}{count}</span>
      </div>
      {!collapsed && children}
      {!collapsed && footer}
    </div>
  );
}

// ── Recursive tree subtree ───────────────────────────────────────────────────
interface TreeView {
  onToggle: (id: string) => void; onToggleDetail: (id: string) => void;
  onAdd: (parentId: string, kind: DnaNode["kind"]) => void | Promise<void>;
  onDelete: (node: DnaNode) => void;
  proposal: ProposalView | null;       // #1 — proposed ops to overlay
  focusKinds: Set<string> | null;       // #2 — the rail's stage focus (null = rail closed)
}
function Subtree({ node, index, nodes, depth, collapsedSet, openSet, h }: {
  node: DnaNode; index: Map<string, DnaNode>; nodes: DnaNode[]; depth: number;
  collapsedSet: Set<string>; openSet: Set<string>; h: TreeView;
}) {
  const kids = childrenOf(nodes, node.id).sort((a, b) => a.position - b.position);
  const hasKids = kids.length > 0;
  const specs = editSpecs(node.kind);
  // A node is expandable if it has children OR editable fields (entities/scenes have fields but no kids).
  const expandable = hasKids || specs.length > 0;
  const open = expandable && (hasKids ? !collapsedSet.has(node.id) : openSet.has(node.id));
  const toggle = () => (hasKids ? h.onToggle(node.id) : h.onToggleDetail(node.id));
  const fields = specs.map((spec) => <EditableField key={spec.key} node={node} spec={spec} depth={depth + 1} index={index} />);
  const sub = (items: DnaNode[], d: number) => items.map((child) => (
    <Subtree key={child.id} node={child} index={index} nodes={nodes} depth={d}
      collapsedSet={collapsedSet} openSet={openSet} h={h} />
  ));
  // #1 — phantom add rows the proposal would create under (parentId, kind), rendered before the ＋ add row.
  const phantoms = (parentId: string, kind: string, d: number) =>
    (h.proposal?.addsByParent.get(addKey(parentId, kind)) ?? []).map((add, i) => <PhantomRow key={`ph-${i}`} add={add} depth={d} />);

  // The pillar splits into STORY (the spine) + CAST & WORLD (the registry, sub-grouped by kind); a movement
  // can add beats, a beat can add scenes; every other node just renders its editable fields.
  let body: React.ReactNode = null;
  if (open) {
    if (node.kind === "pillar") {
      const ladder = kids.filter((c) => !isEntityKind(c.kind));
      const entities = kids.filter((c) => isEntityKind(c.kind));
      body = (
        <>
          {fields}
          <NodeGroup groupId={`${node.id}::story`} label="story" hint="the spine — acts in order"
            count={ladder.length} depth={depth + 1} collapsedSet={collapsedSet} onToggle={h.onToggle} alwaysShow
            footer={<>{phantoms(node.id, "movement", depth + 2)}<AddRow label="movement" depth={depth + 2} onAdd={() => h.onAdd(node.id, "movement")} /></>}>
            {sub(ladder, depth + 2)}
          </NodeGroup>
          <NodeGroup groupId={`${node.id}::world`} label="cast & world" hint="the registry"
            count={entities.length} depth={depth + 1} collapsedSet={collapsedSet} onToggle={h.onToggle} alwaysShow>
            {ENTITY_GROUPS.map(({ kind, label }) => {
              const items = entities.filter((e) => e.kind === kind);
              return (
                <NodeGroup key={kind} groupId={`${node.id}::world::${kind}`} label={label}
                  count={items.length} depth={depth + 2} collapsedSet={collapsedSet} onToggle={h.onToggle} alwaysShow
                  footer={<>{phantoms(node.id, kind, depth + 3)}<AddRow label={kind} depth={depth + 3} onAdd={() => h.onAdd(node.id, kind)} /></>}>
                  {sub(items, depth + 3)}
                </NodeGroup>
              );
            })}
          </NodeGroup>
        </>
      );
    } else {
      const childAdd = node.kind === "movement" ? "beat" : node.kind === "beat" ? "scene" : null;
      body = (
        <>
          {fields}
          {sub(kids, depth + 1)}
          {childAdd && phantoms(node.id, childAdd, depth + 1)}
          {childAdd && <AddRow label={childAdd} depth={depth + 1} onAdd={() => h.onAdd(node.id, childAdd as DnaNode["kind"])} />}
        </>
      );
    }
  }

  // Delete is allowed on addable kinds (not the seed/premise/pillar singletons) when unlocked.
  const deletable = !node.authoring.locked && (isEntityKind(node.kind) || ["movement", "beat", "scene"].includes(node.kind));
  // #1 proposal mark for THIS node. #2 focus highlight (only when rail open → focusKinds set).
  const editPatch = h.proposal?.edits.get(node.id);
  const mark = h.proposal ? (h.proposal.deletes.has(node.id) ? "delete" : editPatch ? "edit" : undefined) : undefined;
  const focus = h.focusKinds?.has(node.kind) ?? false;

  return (
    <div>
      <TreeRow node={node} index={index} depth={depth} expandable={expandable} open={open} onToggle={toggle}
        onDelete={deletable ? () => h.onDelete(node) : undefined} mark={mark} focus={focus} />
      {editPatch && <OpDiffBlock node={node} content={editPatch} nodes={nodes} depth={depth + 1} />}
      {body}
    </div>
  );
}

// ── AI chat rail (native to this page; wired to the dna_chats backend) ────────
// Same thread/proposal mechanism as the studio's DnaChatRail — sends via sendDnaMessage, watches dna_chats
// over Realtime, previews ops with describeOps, applies with applyDnaProposal — but in this page's
// monospace skin. The reviser may edit ANY non-locked node regardless of stage; stage just sets its focus
// (and whether the three-axis analysis is attached). Applied ops land in book_nodes → the tree's own
// subscription refreshes it. `highlightIds` (the active-context highlight) is a follow-up.
const ANALYSIS_STAGES = new Set<StageKey>(["structure", "scenes", "draft"]);
function ChatRail({ bookId, stage, setStage, nodes, settings, onClose, onPending }: {
  bookId: number; stage: StageKey; setStage: (s: StageKey) => void;
  nodes: DnaNode[]; settings: BookSettings; onClose: () => void; onPending: (p: DnaProposal | null) => void;
}) {
  const [messages, setMessages] = useState<DnaChatMessage[]>([]);
  const [pending, setPending] = useState<DnaProposal | null>(null);
  const [thinking, setThinking] = useState(false);
  const [draft, setDraft] = useState("");
  const [applying, setApplying] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const { data } = await supabase.from("dna_chats").select("messages, pending_proposal, status").eq("book_id", bookId).eq("stage", stage).maybeSingle();
      if (!alive) return;
      const prop = (data?.pending_proposal as DnaProposal | null) ?? null;
      setMessages((data?.messages as DnaChatMessage[] | null) ?? []);
      setPending(prop); onPending(prop); // lift to the page so the tree can overlay it (#1)
      setThinking((data?.status as string | null) === "thinking");
    };
    void load();
    const ch = supabase.channel(`treechat_${bookId}_${stage}_${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "dna_chats", filter: `book_id=eq.${bookId}` }, () => void load())
      .subscribe();
    return () => { alive = false; void supabase.removeChannel(ch); };
  }, [bookId, stage, onPending]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, pending, thinking]);

  const send = async () => {
    const text = draft.trim();
    if (!text || thinking) return;
    setDraft(""); setThinking(true);
    setMessages((m) => [...m, { role: "user", text, ts: new Date().toISOString() }]);
    const analysis = ANALYSIS_STAGES.has(stage) ? analysisText(nodes, settings) : undefined;
    try { await sendDnaMessage(bookId, stage, text, analysis); }
    catch (e) { setThinking(false); alert(`Couldn't send: ${(e as Error).message}`); }
  };
  const apply = async () => {
    if (!pending) return;
    setApplying(true);
    try { await applyDnaProposal(bookId, stage, pending); setPending(null); }
    catch (e) { alert(`Couldn't apply: ${(e as Error).message}`); }
    finally { setApplying(false); }
  };
  const discard = async () => { setPending(null); try { await clearDnaProposal(bookId, stage); } catch { /* best effort */ } };
  const cancel = async () => { setThinking(false); await supabase.from("dna_chats").update({ status: "idle" }).eq("book_id", bookId).eq("stage", stage); };

  // #3 — the fail-closed boundary, surfaced: which ops in THIS proposal can't be saved, and why. Computed
  // against the live tree so it tracks edits. Rejected ops won't land on accept; the author can repair them.
  const rejections: OpRejection[] = pending ? validateOps(pending.ops, nodes).rejected : [];
  const opLabel = (op: NodeOp): string => op.op === "add" ? `add ${op.kind}` : op.op === "replace_children" ? `rebuild ${op.childKind}` : `${op.op} ${op.id}`;
  const askFix = async () => {
    if (!rejections.length || thinking) return;
    const detail = rejections.map((r, i) => `${i + 1}. ${opLabel(r.op)} — ${r.reasons.join("; ")}`).join("\n");
    const text = `That proposal has ${rejections.length} change${rejections.length === 1 ? "" : "s"} that can't be saved:\n${detail}\n\nPlease re-propose with these fixed — valid kinds, all required fields filled, real node ids, entities on the pillar.`;
    setThinking(true);
    setMessages((m) => [...m, { role: "user", text, ts: new Date().toISOString() }]);
    const analysis = ANALYSIS_STAGES.has(stage) ? analysisText(nodes, settings) : undefined;
    try { await sendDnaMessage(bookId, stage, text, analysis); }
    catch (e) { setThinking(false); alert(`Couldn't send: ${(e as Error).message}`); }
  };

  const mono = "ui-monospace, monospace";
  return (
    <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: 420, display: "flex", flexDirection: "column", background: "#0c0c0f", borderLeft: "1px solid #1c1c22", zIndex: 20 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderBottom: "1px solid #16161a" }}>
        <span style={{ fontFamily: mono, fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", color: "#8a8aff" }}>✦ ai reviser</span>
        <select value={stage} onChange={(e) => setStage(e.target.value as StageKey)}
          style={{ ...inputStyle, fontSize: 10, padding: "1px 4px", marginLeft: "auto", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          {DNA_STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <span onClick={onClose} title="close" style={{ color: "#666", cursor: "pointer", fontSize: 14, lineHeight: 1 }}>✕</span>
      </div>

      {/* Transcript */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "14px", display: "flex", flexDirection: "column", gap: 10 }}>
        {messages.length === 0 && (
          <p style={{ fontFamily: mono, fontSize: 12, lineHeight: 1.6, color: "#555", fontStyle: "italic" }}>
            Talk through the tree, or ask for a change. I propose a revision you review before it's saved; pinned (🔒) nodes stay untouched. Focus: <span style={{ color: "#8a8aff" }}>{DNA_STAGES.find((s) => s.key === stage)?.label}</span> — but I can edit any node.
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "94%" }}>
            <div style={{ fontFamily: m.role === "user" ? mono : "ui-serif, Georgia, serif", fontSize: m.role === "user" ? 12 : 13.5, lineHeight: 1.55, whiteSpace: "pre-wrap", color: m.role === "user" ? "#cfcfcf" : "#b8b8c0", background: m.role === "user" ? "#16161c" : "transparent", border: m.role === "user" ? "1px solid #24242e" : "none", borderRadius: 8, padding: m.role === "user" ? "6px 10px" : "0" }}>
              {m.text}
            </div>
          </div>
        ))}
        {thinking && (
          <div style={{ fontFamily: mono, fontSize: 12, color: "#666", display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontStyle: "italic" }}>thinking…</span>
            <span onClick={() => void cancel()} style={{ cursor: "pointer", color: "#7a4a4a" }}>✕ cancel</span>
          </div>
        )}
        {pending && (
          <div style={{ border: "1px solid #3a3a55", background: "#13131a", borderRadius: 8, padding: "10px 12px" }}>
            <div style={{ fontFamily: mono, fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: "#8a8aff" }}>proposed — review before save</div>
            <p style={{ fontFamily: "ui-serif, Georgia, serif", fontSize: 13, color: "#d8d8e0", margin: "5px 0 0" }}>{pending.summary}</p>
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
              {describeOps(pending.ops, nodes).map((row, i) => (
                <div key={i} style={{ border: "1px solid #22222c", background: "#0d0d11", borderRadius: 6, padding: "6px 9px" }}>
                  <div style={{ fontFamily: mono, fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", color: "#666", display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ color: row.verb === "delete" ? "#c06060" : row.verb === "add" ? "#60a070" : "#8a8aff" }}>{row.verb} · {row.kind}</span>
                    {row.verb === "add" && row.parentLabel ? <span>under {row.parentLabel}</span> : null}
                    {row.restales ? <span style={{ color: "#d08a30" }}>{row.verb === "delete" ? `−${row.restales} below` : `restales ${row.restales}`}</span> : null}
                  </div>
                  <div style={{ fontFamily: "ui-serif, Georgia, serif", fontSize: 12.5, color: "#cfcfcf", marginTop: 2 }}>{row.label}</div>
                  {row.verb === "delete"
                    ? <div style={{ fontFamily: mono, fontSize: 11, fontStyle: "italic", color: "#666", marginTop: 3 }}>this node will be removed</div>
                    : row.fields.map((f) => (
                      <div key={f.key} style={{ marginTop: 5 }}>
                        <div style={{ fontFamily: mono, fontSize: 9, letterSpacing: "0.06em", textTransform: "uppercase", color: "#555" }}>{f.key}</div>
                        {f.old !== undefined && f.old !== f.next && <div style={{ fontFamily: "ui-serif, Georgia, serif", fontSize: 12, color: "#6a5050", textDecoration: "line-through", whiteSpace: "pre-wrap" }}>{f.old}</div>}
                        <div style={{ fontFamily: "ui-serif, Georgia, serif", fontSize: 12, color: "#cfcfcf", whiteSpace: "pre-wrap" }}>{f.next}</div>
                      </div>
                    ))}
                </div>
              ))}
            </div>
            {rejections.length > 0 && (
              <div style={{ marginTop: 8, border: "1px solid #5a3a3a", background: "#1a0f0f", borderRadius: 6, padding: "7px 9px" }}>
                <div style={{ fontFamily: mono, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "#d08a8a" }}>⚠ {rejections.length} change{rejections.length === 1 ? "" : "s"} can't be saved — won't be applied</div>
                {rejections.map((r, i) => (
                  <div key={i} style={{ marginTop: 4 }}>
                    <span style={{ fontFamily: mono, fontSize: 10, color: "#c99" }}>{opLabel(r.op)}</span>
                    <span style={{ fontFamily: mono, fontSize: 10, color: "#8a6a6a" }}> — {r.reasons.join("; ")}</span>
                  </div>
                ))}
              </div>
            )}
            <div style={{ marginTop: 10, display: "flex", gap: 16, alignItems: "center" }}>
              {rejections.length < pending.ops.length
                ? <span onClick={() => !applying && void apply()} style={{ fontFamily: mono, fontSize: 12, color: "#8a8aff", cursor: applying ? "default" : "pointer" }}>{applying ? "accepting…" : rejections.length ? `✓ accept ${pending.ops.length - rejections.length} valid` : "✓ accept"}</span>
                : <span style={{ fontFamily: mono, fontSize: 12, color: "#5a5a5a", fontStyle: "italic" }}>nothing valid to apply</span>}
              {rejections.length > 0 && <span onClick={() => void askFix()} style={{ fontFamily: mono, fontSize: 12, color: "#d0a060", cursor: thinking ? "default" : "pointer" }}>↻ ask to fix</span>}
              <span onClick={() => void discard()} style={{ fontFamily: mono, fontSize: 12, color: "#666", cursor: "pointer", fontStyle: "italic" }}>dismiss</span>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Composer */}
      <div style={{ borderTop: "1px solid #16161a", padding: 10 }}>
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={3}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
          placeholder="Ask the reviser…  (⏎ send · ⇧⏎ newline)"
          style={{ ...inputStyle, width: "100%", boxSizing: "border-box", resize: "none", fontSize: 13 }} />
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function DnaTreePage() {
  const { bookSlug } = useParams();
  const bookId = getNumericId(bookSlug);

  const [bookName, setBookName] = useState<string>("");
  const [settings, setSettings] = useState<BookSettings>({});
  const [nodes, setNodes] = useState<DnaNode[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collapsedSet, setCollapsedSet] = useState<Set<string>>(new Set());
  const [openSet, setOpenSet] = useState<Set<string>>(new Set()); // detail-only leaves the user dug into
  const [railOpen, setRailOpen] = useState(false);
  const [stage, setStage] = useState<StageKey>("structure");
  const [proposal, setProposal] = useState<DnaProposal | null>(null); // #1 — mirrored from the rail
  const [showIssues, setShowIssues] = useState(false); // #4 — drill into the lints behind the score

  useEffect(() => {
    if (!bookId) { setError("no book id"); return; }
    void (async () => {
      const [{ data: nodeRows, error: nodesErr }, { data: book, error: bookErr }] = await Promise.all([
        supabase.from("book_nodes").select("*").eq("book_id", bookId).order("position"),
        supabase.from("books").select("name, author, brief, mode").eq("id", bookId).maybeSingle(),
      ]);
      if (nodesErr || bookErr) { setError((nodesErr ?? bookErr)?.message ?? "error"); return; }
      setBookName(book?.name ?? "");
      const brief = book?.brief as { scope?: { word_target?: number } } | null;
      setSettings({ title: book?.name ?? undefined, author: (book?.author as string | null) ?? undefined,
        word_target: brief?.scope?.word_target, mode: (book as { mode?: string } | null)?.mode === "picture" ? "picture" : "prose" });
      const loaded = (nodeRows ?? []) as DnaNode[];
      setNodes(loaded);
      setStage(DNA_STAGES[buildJourney(loaded).nowIndex]?.key ?? "structure"); // open the rail on the current stage
    })();
  }, [bookId]);

  // Live subscription
  useEffect(() => {
    if (!bookId) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const soon = () => { if (t) clearTimeout(t); t = setTimeout(() => void supabase.from("book_nodes").select("*").eq("book_id", bookId).order("position").then(({ data }) => { if (data) setNodes(data as DnaNode[]); }), 400); };
    const ch = supabase.channel(`tree_${bookId}_${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "book_nodes", filter: `book_id=eq.${bookId}` }, soon)
      .subscribe();
    return () => { if (t) clearTimeout(t); void supabase.removeChannel(ch); };
  }, [bookId]);

  const collapseAll = useCallback(() => {
    if (!nodes) return;
    setCollapsedSet(new Set(nodes.filter((n) => childrenOf(nodes, n.id).length > 0).map((n) => n.id)));
    setOpenSet(new Set()); // also fold any dug-into detail leaves
  }, [nodes]);

  const expandAll = useCallback(() => setCollapsedSet(new Set()), []);

  const toggleDetail = useCallback((id: string) => {
    setOpenSet((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleNode = useCallback((id: string) => {
    setCollapsedSet((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  // ── Node CRUD ────────────────────────────────────────────────────────────────
  // Append a fresh empty node of `kind` under `parentId` (position after its existing siblings of that
  // kind). Entities still land on the pillar by construction here, honoring schema §4. Realtime refreshes.
  const addNode = useCallback(async (parentId: string, kind: DnaNode["kind"]) => {
    if (!nodes) return;
    const siblings = nodes.filter((n) => n.parent_id === parentId && n.kind === kind);
    const node: DnaNode = {
      id: newId(), book_id: bookId, parent_id: parentId, level: KIND_LEVEL[kind] ?? 5, kind,
      position: siblings.length ? Math.max(...siblings.map((s) => s.position)) + 1 : 0,
      content: {}, authoring: { source: "user", locked: false, status: "draft" },
    };
    try { await saveNode(node); setOpenSet((p) => new Set(p).add(node.id)); } // open it so its empty fields show
    catch (e) { alert(`Add failed: ${(e as Error).message}`); }
  }, [nodes, bookId]);

  const removeNode = useCallback((node: DnaNode) => {
    const kids = nodes ? childrenOf(nodes, node.id).length : 0;
    const label = nodeTitle(node) || node.kind;
    if (!window.confirm(`Delete ${node.kind} "${label}"${kids ? ` and its ${kids} child node(s)` : ""}? This cannot be undone.`)) return;
    void deleteNode(node.id).catch((e) => alert(`Delete failed: ${(e as Error).message}`));
  }, [nodes]);

  // ── Proposal overlay (#1) + focus highlight (#2) ──────────────────────────────
  const onPending = useCallback((p: DnaProposal | null) => setProposal(p), []);
  const proposalView = useMemo(() => indexProposal(proposal?.ops, nodes ?? []), [proposal, nodes]);
  // When the rail is open, mark the stage's focus kinds (the WHOLE tree is still in context — see legend).
  const focusKinds = useMemo(() => (railOpen ? new Set<string>(STAGE_FOCUS_KINDS[stage]) : null), [railOpen, stage]);
  const acceptProposal = useCallback(async () => {
    if (!proposal) return;
    try { await applyDnaProposal(bookId, stage, proposal); setProposal(null); }
    catch (e) { alert(`Couldn't apply: ${(e as Error).message}`); }
  }, [proposal, bookId, stage]);
  const dismissProposal = useCallback(async () => {
    setProposal(null);
    try { await clearDnaProposal(bookId, stage); } catch { /* best effort */ }
  }, [bookId, stage]);

  const base: React.CSSProperties = {
    margin: 0, minHeight: "100vh",
    fontFamily: "ui-monospace, 'Cascadia Code', 'Source Code Pro', monospace",
    background: "#0a0a0a", color: "#888",
    userSelect: "text",
  };

  if (error) return <div style={{ ...base, padding: 24, color: "#f87171" }}>error: {error}</div>;
  if (!nodes) return <div style={{ ...base, padding: 24 }}>loading…</div>;

  const index = byId(nodes);
  const roots = nodes.filter((n) => n.parent_id === null).sort((a, b) => a.position - b.position);

  // Kind distribution for the stats bar
  const counts = nodes.reduce<Record<string, number>>((acc, n) => { acc[n.kind] = (acc[n.kind] ?? 0) + 1; return acc; }, {});
  const accepted = nodes.filter((n) => n.authoring.status === "accepted").length;
  const staleCount = nodes.filter((n) => isStale(n, index) || (n.kind === "scene" && isProseStale(n))).length;

  // #4 — DNA health: completeness + strength + the lints behind them (structural faults included).
  const health = dnaHealth(nodes, settings, settings.mode);
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const barColor = (n: number) => (n >= 0.8 ? "#4ade80" : n >= 0.5 ? "#fbbf24" : "#f87171");
  const issueTitle = (i: typeof health.issues[number]) => {
    const n = i.nodeId ? index.get(i.nodeId) : undefined;
    return n ? `${n.kind}${nodeTitle(n) ? ` · ${nodeTitle(n)}` : ""}` : i.nodeId ?? "";
  };

  return (
    <div style={{ ...base, marginRight: railOpen ? 420 : 0 }}>
      {railOpen && <ChatRail bookId={bookId} stage={stage} setStage={setStage} nodes={nodes} settings={settings} onClose={() => setRailOpen(false)} onPending={onPending} />}
      {/* Header bar */}
      <div style={{ padding: "12px 16px", borderBottom: "1px solid #1a1a1a", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <span style={{ color: "#666", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase" }}>
          {bookName || bookSlug} · dna tree
        </span>
        <span style={{ color: "#333", fontSize: 11 }}>
          {nodes.length} nodes · {accepted} accepted{staleCount > 0 ? ` · ${staleCount} stale` : ""}
        </span>
        {/* #4 — DNA health: two derived bars + a lint tally that drills down */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {([["complete", health.completeness], ["strong", health.strength]] as const).map(([label, val]) => (
            <span key={label} style={{ display: "flex", alignItems: "center", gap: 5 }} title={label === "complete" ? `${health.stagesDone}/${DNA_STAGES.length} stages · ${pct(health.contentFill)} fields filled` : `${health.errors} errors · ${health.warns} warnings`}>
              <span style={{ fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "#555" }}>{label}</span>
              <span style={{ width: 44, height: 4, background: "#1c1c1c", borderRadius: 2, overflow: "hidden" }}>
                <span style={{ display: "block", height: "100%", width: pct(val), background: barColor(val) }} />
              </span>
              <span style={{ fontSize: 9, color: barColor(val), fontVariantNumeric: "tabular-nums" }}>{pct(val)}</span>
            </span>
          ))}
          {(health.errors + health.warns) > 0 && (
            <button onClick={() => setShowIssues((v) => !v)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", color: health.errors ? "#f87171" : "#d0a060", fontFamily: "ui-monospace, monospace" }}>
              {health.errors ? `${health.errors}✕ ` : ""}{health.warns ? `${health.warns}⚠` : ""} {showIssues ? "▲" : "▼"}
            </button>
          )}
        </div>
        {/* Kind legend */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {Object.entries(counts).map(([kind, n]) => (
            <span key={kind} style={{ fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: KIND_COLOR[kind] ?? "#888" }}>
              {n} {kind}
            </span>
          ))}
        </div>
        {/* Controls */}
        <div style={{ marginLeft: "auto", display: "flex", gap: 12 }}>
          <button onClick={expandAll} style={{ background: "none", border: "none", color: "#555", fontSize: 10, cursor: "pointer", letterSpacing: "0.1em", textTransform: "uppercase" }}>expand all</button>
          <button onClick={collapseAll} style={{ background: "none", border: "none", color: "#555", fontSize: 10, cursor: "pointer", letterSpacing: "0.1em", textTransform: "uppercase" }}>collapse all</button>
          <a href={`/books/${bookSlug}/dna.json`} style={{ color: "#555", fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", textDecoration: "none" }}>json →</a>
          <a href={`/books/${bookSlug}/dna`} style={{ color: "#555", fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", textDecoration: "none" }}>studio →</a>
          {/* AI reviser — prominent pill so the rail is discoverable (was a buried text button) */}
          <button onClick={() => setRailOpen((v) => !v)} style={{
            background: railOpen ? "#8a8aff22" : "#8a8aff14", border: "1px solid #8a8aff66", borderRadius: 5,
            color: "#a8a8ff", fontSize: 10, cursor: "pointer", letterSpacing: "0.1em", textTransform: "uppercase",
            padding: "3px 10px", fontFamily: "ui-monospace, monospace",
          }}>✦ {railOpen ? "close reviser" : "ai reviser"}</button>
        </div>
      </div>

      {/* Legend */}
      <div style={{ padding: "8px 16px", borderBottom: "1px solid #111", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <span style={{ fontSize: 9, color: "#333", letterSpacing: "0.1em", textTransform: "uppercase" }}>status</span>
        {[["accepted", "#4ade80"], ["draft", "#fbbf24"], ["empty", "#444"]].map(([s, c]) => (
          <span key={s} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: c }} />
            <span style={{ fontSize: 9, color: "#444", letterSpacing: "0.08em", textTransform: "uppercase" }}>{s}</span>
          </span>
        ))}
        <span style={{ fontSize: 9, color: "#f59e0b", letterSpacing: "0.08em", textTransform: "uppercase" }}>amber dot = stale</span>
        <span style={{ fontSize: 9, color: "#fbbf24", marginLeft: 8 }}>∴ therefore  ↯ but</span>
        {/* #2 — focus legend: honest about the whole tree being in context */}
        {focusKinds && (
          <span style={{ fontSize: 9, color: "#8a8aff", letterSpacing: "0.06em", marginLeft: "auto" }}>
            ▎rail focus: {STAGE_FOCUS_KINDS[stage].join(" · ")} <span style={{ color: "#555" }}>— whole tree in context{stage !== "draft" ? ", prose excluded off Prose stage" : ""}</span>
          </span>
        )}
      </div>

      {/* #4 — the lints behind the score: structural faults (misparented / orphan / duplicate) + craft warns */}
      {showIssues && (health.errors + health.warns) > 0 && (
        <div style={{ padding: "8px 16px", borderBottom: "1px solid #1a1a1a", display: "flex", flexDirection: "column", gap: 3, maxHeight: 200, overflowY: "auto" }}>
          {health.issues.map((i, idx) => (
            <div key={idx} style={{ display: "flex", alignItems: "baseline", gap: 8, fontFamily: "ui-monospace, monospace", fontSize: 11 }}>
              <span style={{ color: i.severity === "error" ? "#f87171" : "#d0a060", flexShrink: 0 }}>{i.severity === "error" ? "✕" : "⚠"}</span>
              <span style={{ color: "#666", letterSpacing: "0.04em", flexShrink: 0, width: 140 }}>{i.rule}</span>
              <span style={{ color: "#999", flex: 1 }}>{i.message}</span>
              {i.nodeId && <span style={{ color: "#555", flexShrink: 0 }}>{issueTitle(i)}</span>}
            </div>
          ))}
        </div>
      )}

      {/* #1 — proposal banner: accept/dismiss the whole pending change, mirrored from the rail */}
      {proposal && (
        <div style={{ padding: "8px 16px", borderBottom: "1px solid #2a2a44", background: "#13131a", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <span style={{ fontSize: 9, color: "#8a8aff", letterSpacing: "0.14em", textTransform: "uppercase" }}>✦ {proposal.ops.length} proposed change{proposal.ops.length === 1 ? "" : "s"}</span>
          <span style={{ fontFamily: "ui-serif, Georgia, serif", fontSize: 12.5, color: "#c8c8d0", flex: 1, minWidth: 200 }}>{proposal.summary}</span>
          <span onClick={() => void acceptProposal()} style={{ fontSize: 11, color: "#8a8aff", cursor: "pointer", letterSpacing: "0.08em", textTransform: "uppercase" }}>✓ accept</span>
          <span onClick={() => void dismissProposal()} style={{ fontSize: 11, color: "#666", cursor: "pointer", letterSpacing: "0.08em", textTransform: "uppercase" }}>dismiss</span>
        </div>
      )}

      {/* Tree */}
      <div style={{ paddingTop: 8, paddingBottom: 48 }}>
        {roots.length === 0 ? (
          <div style={{ padding: "24px 16px", color: "#333", fontSize: 13 }}>no nodes — migrate or seed the tree first</div>
        ) : roots.map((root) => (
          <Subtree key={root.id} node={root} index={index} nodes={nodes} depth={0}
            collapsedSet={collapsedSet} openSet={openSet}
            h={{ onToggle: toggleNode, onToggleDetail: toggleDetail, onAdd: addNode, onDelete: removeNode, proposal: proposalView, focusKinds }} />
        ))}
      </div>
    </div>
  );
}
