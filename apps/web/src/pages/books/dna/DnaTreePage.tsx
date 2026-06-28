// DnaTreePage — /books/:slug/dna/tree
// Visual tree of the live book_nodes hierarchy. No app chrome; nav suppressed via ConditionalNav.
// Color-coded by node kind; connector lines via CSS borders; collapsible per-node.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { deleteNode, patchNodeContent, saveNode, saveNodes } from "@/lib/bookNodes";
import { backlinkIndex, byId, childrenOf, emptyNode, isEntityKind, isProseStale, isStale, newId, pillarOf, refsOf, type BookSettings, type DnaIssue, type DnaNode, type BeatContent, type NodeContent, type NodeKind, type SceneContent } from "@/lib/novelDna";
import { editSpecs, KIND_LEVEL, tasteSpecs, type EditSpec } from "@/lib/dnaSchema";
import { CONTENT_TYPES, SCOPE_BANDS, briefIdea, type Brief } from "@/lib/brief";
import { describeOps, type NodeOp } from "@/lib/dnaChat";
import { AgentRail } from "@/components/book/studio/AgentRail";
import { type AgentProposal } from "@/lib/agentThread";
import { DNA_STAGES, dnaHealth } from "@/lib/dnaJourney";

const getNumericId = (p: string | undefined) => { const m = p?.match(/^(\d+)/); return m ? parseInt(m[1]) : 0; };

// ── Kind color map — groups: spine (seed→pillar), entities, structure, leaf ───
const KIND_COLOR: Record<string, string> = {
  seed: "#a78bfa",       // violet — the origin
  premise: "#818cf8",    // indigo
  pillar: "#6366f1",     // indigo darker
  character: "#38bdf8",  // sky — entities
  relationship: "#7dd3fc",
  world_fact: "#bae6fd",
  location: "#5eead4",   // teal — places (a sensory palette, not a rule)
  tentpole: "#e0f2fe",
  game: "#93c5fd",
  thread: "#f9a8d4",     // pink — cross-cutting promises
  movement: "#fb923c",   // orange — acts
  beat: "#fbbf24",       // amber — causal units
  scene: "#4ade80",      // green — the leaf scenes
};

const KIND_BG: Record<string, string> = {
  seed: "#1e1a2e", premise: "#1a1a2e", pillar: "#16163a",
  character: "#0c1e2e", relationship: "#0c1e2e", world_fact: "#0c1e2e", location: "#031e1a", tentpole: "#0c1e2e", game: "#0c1e2e",
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
    case "location": return s(c.name) || s(c.summary);
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
function EditableField({ node, spec, depth, index, parentKey, onJump }: {
  node: DnaNode; spec: EditSpec; depth: number; index: Map<string, DnaNode>; parentKey?: string;
  onJump?: (id: string) => void; // #1 — click a ref to jump to its node
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
    // #3 — patchNodeContent re-reads the live row and merges, so a second field edit can't clobber the first.
    try { await patchNodeContent(node, (parentKey ? { [parentKey]: { [spec.key]: next } } : { [spec.key]: next }) as NodeContent); }
    catch (e) { alert(`Save failed: ${(e as Error).message}`); }
    finally { setBusy(false); }
  };

  // ── object: a header label, then its sub-fields nested one level deeper ──────
  if (spec.type === "object") {
    return (
      <>
        <div style={detailRowStyle(depth)}>{fieldRowStart(depth)}<span style={{ ...labelStyle, color: "#6e6e6e" }}>{spec.label}</span></div>
        {spec.fields!.map((sub) => <EditableField key={sub.key} node={node} spec={sub} depth={depth + 1} index={index} parentKey={spec.key} onJump={onJump} />)}
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
              <span onClick={() => onJump?.(id)} title={onJump ? "jump to node" : undefined} style={{ cursor: onJump ? "pointer" : "default", borderBottom: onJump ? "1px dotted #4a5a6a" : undefined }}>{refName(id, index)}</span>
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
      const jumpId = spec.type === "ref" && typeof raw === "string" && onJump ? raw : null;
      return (
        <div style={detailRowStyle(depth)}>{fieldRowStart(depth)}<span style={labelStyle}>{spec.label}</span>
          <span style={{ flex: 1, display: "flex", alignItems: "baseline", gap: 6, minWidth: 0 }}>
            {jumpId
              ? <span onClick={() => onJump!(jumpId)} title="jump to node" style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, color: busy ? "#666" : "#9bd3e6", cursor: "pointer", borderBottom: "1px dotted #4a5a6a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</span>
              : <span onClick={() => !locked && setEditing(true)} style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, color: busy ? "#666" : "#cfcfcf", cursor: locked ? "default" : "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</span>}
            {!locked && jumpId && <span onClick={() => setEditing(true)} title="change" style={{ fontSize: 10, color: "#4a4a4a", cursor: "pointer", flexShrink: 0 }}>▾</span>}
          </span>
          {!locked && <span onClick={() => !busy && void write("")} title="clear field" style={{ fontSize: 11, color: "#4a4a4a", cursor: "pointer", flexShrink: 0, alignSelf: "center", padding: "0 2px" }}>✕</span>}
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

// ── Backlinks (#2): the inbound edges — which nodes cross-reference THIS one ───
// refsOf is one-directional (a scene points at its pov/threads/tentpoles…); this shows the inverse so the
// tree reads as a graph, not a list. Each is a jump link (#1). Makes an entity's reach visible — and makes
// delete honest (the same index gates the delete guard, #4).
function BacklinksRow({ node, backlinks, depth, onJump }: {
  node: DnaNode; backlinks: Map<string, DnaNode[]>; depth: number; onJump?: (id: string) => void;
}) {
  const inbound = backlinks.get(node.id);
  if (!inbound?.length) return null;
  return (
    <div style={detailRowStyle(depth)}>
      {fieldRowStart(depth)}
      <span style={{ ...labelStyle, color: "#5a6a7a" }}>referenced by</span>
      <span style={{ display: "flex", flexWrap: "wrap", gap: 4, flex: 1, alignItems: "center" }}>
        {inbound.map((n) => (
          <span key={n.id} onClick={() => onJump?.(n.id)} title={onJump ? "jump to node" : undefined}
            style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, color: "#cfcfcf", background: "#16161c", border: "1px solid #24242e", borderRadius: 3, padding: "1px 5px", display: "inline-flex", gap: 4, alignItems: "center", cursor: onJump ? "pointer" : "default" }}>
            <span style={{ color: KIND_COLOR[n.kind] ?? "#888", fontSize: 9, letterSpacing: "0.06em", textTransform: "uppercase" }}>{n.kind}</span>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 }}>{nodeTitle(n) || n.id}</span>
          </span>
        ))}
      </span>
    </div>
  );
}

// ── Single tree row ──────────────────────────────────────────────────────────
function TreeRow({ node, index, depth, expandable, open, onToggle, onDelete, draggable, dragging, canDrop, onDragStartRow, onDragEndRow, onDropRow, mark, focus, flash, issues, dimmed, ctx, onContextFocus }: {
  node: DnaNode; index: Map<string, DnaNode>; depth: number;
  expandable: boolean; open: boolean; onToggle: () => void; onDelete?: () => void;
  // #5 — drag-to-reorder among same-kind siblings. draggable = this row has a grip; canDrop = a valid
  // sibling is being dragged over it; dragging = this is the row being dragged.
  draggable?: boolean; dragging?: boolean; canDrop?: boolean;
  onDragStartRow?: () => void; onDragEndRow?: () => void; onDropRow?: (before: boolean) => void;
  mark?: "edit" | "delete"; focus?: boolean; flash?: boolean; // mark = proposed change (#1); focus = rail focus (#2); flash = jump target (#1)
  issues?: DnaIssue[]; dimmed?: boolean; // health-lens (#6): this node's lints + dim-when-clean
  ctx?: "focus" | "consumes" | "consumedBy"; onContextFocus?: () => void; // #7 context-highlight role + the badge trigger
}) {
  const [dropEdge, setDropEdge] = useState<"top" | "bottom" | null>(null);
  const stale = isStale(node, index) || (node.kind === "scene" && isProseStale(node));
  const color = KIND_COLOR[node.kind] ?? "#888";
  const bg = KIND_BG[node.kind] ?? "transparent";
  const title = nodeTitle(node);
  const glyph = beatGlyph(node);
  const markColor = mark === "delete" ? "#c06060" : mark === "edit" ? "#8a8aff" : null;
  // Health glyph — a right-side ▲/△ on a different visual axis than the round stale dot, so they don't fight.
  const hasErr = issues?.some((i) => i.severity === "error") ?? false;
  const hasIssue = (issues?.length ?? 0) > 0;
  // #7 context-highlight hue: the focus node, what it's BUILT FROM (green), what's built ON it (blue).
  const ctxColor = ctx === "focus" ? "#cfcfcf" : ctx === "consumes" ? "#60a070" : ctx === "consumedBy" ? "#6a8aff" : null;

  return (
    <div id={`dna-node-${node.id}`}
      onDragOver={canDrop ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; const r = e.currentTarget.getBoundingClientRect(); setDropEdge(e.clientY < r.top + r.height / 2 ? "top" : "bottom"); } : undefined}
      onDragLeave={canDrop ? () => setDropEdge(null) : undefined}
      onDrop={canDrop ? (e) => { e.preventDefault(); onDropRow?.(dropEdge !== "bottom"); setDropEdge(null); } : undefined}
      style={{ position: "relative", transition: "background 0.4s, opacity 0.3s", opacity: dragging ? 0.4 : dimmed ? 0.3 : undefined, background: flash ? "#8a8aff22" : undefined, boxShadow: flash ? "inset 0 0 0 1px #8a8aff88" : undefined, borderRadius: flash ? 4 : undefined }}>
      {/* #5 — drop indicator: a line at the edge the dragged sibling would land on */}
      {dropEdge && <div style={{ position: "absolute", left: depth * 20 + 8, right: 12, [dropEdge]: 0, height: 2, background: "#8a8aff", zIndex: 2, pointerEvents: "none" }} />}
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
          // Precedence (spec collision budget): proposal mark > context hue (#7) > rail focus (#2).
          boxShadow: markColor ? `inset 3px 0 0 ${markColor}` : ctxColor ? `inset 3px 0 0 ${ctxColor}` : focus ? "inset 2px 0 0 #8a8aff66" : undefined,
          background: markColor ? `${markColor}12` : ctxColor ? `${ctxColor}1a` : focus ? "#8a8aff08" : undefined,
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

        {/* Kind badge — also the #7 context-focus trigger (light this node's ref-neighborhood) */}
        <span
          onClick={onContextFocus ? (e) => { e.stopPropagation(); onContextFocus(); } : undefined}
          title={onContextFocus ? "focus: light what this is built from / what draws on it" : undefined}
          style={{
            fontFamily: "ui-monospace, monospace", fontSize: 9, letterSpacing: "0.1em",
            textTransform: "uppercase", color: ctx === "focus" ? "#0a0a0a" : color, background: ctx === "focus" ? color : bg,
            padding: "1px 5px", borderRadius: 3, border: `1px solid ${ctx === "focus" ? color : `${color}30`}`,
            whiteSpace: "nowrap", flexShrink: 0, cursor: onContextFocus ? "pointer" : "default",
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
          {hasIssue && <span title={issues!.map((i) => `${i.severity === "error" ? "✕" : "⚠"} ${i.rule}: ${i.message}`).join("\n")}
            style={{ fontSize: 10, lineHeight: 1, color: hasErr ? "#f87171" : "#d0a060", flexShrink: 0 }}>{hasErr ? "▲" : "△"}</span>}
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
          {draggable && (
            <span draggable
              onClick={(e) => e.stopPropagation()}
              onDragStart={(e) => { e.stopPropagation(); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", node.id); onDragStartRow?.(); }}
              onDragEnd={(e) => { e.stopPropagation(); onDragEndRow?.(); }}
              title="drag to reorder" style={{ fontSize: 11, color: "#4a4a5a", cursor: "grab", padding: "0 2px", flexShrink: 0, lineHeight: 1 }}>⠿</span>
          )}
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
  { kind: "location", label: "locations" },
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
function NodeGroup({ groupId, label, hint, count, depth, collapsedSet, onToggle, children, alwaysShow, footer, action }: {
  groupId: string; label: string; hint?: string; count: number; depth: number;
  collapsedSet: Set<string>; onToggle: (id: string) => void; children: React.ReactNode;
  alwaysShow?: boolean; footer?: React.ReactNode; action?: React.ReactNode;
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
        {action && <span onClick={(e) => e.stopPropagation()} style={{ marginLeft: "auto" }}>{action}</span>}
      </div>
      {!collapsed && children}
      {!collapsed && footer}
    </div>
  );
}

// ── Discard story modal ───────────────────────────────────────────────────────
type DiscardLevel = "prose" | "scenes" | "beats" | "story";
const DISCARD_OPTIONS: { level: DiscardLevel; label: string; detail: string }[] = [
  { level: "prose",  label: "prose only",         detail: "clear written prose — keep scene plans, beats, movements" },
  { level: "scenes", label: "scenes + prose",      detail: "delete all scene nodes — keep beats and movements" },
  { level: "beats",  label: "beats + scenes",      detail: "delete all beat nodes and their scenes — keep movements" },
  { level: "story",  label: "full story",          detail: "delete movements, beats, scenes and all prose — keep foundations" },
];
function DiscardStoryModal({ nodes, onClose }: { nodes: DnaNode[]; onClose: () => void }) {
  const [level, setLevel] = useState<DiscardLevel>("prose");
  const [busy, setBusy] = useState(false);
  const mono = "ui-monospace, monospace";

  const movements = nodes.filter((n) => n.kind === "movement");
  const beats     = nodes.filter((n) => n.kind === "beat");
  const scenes    = nodes.filter((n) => n.kind === "scene");
  const counts: Record<DiscardLevel, string> = {
    prose:  `${scenes.filter((s) => (s.content as SceneContent).prose?.text?.trim()).length} scenes with prose`,
    scenes: `${scenes.length} scenes`,
    beats:  `${beats.length} beats · ${scenes.length} scenes`,
    story:  `${movements.length} movements · ${beats.length} beats · ${scenes.length} scenes`,
  };

  const run = async () => {
    setBusy(true);
    try {
      if (level === "prose") {
        const withProse = scenes.filter((s) => (s.content as SceneContent).prose?.text?.trim());
        await Promise.all(withProse.map((s) => {
          const { prose: _p, ...rest } = s.content as SceneContent;
          return saveNode({ ...s, content: rest as NodeContent });
        }));
      } else if (level === "scenes") {
        await Promise.all(scenes.map((s) => deleteNode(s.id)));
      } else if (level === "beats") {
        await Promise.all(beats.map((b) => deleteNode(b.id)));
      } else {
        await Promise.all(movements.map((m) => deleteNode(m.id)));
      }
      onClose();
    } catch (e) {
      alert(`Discard failed: ${(e as Error).message}`);
      setBusy(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ position: "absolute", inset: 0, background: "#000000aa" }} />
      <div style={{ position: "relative", background: "#0e0e12", border: "1px solid #2a2a38", borderRadius: 8, padding: "22px 24px", width: 420, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: "0.2em", textTransform: "uppercase", color: "#c06060" }}>discard story content</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {DISCARD_OPTIONS.map((o) => (
            <label key={o.level} style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", padding: "8px 10px", borderRadius: 5, background: level === o.level ? "#1e1e2a" : "transparent", border: `1px solid ${level === o.level ? "#3a3a5a" : "transparent"}` }}>
              <input type="radio" name="discard-level" value={o.level} checked={level === o.level} onChange={() => setLevel(o.level)}
                style={{ marginTop: 2, accentColor: "#c06060", flexShrink: 0 }} />
              <div>
                <div style={{ fontFamily: mono, fontSize: 11, color: "#cfcfcf", letterSpacing: "0.04em" }}>{o.label}</div>
                <div style={{ fontFamily: mono, fontSize: 10, color: "#555", marginTop: 2 }}>{o.detail}</div>
                {level === o.level && <div style={{ fontFamily: mono, fontSize: 9, color: "#7a3030", marginTop: 4, letterSpacing: "0.04em" }}>{counts[o.level]}</div>}
              </div>
            </label>
          ))}
        </div>
        <div style={{ display: "flex", gap: 16, justifyContent: "flex-end", paddingTop: 4 }}>
          <button onClick={onClose} disabled={busy} style={{ background: "none", border: "none", fontFamily: mono, fontSize: 11, color: "#555", cursor: "pointer", letterSpacing: "0.08em" }}>cancel</button>
          <button onClick={() => void run()} disabled={busy} style={{ background: "#3a1515", border: "1px solid #7a3030", borderRadius: 4, fontFamily: mono, fontSize: 11, color: busy ? "#7a3030" : "#e07070", cursor: busy ? "default" : "pointer", padding: "4px 14px", letterSpacing: "0.08em" }}>
            {busy ? "discarding…" : "discard"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Prose block — collapsible prose text under an expanded scene node ─────────
function ProseBlock({ node, depth, open, onToggle }: {
  node: DnaNode; depth: number; open: boolean; onToggle: () => void;
}) {
  const c = node.content as SceneContent;
  const text = c.prose?.text?.trim() ?? "";
  const words = c.prose?.words ?? (text ? text.split(/\s+/).length : 0);
  const stale = isProseStale(node);
  const mono = "ui-monospace, monospace";
  return (
    <div style={{ position: "relative" }}>
      <ConnectorTick depth={depth} />
      {/* Toggle row */}
      <div onClick={onToggle} style={{ display: "flex", alignItems: "baseline", gap: 8, paddingLeft: depth * 20 + 20, paddingRight: 12, paddingTop: 4, paddingBottom: 4, cursor: "pointer" }}>
        <span style={{ width: 12, flexShrink: 0, color: "#3a4a3a", fontSize: 9 }}>{open ? "▼" : "▶"}</span>
        <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: text ? "#4ade8066" : "#2a3a2a" }}>prose</span>
        {words > 0 && <span style={{ fontFamily: mono, fontSize: 9, color: "#3a4a3a" }}>{words}w</span>}
        {stale && <span style={{ fontFamily: mono, fontSize: 8, letterSpacing: "0.1em", textTransform: "uppercase", color: "#f59e0b" }}>stale</span>}
        {!text && <span style={{ fontFamily: mono, fontSize: 9, color: "#2a3a2a", fontStyle: "italic" }}>not yet written</span>}
      </div>
      {/* Prose text */}
      {open && text && (
        <div style={{ paddingLeft: depth * 20 + 32, paddingRight: 16, paddingBottom: 10 }}>
          <div style={{ fontFamily: "ui-serif, Georgia, serif", fontSize: 13, lineHeight: 1.7, color: stale ? "#8a8060" : "#a8a8b0", whiteSpace: "pre-wrap", borderLeft: `2px solid ${stale ? "#f59e0b22" : "#4ade8022"}`, paddingLeft: 12 }}>
            {text}
          </div>
        </div>
      )}
      {open && !text && (
        <div style={{ paddingLeft: depth * 20 + 32, paddingRight: 16, paddingBottom: 8, fontFamily: mono, fontSize: 11, color: "#2a3a2a", fontStyle: "italic" }}>
          — no prose yet
        </div>
      )}
    </div>
  );
}

// ── Recursive tree subtree ───────────────────────────────────────────────────
interface TreeView {
  onToggle: (id: string) => void; onToggleDetail: (id: string) => void;
  onAdd: (parentId: string, kind: DnaNode["kind"]) => void | Promise<void>;
  onDelete: (node: DnaNode) => void;
  onJump: (id: string) => void;         // #1 — reveal + scroll + flash a node by id
  dragId: string | null;                // #5 — the node currently being dragged (null = no drag)
  onDragStart: (id: string) => void; onDragEnd: () => void;
  onDrop: (target: DnaNode, before: boolean) => void; // reorder dragId to before/after target
  backlinks: Map<string, DnaNode[]>;    // #2 — inbound cross-references
  flashId: string | null;               // #1 — the just-jumped-to node
  proposal: ProposalView | null;        // proposed ops to overlay
  focusKinds: Set<string> | null;       // the rail's stage focus (null = rail closed)
  issuesByNode: Map<string, DnaIssue[]>; // #6 — health lints grouped by the node they attach to
  healthLens: boolean;                  // #6 — dim clean nodes so only the broken ones (+ groups) pop
  contextId: string | null;             // #7 — the focused node (null = no context active)
  ctxConsumes: Set<string>;             // #7 — ids the focused node REFERENCES (built from)
  ctxConsumedBy: Set<string>;           // #7 — ids that reference the focused node (built on it)
  onContextFocus: (id: string) => void; // #7 — toggle context focus from a kind badge
  proseOpenSet: Set<string>;            // scene ids whose prose block is expanded
  onToggleProse: (id: string) => void;
  onDiscardStory: () => void;
  brief: Brief | null;                  // seed: the book's mandate (saved to books.brief)
  onSaveBrief: (patch: Partial<Brief>) => Promise<void>;
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
  const fields = specs.map((spec) => <EditableField key={spec.key} node={node} spec={spec} depth={depth + 1} index={index} onJump={h.onJump} />);
  const backlinks = <BacklinksRow node={node} backlinks={h.backlinks} depth={depth + 1} onJump={h.onJump} />;
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
          {backlinks}
          {/* Foundations (cast & world) first — the materials — then the spine built from them. */}
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
          <NodeGroup groupId={`${node.id}::story`} label="story" hint="the spine — acts in order"
            count={ladder.length} depth={depth + 1} collapsedSet={collapsedSet} onToggle={h.onToggle} alwaysShow
            footer={<>{phantoms(node.id, "movement", depth + 2)}<AddRow label="movement" depth={depth + 2} onAdd={() => h.onAdd(node.id, "movement")} /></>}
            action={ladder.length > 0 ? (
              <span onClick={() => h.onDiscardStory()}
                title="Delete all movements, beats, scenes and prose"
                style={{ fontFamily: "ui-monospace, monospace", fontSize: 8, letterSpacing: "0.1em", textTransform: "uppercase", color: "#7a3030", cursor: "pointer" }}>
                discard ✕
              </span>
            ) : undefined}>
            {sub(ladder, depth + 2)}
          </NodeGroup>
        </>
      );
    } else if (node.kind === "seed") {
      // The seed IS the brief — its node-local logline is folded into the brief's `premise` field below,
      // then its structural children (premise → pillar → the rest of the tree) render beneath.
      body = (
        <>
          {backlinks}
          <BriefSection brief={h.brief} onSave={h.onSaveBrief} depth={depth + 1} />
          {sub(kids, depth + 1)}
        </>
      );
    } else {
      const childAdd = node.kind === "movement" ? "beat" : node.kind === "beat" ? "scene" : null;
      body = (
        <>
          {fields}
          {backlinks}
          {node.kind === "scene" && (
            <ProseBlock node={node} depth={depth + 1} open={h.proseOpenSet.has(node.id)} onToggle={() => h.onToggleProse(node.id)} />
          )}
          {sub(kids, depth + 1)}
          {childAdd && phantoms(node.id, childAdd, depth + 1)}
          {childAdd && <AddRow label={childAdd} depth={depth + 1} onAdd={() => h.onAdd(node.id, childAdd as DnaNode["kind"])} />}
        </>
      );
    }
  }

  // Delete is allowed on addable kinds (not the seed/premise/pillar singletons) when unlocked.
  const deletable = !node.authoring.locked && (isEntityKind(node.kind) || ["movement", "beat", "scene"].includes(node.kind));
  // #5 — drag-to-reorder among same-kind siblings (entities by kind under the pillar; movement/beat/scene by
  // parent). A row is a drop target only while a SIBLING (same parent + kind) is being dragged.
  const reorderable = isEntityKind(node.kind) || ["movement", "beat", "scene"].includes(node.kind);
  const dragged = h.dragId ? index.get(h.dragId) : null;
  const canDrop = !!dragged && dragged.id !== node.id && dragged.parent_id === node.parent_id && dragged.kind === node.kind;
  // #1 proposal mark for THIS node. #2 focus highlight (only when rail open → focusKinds set).
  const editPatch = h.proposal?.edits.get(node.id);
  const mark = h.proposal ? (h.proposal.deletes.has(node.id) ? "delete" : editPatch ? "edit" : undefined) : undefined;
  const focus = h.focusKinds?.has(node.kind) ?? false;
  // #6 health lens: this node's lints. #7 context-highlight: this node's role in the focused neighborhood.
  const issues = h.issuesByNode.get(node.id);
  const ctxActive = h.contextId !== null;
  const ctx = !ctxActive ? undefined
    : node.id === h.contextId ? "focus"
      : h.ctxConsumes.has(node.id) ? "consumes"
        : h.ctxConsumedBy.has(node.id) ? "consumedBy" : undefined;
  // Dim when: health lens on + clean, OR context active + not in the neighborhood.
  const dimmed = (h.healthLens && !issues?.length) || (ctxActive && !ctx);

  return (
    <div>
      <TreeRow node={node} index={index} depth={depth} expandable={expandable} open={open} onToggle={toggle}
        onDelete={deletable ? () => h.onDelete(node) : undefined}
        draggable={reorderable} dragging={h.dragId === node.id} canDrop={canDrop}
        onDragStartRow={() => h.onDragStart(node.id)} onDragEndRow={h.onDragEnd}
        onDropRow={(before) => h.onDrop(node, before)}
        mark={mark} focus={focus} flash={h.flashId === node.id} issues={issues} dimmed={dimmed}
        ctx={ctx} onContextFocus={() => h.onContextFocus(node.id)} />
      {editPatch && <OpDiffBlock node={node} content={editPatch} nodes={nodes} depth={depth + 1} />}
      {body}
    </div>
  );
}

// ── Brief section — rendered inside the seed when expanded ───────────────────
// The brief lives on books.brief (not in book_nodes), so it has its own save path.
// Fields: genre, audience, tone, success_criteria, scope.word_target, content_type.level.
// The seed's logline field (book_nodes.content.logline) is the prose distillation;
// these are the publishing/mandate fields the whole generation stack derives from.
function BriefFieldRow({ label, depth, display, onEdit, children }: {
  label: string; depth: number; display: React.ReactNode; onEdit?: () => void; children?: React.ReactNode;
}) {
  return (
    <div style={detailRowStyle(depth)} onClick={(e) => e.stopPropagation()}>
      <ConnectorTick depth={depth} />
      <span style={{ width: 12, flexShrink: 0 }} />
      <span style={labelStyle}>{label}</span>
      {children || (
        <span onClick={onEdit} style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, color: display ? "#cfcfcf" : "#4a4a4a", whiteSpace: "pre-wrap", wordBreak: "break-word", flex: 1, lineHeight: 1.5, cursor: onEdit ? "text" : "default", fontStyle: display ? "normal" : "italic" }}>
          {display || `＋ ${label}`}
        </span>
      )}
    </div>
  );
}

function BriefSection({ brief, onSave, depth }: { brief: Brief | null; onSave: (patch: Partial<Brief>) => Promise<void>; depth: number }) {
  const [editingField, setEditingField] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);
  useEffect(() => { if (editingField) inputRef.current?.focus(); }, [editingField]);

  const commit = async (field: string, value: unknown) => {
    setBusy(true);
    setEditingField(null);
    try {
      if (field === "word_target") await onSave({ scope: { ...brief?.scope, word_target: value as number } });
      else if (field === "heat") await onSave({ content_type: { ...brief?.content_type, level: value as Brief["content_type"] extends { level?: infer L } | undefined ? L : never } });
      else await onSave({ [field]: value });
    } catch (e) { alert(`Save failed: ${(e as Error).message}`); }
    finally { setBusy(false); }
  };

  const startEdit = (field: string, current: string) => { setDraft(current); setEditingField(field); };
  const commonProps = (field: string, multiline?: boolean) => ({
    ref: inputRef as never, value: draft, disabled: busy,
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => setDraft(e.target.value),
    onBlur: () => { void commit(field, multiline ? draft.trim() : draft.trim()); },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); setEditingField(null); }
      else if (e.key === "Enter" && (!multiline || e.metaKey || e.ctrlKey)) { e.preventDefault(); void commit(field, draft.trim()); }
    },
    style: { ...inputStyle, flex: 1, resize: "vertical" as const },
  });

  const toneArr = Array.isArray(brief?.tone) ? brief.tone : [];
  const heatLabel = CONTENT_TYPES.find((c) => c.value === brief?.content_type?.level)?.label ?? "";
  const bandLabel = SCOPE_BANDS.find((b) => b.value === brief?.scope?.band)?.label ?? "";

  return (
    <>
      <div style={{ ...detailRowStyle(depth - 1), paddingTop: 6 }}>
        <ConnectorTick depth={depth - 1} />
        <span style={{ width: 12, flexShrink: 0 }} />
        <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase", color: "#5a5a7a" }}>brief — mandate</span>
      </div>

      {/* idea — the author's raw "what is the book about?" (brief.idea); the logline is DERIVED from this, not equal to it */}
      <BriefFieldRow label="idea" depth={depth} display={briefIdea(brief)} onEdit={() => startEdit("idea", briefIdea(brief) ?? "")}>
        {editingField === "idea" && <textarea rows={Math.min(6, Math.max(2, draft.split("\n").length))} {...commonProps("idea", true)} />}
      </BriefFieldRow>

      {/* genre */}
      <BriefFieldRow label="genre" depth={depth} display={brief?.genre} onEdit={() => startEdit("genre", brief?.genre ?? "")}>
        {editingField === "genre" && <input {...commonProps("genre")} />}
      </BriefFieldRow>

      {/* audience */}
      <BriefFieldRow label="audience" depth={depth} display={brief?.audience} onEdit={() => startEdit("audience", brief?.audience ?? "")}>
        {editingField === "audience" && <input {...commonProps("audience")} />}
      </BriefFieldRow>

      {/* tone — comma-sep list */}
      <BriefFieldRow label="tone" depth={depth} display={toneArr.join(", ")} onEdit={() => startEdit("tone", toneArr.join(", "))}>
        {editingField === "tone" && (
          <input {...commonProps("tone")} onBlur={() => { void commit("tone", draft.split(",").map((s) => s.trim()).filter(Boolean)); }} style={{ ...inputStyle, flex: 1 }} />
        )}
      </BriefFieldRow>

      {/* success_criteria */}
      <BriefFieldRow label="success criteria" depth={depth} display={brief?.success_criteria} onEdit={() => startEdit("success_criteria", brief?.success_criteria ?? "")}>
        {editingField === "success_criteria" && <textarea rows={3} {...commonProps("success_criteria", true)} />}
      </BriefFieldRow>

      {/* scope.word_target */}
      <BriefFieldRow label="word target" depth={depth} display={brief?.scope?.word_target ? `${brief.scope.word_target.toLocaleString()} words${bandLabel ? ` · ${bandLabel}` : ""}` : bandLabel} onEdit={() => startEdit("word_target", String(brief?.scope?.word_target ?? ""))}>
        {editingField === "word_target" && (
          <input type="number" {...commonProps("word_target")} onBlur={() => { const n = parseInt(draft); void commit("word_target", isNaN(n) ? undefined : n); }} style={{ ...inputStyle, flex: 1 }} />
        )}
      </BriefFieldRow>

      {/* content_type.level — select */}
      <div style={detailRowStyle(depth)} onClick={(e) => e.stopPropagation()}>
        <ConnectorTick depth={depth} />
        <span style={{ width: 12, flexShrink: 0 }} />
        <span style={labelStyle}>heat</span>
        <select value={brief?.content_type?.level ?? ""} disabled={busy}
          onChange={(e) => { void commit("heat", e.target.value || undefined); }}
          style={{ ...inputStyle, fontSize: 11, padding: "1px 4px", flex: 1 }}>
          <option value="">(not set)</option>
          {CONTENT_TYPES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </div>
    </>
  );
}

// ── Voice & Feel panel (#2 — taste lives here) ────────────────────────────────
// Aim 2: TASTE is user-owned and subjective (premise tone, pillar controlling idea, the whole voice profile,
// each character's idiolect) but it's scattered across four tree depths, so it reads as "more work than
// writing." This pins every `taste` field (tagged in dnaSchema, the SSOT) into ONE surface at the top of the
// tree. The MACHINERY (state keys, thread roles, grounds_in — the genOnly fields) is the AI's to maintain
// and stays hidden from the editor entirely. Reuses EditableField so edits flow through the same save path,
// and each group title jumps to the full node in the tree below.
function VoiceFeelPanel({ nodes, index, onJump }: { nodes: DnaNode[]; index: Map<string, DnaNode>; onJump: (id: string) => void }) {
  const [open, setOpen] = useState(true);
  // Taste-bearing nodes in authoring order: premise → pillar → voice, then the cast (idiolect each).
  const groups: { node: DnaNode; label: string; specs: EditSpec[] }[] = [];
  for (const kind of ["premise", "pillar", "voice_profile"] as const) {
    const n = nodes.find((x) => x.kind === kind);
    if (n && tasteSpecs(kind).length) groups.push({ node: n, label: kind === "voice_profile" ? "voice" : kind, specs: tasteSpecs(kind) });
  }
  for (const c of nodes.filter((n) => n.kind === "character").sort((a, b) => a.position - b.position)) {
    const specs = tasteSpecs("character");
    if (specs.length) groups.push({ node: c, label: `◦ ${nodeTitle(c) || "character"}`, specs });
  }
  if (!groups.length) return null;
  const mono = "ui-monospace, monospace";
  return (
    <div style={{ borderBottom: "1px solid #1a1a1a", background: "#0c0c10" }}>
      <div onClick={() => setOpen((v) => !v)} style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "9px 16px", cursor: "pointer" }}>
        <span style={{ width: 12, color: "#7dd3fc", fontSize: 9 }}>{open ? "▼" : "▶"}</span>
        <span style={{ fontFamily: mono, fontSize: 10, letterSpacing: "0.2em", textTransform: "uppercase", color: "#9bd3e6" }}>voice & feel</span>
        <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: "0.06em", color: "#3a4a52" }}>taste lives here — tone · idea · voice · idiolect</span>
      </div>
      {open && (
        <div style={{ paddingBottom: 8 }}>
          {groups.map((g) => (
            <div key={g.node.id}>
              <div onClick={() => onJump(g.node.id)} title="jump to this node in the tree"
                style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "5px 16px 2px", cursor: "pointer" }}>
                <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: KIND_COLOR[g.node.kind] ?? "#888", borderBottom: "1px dotted #2a3a42" }}>{g.label}</span>
              </div>
              {g.specs.map((spec) => <EditableField key={spec.key} node={g.node} spec={spec} depth={1} index={index} onJump={onJump} />)}
            </div>
          ))}
        </div>
      )}
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
  // #1 — pending proposals from the agent thread (book_agent_runs), mirrored so the tree can overlay them.
  const [agentProposals, setAgentProposals] = useState<AgentProposal[]>([]);
  const [showIssues, setShowIssues] = useState(false); // drill into the lints behind the score
  const [healthLens, setHealthLens] = useState(false); // #6 — dim clean nodes; surface only the broken ones
  const [contextId, setContextId] = useState<string | null>(null); // #7 — the node whose ref-neighborhood is lit
  const [flashId, setFlashId] = useState<string | null>(null); // #1 — the node a jump just revealed
  const [dragId, setDragId] = useState<string | null>(null); // #5 — the node being dragged
  const [brief, setBrief] = useState<Brief | null>(null);
  const [proseOpenSet, setProseOpenSet] = useState<Set<string>>(new Set());
  const toggleProse = useCallback((id: string) => {
    setProseOpenSet((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }, []);

  const [discardOpen, setDiscardOpen] = useState(false);
  const discardStory = useCallback(() => setDiscardOpen(true), []);

  const saveBrief = useCallback(async (patch: Partial<Brief>) => {
    const next = { ...brief, ...patch, updated_at: new Date().toISOString() } as Brief;
    setBrief(next);
    const { error: err } = await supabase.from("books").update({ brief: next }).eq("id", bookId);
    if (err) throw new Error(err.message);
    setSettings((prev) => ({ ...prev, word_target: next.scope?.word_target }));
    // TODO(premise≠logline): today the raw idea is mirrored straight into the seed's logline. The
    // intended model DERIVES a real logline (protagonist/inciting/goal/obstacle/stakes) from the idea
    // instead of equating them — see docs/dna-studio-analysis.md §0. Until then, keep the mirror so the
    // journey gating, studio, and overview (which read seed.content.logline) stay consistent.
    if ("idea" in patch && nodes) {
      const seed = nodes.find((n) => n.kind === "seed");
      if (seed) await patchNodeContent(seed, { logline: (patch.idea ?? "").trim() } as NodeContent);
    }
  }, [brief, bookId, nodes]);

  // Seed an empty tree: create the root `seed` node, prefilling its logline from the brief's idea.
  // Everything else (premise/pillar/cast/spine) grows from here via the reviser or the studio.
  const [seeding, setSeeding] = useState(false);
  const seedTree = useCallback(async () => {
    if (seeding) return;
    setSeeding(true);
    try {
      const seed = emptyNode(bookId, "seed", 0, null);
      const idea = briefIdea(brief)?.trim();
      if (idea) seed.content = { logline: idea };
      await saveNode(seed);
      setOpenSet((p) => new Set(p).add(seed.id)); // open it so the brief shows immediately
    } catch (e) { alert(`Couldn't seed the tree: ${(e as Error).message}`); }
    finally { setSeeding(false); }
  }, [bookId, brief, seeding]);

  useEffect(() => {
    if (!bookId) { setError("no book id"); return; }
    void (async () => {
      const [{ data: nodeRows, error: nodesErr }, { data: book, error: bookErr }] = await Promise.all([
        supabase.from("book_nodes").select("*").eq("book_id", bookId).order("position"),
        supabase.from("books").select("name, author, brief, mode").eq("id", bookId).maybeSingle(),
      ]);
      if (nodesErr || bookErr) { setError((nodesErr ?? bookErr)?.message ?? "error"); return; }
      setBookName(book?.name ?? "");
      const loadedBrief = (book?.brief as Brief | null) ?? null;
      setBrief(loadedBrief);
      setSettings({ title: book?.name ?? undefined, author: (book?.author as string | null) ?? undefined,
        word_target: loadedBrief?.scope?.word_target, mode: (book as { mode?: string } | null)?.mode === "picture" ? "picture" : "prose" });
      const loaded = (nodeRows ?? []) as DnaNode[];
      setNodes(loaded);
    })();
  }, [bookId]);

  // #1 — mirror the agent thread's pending proposals so the tree can overlay them in place. The AgentRail
  // owns apply/discard; this is read-only (live over Realtime, refresh = no-op).
  useEffect(() => {
    if (!bookId) return;
    let alive = true;
    const load = async () => {
      const { data } = await supabase.from("book_agent_runs").select("proposals").eq("book_id", bookId).eq("kind", "thread").maybeSingle();
      if (alive) setAgentProposals((data?.proposals as AgentProposal[] | null) ?? []);
    };
    void load();
    const ch = supabase.channel(`treeagent_${bookId}_${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "book_agent_runs", filter: `book_id=eq.${bookId}` }, () => void load())
      .subscribe();
    return () => { alive = false; void supabase.removeChannel(ch); };
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

  // ── Fork ──────────────────────────────────────────────────────────────────────
  const [forking, setForking] = useState(false);
  const forkDna = useCallback(async () => {
    if (!nodes || !bookId || forking) return;
    setForking(true);
    try {
      const { data: src } = await supabase.from("books")
        .select("name, author, brief, mode, is_public")
        .eq("id", bookId)
        .single();
      const { data: fork, error: forkErr } = await supabase
        .from("books")
        .insert({
          name: `Fork of ${src?.name ?? bookName}`,
          author: (src?.author as string | null) ?? null,
          brief: (src?.brief as object | null) ?? null,
          mode: (src?.mode as string | null) ?? null,
          is_public: false,
        })
        .select("id")
        .single();
      if (forkErr || !fork) throw forkErr ?? new Error("Could not create fork");
      // Remap all node IDs so the forked tree is independent (same-id rows would violate PK).
      const idMap = new Map(nodes.map((n) => [n.id, newId()]));
      const forkedNodes = nodes.map((n) => ({
        id: idMap.get(n.id)!,
        book_id: fork.id as number,
        parent_id: n.parent_id ? (idMap.get(n.parent_id) ?? null) : null,
        level: n.level, kind: n.kind, position: n.position,
        content: n.content, authoring: n.authoring,
        proposals: null, chosen: (n.chosen as unknown) ?? null,
      }));
      const { error: nodesErr } = await supabase.from("book_nodes").insert(forkedNodes);
      if (nodesErr) throw nodesErr;
      window.open(`/books/${fork.id as number}/dna/tree`, "_blank");
    } catch (e) {
      alert(`Fork failed: ${(e as Error).message}`);
    } finally {
      setForking(false);
    }
  }, [nodes, bookId, bookName, forking]);

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

  // #4 — delete-safety: surface inbound cross-references (which would be left dangling) before confirming.
  const removeNode = useCallback((node: DnaNode) => {
    if (!nodes) return;
    const kids = childrenOf(nodes, node.id).length;
    const inbound = backlinkIndex(nodes).get(node.id) ?? [];
    const label = nodeTitle(node) || node.kind;
    const refWarn = inbound.length
      ? `\n\n⚠ ${inbound.length} node(s) reference this — they'll be left with a dangling link:\n${inbound.slice(0, 8).map((n) => `• ${n.kind}: ${nodeTitle(n) || n.id}`).join("\n")}${inbound.length > 8 ? `\n…and ${inbound.length - 8} more` : ""}`
      : "";
    if (!window.confirm(`Delete ${node.kind} "${label}"${kids ? ` and its ${kids} child node(s)` : ""}?${refWarn}\n\nThis cannot be undone.`)) return;
    void deleteNode(node.id).catch((e) => alert(`Delete failed: ${(e as Error).message}`));
  }, [nodes]);

  // #5 — drag-to-reorder. Move the dragged node before/after `target` within their shared sibling group,
  // then RENORMALIZE the group's positions to 0..n-1 (this also repairs pre-existing duplicate/zero
  // positions, which is why the old swap-based reorder silently no-op'd). Only the changed rows are written.
  const onDropReorder = useCallback((target: DnaNode, before: boolean) => {
    const draggedId = dragId;
    setDragId(null);
    if (!nodes || !draggedId || draggedId === target.id) return;
    const dragged = nodes.find((n) => n.id === draggedId);
    if (!dragged || dragged.parent_id !== target.parent_id || dragged.kind !== target.kind) return;
    const group = nodes.filter((n) => n.parent_id === target.parent_id && n.kind === target.kind).sort((a, b) => a.position - b.position);
    const without = group.filter((n) => n.id !== draggedId);
    let at = without.findIndex((n) => n.id === target.id);
    if (at < 0) return;
    if (!before) at += 1;
    without.splice(at, 0, dragged);
    const writes = without.map((n, i) => (n.position === i ? null : { ...n, position: i })).filter(Boolean) as DnaNode[];
    if (!writes.length) return;
    void saveNodes(writes).catch((e) => alert(`Reorder failed: ${(e as Error).message}`));
  }, [nodes, dragId]);

  // #1 — jump to a node by id: un-collapse its ancestors (and the synthetic story/world groups it lives in),
  // open it if it's a detail-only leaf, then flash it. The scroll happens in the effect below, after the
  // expansion has committed to the DOM.
  const jumpTo = useCallback((id: string) => {
    if (!nodes) return;
    const idx = byId(nodes);
    const target = idx.get(id);
    if (!target) return;
    const reveal = new Set<string>();
    let cur: DnaNode | undefined = target;
    while (cur) { reveal.add(cur.id); cur = cur.parent_id ? idx.get(cur.parent_id) : undefined; }
    const pillar = pillarOf(nodes);
    if (pillar) {
      reveal.add(pillar.id);
      if (isEntityKind(target.kind)) { reveal.add(`${pillar.id}::world`); reveal.add(`${pillar.id}::world::${target.kind}`); }
      else if (!["pillar", "premise", "seed"].includes(target.kind)) reveal.add(`${pillar.id}::story`);
    }
    setCollapsedSet((prev) => { const next = new Set(prev); for (const r of reveal) next.delete(r); return next; });
    setOpenSet((prev) => new Set(prev).add(id));
    setFlashId(id);
  }, [nodes]);

  // #6 — un-collapse the ancestors (and synthetic story/world groups) of many nodes at once, no flash. Used
  // by the health lens so a broken beat/scene isn't dimmed-AND-hidden inside a collapsed act. Mirrors jumpTo.
  const revealNodes = useCallback((ids: string[]) => {
    if (!nodes || !ids.length) return;
    const idx = byId(nodes);
    const pillar = pillarOf(nodes);
    const reveal = new Set<string>();
    for (const id of ids) {
      let cur: DnaNode | undefined = idx.get(id);
      const target = cur;
      while (cur) { reveal.add(cur.id); cur = cur.parent_id ? idx.get(cur.parent_id) : undefined; }
      if (pillar && target) {
        reveal.add(pillar.id);
        if (isEntityKind(target.kind)) { reveal.add(`${pillar.id}::world`); reveal.add(`${pillar.id}::world::${target.kind}`); }
        else if (!["pillar", "premise", "seed"].includes(target.kind)) reveal.add(`${pillar.id}::story`);
      }
    }
    setCollapsedSet((prev) => { const next = new Set(prev); for (const r of reveal) next.delete(r); return next; });
  }, [nodes]);

  // #1 — once a jump has set flashId (and the reveal has rendered), scroll the node into view; clear the
  // flash after a beat. Re-runs if a new jump fires before the timer elapses.
  useEffect(() => {
    if (!flashId) return;
    document.getElementById(`dna-node-${flashId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    const t = setTimeout(() => setFlashId(null), 1600);
    return () => clearTimeout(t);
  }, [flashId]);

  // ── Proposal overlay (#1) ─────────────────────────────────────────────────────
  // Overlay the union of all the agent thread's pending proposals' ops in the tree, in place.
  const proposalView = useMemo(() => indexProposal(agentProposals.flatMap((p) => p.ops), nodes ?? []), [agentProposals, nodes]);
  const backlinks = useMemo(() => backlinkIndex(nodes ?? []), [nodes]); // #2 — inbound cross-references

  // #7 — context-highlight: toggle the focused node, and auto-reveal its ref-neighborhood so a referenced
  // character/world_fact buried in a collapsed group isn't dimmed-AND-hidden. Clicking the same badge clears.
  const focusContext = useCallback((id: string) => {
    setContextId((cur) => {
      if (cur === id) return null;
      if (nodes) {
        const node = byId(nodes).get(id);
        const neighborhood = [id, ...(node ? refsOf(node) : []), ...(backlinks.get(id) ?? []).map((n) => n.id)];
        revealNodes(neighborhood);
      }
      return id;
    });
  }, [nodes, backlinks, revealNodes]);
  // Esc clears the active context focus.
  useEffect(() => {
    if (contextId === null) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setContextId(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [contextId]);

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
  // #6 — group the lints by the node they attach to, for the per-row health glyph + the lens.
  const issuesByNode = new Map<string, DnaIssue[]>();
  for (const i of health.issues) { if (!i.nodeId) continue; const a = issuesByNode.get(i.nodeId); if (a) a.push(i); else issuesByNode.set(i.nodeId, [i]); }
  // #7 — the focused node's neighborhood: what it's built from (refsOf) and what's built on it (backlinks).
  const ctxNode = contextId ? index.get(contextId) : undefined;
  const ctxConsumes = new Set<string>(ctxNode ? refsOf(ctxNode) : []);
  const ctxConsumedBy = new Set<string>(contextId ? (backlinks.get(contextId)?.map((n) => n.id) ?? []) : []);
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const barColor = (n: number) => (n >= 0.8 ? "#4ade80" : n >= 0.5 ? "#fbbf24" : "#f87171");
  const issueTitle = (i: typeof health.issues[number]) => {
    const n = i.nodeId ? index.get(i.nodeId) : undefined;
    return n ? `${n.kind}${nodeTitle(n) ? ` · ${nodeTitle(n)}` : ""}` : i.nodeId ?? "";
  };

  return (
    <div style={{ ...base, marginRight: railOpen ? 420 : 0 }}>
      {discardOpen && <DiscardStoryModal nodes={nodes} onClose={() => setDiscardOpen(false)} />}
      {/* The tool-using editor's agent (durable revise-agent thread), promoted into the tree rail. The
          studio components read theme CSS vars; we override them here with the tree's dark monospace
          palette (#8a8aff accent) so the rail matches the page instead of the app's light studio skin. */}
      {railOpen && (
        <div style={{
          position: "fixed", top: 0, right: 0, bottom: 0, width: 420, zIndex: 20,
          background: "hsl(var(--background))", borderLeft: "1px solid #1c1c22", display: "flex", flexDirection: "column",
          // Dark-mono palette override (HSL triplets) scoped to the rail.
          "--background": "240 11% 5%", "--foreground": "0 0% 80%",
          "--card": "240 11% 6%", "--popover": "240 11% 6%",
          "--primary": "240 100% 77%", "--primary-foreground": "240 30% 10%",
          "--muted-foreground": "0 0% 50%", "--destructive": "0 70% 60%",
          "--border": "240 16% 18%", "--input": "240 16% 20%", "--ring": "240 100% 77%",
          "--pv-accent": "240 100% 77%", "--pv-border-soft": "240 16% 22%",
          "--pv-surface-2": "240 14% 11%", "--pv-text-faint": "0 0% 40%",
          "--pv-text-muted": "0 0% 60%", "--pv-ink-soft": "0 0% 70%",
        } as React.CSSProperties}>
          <div style={{ display: "flex", justifyContent: "flex-end", padding: "8px 10px 0" }}>
            <span onClick={() => setRailOpen(false)} title="close" style={{ color: "#666", cursor: "pointer", fontSize: 14, lineHeight: 1 }}>✕</span>
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <AgentRail bookId={bookId} nodes={nodes} settings={settings} />
          </div>
        </div>
      )}
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
          {/* #6 — health lens: dim every clean node so only the broken ones (+ their groups) stay lit */}
          {(health.errors + health.warns) > 0 && (
            <button onClick={() => { const on = !healthLens; setHealthLens(on); if (on) revealNodes(health.issues.map((i) => i.nodeId).filter((x): x is string => !!x)); }}
              title="dim healthy nodes — surface only the broken ones"
              style={{ background: healthLens ? "#d0a06022" : "none", border: `1px solid ${healthLens ? "#d0a06066" : "#2a2a2a"}`, borderRadius: 4, cursor: "pointer", fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", color: healthLens ? "#d0a060" : "#555", fontFamily: "ui-monospace, monospace", padding: "2px 7px" }}>
              ◐ lens
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
          <button onClick={() => void forkDna()} disabled={forking} title="Copy this DNA tree into a new book to experiment freely"
            style={{ background: "none", border: "none", color: forking ? "#444" : "#555", fontSize: 10, cursor: forking ? "default" : "pointer", letterSpacing: "0.1em", textTransform: "uppercase" }}>
            {forking ? "forking…" : "fork →"}
          </button>
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
        <span style={{ fontSize: 9, color: "#4a5a52", marginLeft: 8, letterSpacing: "0.04em" }} title="state keys, thread roles, grounds_in, polarity oscillation — the AI maintains these; you author taste (Voice & Feel)">plumbing (state · roles · grounds_in) is AI-maintained</span>
        {/* #7 — context legend: what the lit hues mean + how to clear */}
        {ctxNode && (
          <span style={{ fontSize: 9, letterSpacing: "0.06em", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: "#cfcfcf" }}>▎context: {ctxNode.kind}{nodeTitle(ctxNode) ? ` ${nodeTitle(ctxNode)}` : ""}</span>
            <span style={{ color: "#60a070" }}>green = built from</span>
            <span style={{ color: "#6a8aff" }}>blue = draws on it</span>
            <span onClick={() => setContextId(null)} style={{ color: "#555", cursor: "pointer", textTransform: "uppercase" }}>esc ✕</span>
          </span>
        )}
      </div>

      {/* #4 — the lints behind the score: structural faults (misparented / orphan / duplicate) + craft warns */}
      {showIssues && (health.errors + health.warns) > 0 && (
        <div style={{ padding: "8px 16px", borderBottom: "1px solid #1a1a1a", display: "flex", flexDirection: "column", gap: 3, maxHeight: 200, overflowY: "auto" }}>
          {health.issues.map((i, idx) => (
            <div key={idx} onClick={i.nodeId ? () => jumpTo(i.nodeId!) : undefined}
              style={{ display: "flex", alignItems: "baseline", gap: 8, fontFamily: "ui-monospace, monospace", fontSize: 11, cursor: i.nodeId ? "pointer" : "default", borderRadius: 3, padding: "1px 4px", marginLeft: -4 }}
              onMouseEnter={i.nodeId ? (e) => { e.currentTarget.style.background = "#ffffff08"; } : undefined}
              onMouseLeave={i.nodeId ? (e) => { e.currentTarget.style.background = "transparent"; } : undefined}>
              <span style={{ color: i.severity === "error" ? "#f87171" : "#d0a060", flexShrink: 0 }}>{i.severity === "error" ? "✕" : "⚠"}</span>
              <span style={{ color: "#666", letterSpacing: "0.04em", flexShrink: 0, width: 140 }}>{i.rule}</span>
              <span style={{ color: "#999", flex: 1 }}>{i.message}</span>
              {i.nodeId && <span style={{ color: "#555", flexShrink: 0 }}>{issueTitle(i)} →</span>}
            </div>
          ))}
        </div>
      )}

      {/* #1 — proposal banner: the agent's pending changes are previewed in the tree; review + apply in the rail */}
      {agentProposals.length > 0 && (
        <div onClick={() => setRailOpen(true)} title="open the agent to review + apply"
          style={{ padding: "8px 16px", borderBottom: "1px solid #2a2a44", background: "#13131a", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", cursor: "pointer" }}>
          <span style={{ fontSize: 9, color: "#8a8aff", letterSpacing: "0.14em", textTransform: "uppercase" }}>✦ {agentProposals.reduce((n, p) => n + p.ops.length, 0)} proposed change{agentProposals.reduce((n, p) => n + p.ops.length, 0) === 1 ? "" : "s"}</span>
          <span style={{ fontFamily: "ui-serif, Georgia, serif", fontSize: 12.5, color: "#c8c8d0", flex: 1, minWidth: 200 }}>{agentProposals.map((p) => p.summary).filter(Boolean).join(" · ")}</span>
          <span style={{ fontSize: 11, color: "#8a8aff", letterSpacing: "0.08em", textTransform: "uppercase" }}>review in agent →</span>
        </div>
      )}

      {/* #2 — Voice & Feel: the consolidated taste surface (the machinery below stays the AI's) */}
      <VoiceFeelPanel nodes={nodes} index={index} onJump={jumpTo} />

      {/* Tree */}
      <div style={{ paddingTop: 8, paddingBottom: 48 }}>
        {roots.length === 0 ? (
          <div style={{ padding: "16px 0" }}>
            {/* The brief exists on the book even before the tree is seeded — it's the origin everything
                derives from, so let the author read/edit it here and grow the tree from it. */}
            <div style={{ padding: "0 16px 12px", color: "#555", fontSize: 12, fontStyle: "italic", letterSpacing: "0.02em" }}>
              No DNA tree yet. The brief below is the origin — edit it, then seed the tree to start building from it.
            </div>
            <BriefSection brief={brief} onSave={saveBrief} depth={1} />
            <div style={{ padding: "16px 16px 0" }}>
              <button onClick={() => void seedTree()} disabled={seeding} style={{
                background: "#8a8aff14", border: "1px solid #8a8aff66", borderRadius: 5,
                color: "#a8a8ff", fontSize: 10, cursor: seeding ? "default" : "pointer", letterSpacing: "0.1em",
                textTransform: "uppercase", padding: "5px 12px", fontFamily: "ui-monospace, monospace",
              }}>{seeding ? "seeding…" : "✦ seed the tree from this brief"}</button>
            </div>
          </div>
        ) : roots.map((root) => (
          <Subtree key={root.id} node={root} index={index} nodes={nodes} depth={0}
            collapsedSet={collapsedSet} openSet={openSet}
            h={{ onToggle: toggleNode, onToggleDetail: toggleDetail, onAdd: addNode, onDelete: removeNode, onJump: jumpTo, dragId, onDragStart: setDragId, onDragEnd: () => setDragId(null), onDrop: onDropReorder, backlinks, flashId, proposal: proposalView, focusKinds: null, issuesByNode, healthLens, contextId, ctxConsumes, ctxConsumedBy, onContextFocus: focusContext, proseOpenSet, onToggleProse: toggleProse, onDiscardStory: discardStory, brief, onSaveBrief: saveBrief }} />
        ))}
      </div>
    </div>
  );
}
