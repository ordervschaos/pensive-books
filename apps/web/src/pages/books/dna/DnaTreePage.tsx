// DnaTreePage — /books/:slug/dna/tree
// Visual tree of the live book_nodes hierarchy. No app chrome; nav suppressed via ConditionalNav.
// Color-coded by node kind; connector lines via CSS borders; collapsible per-node.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { deleteNode, patchNodeContent, saveNode, saveNodes } from "@/lib/bookNodes";
import { backlinkIndex, byId, childrenOf, emptyNode, isEntityKind, isProseStale, isStale, newId, pillarOf, refsOf, stampInput, stampProse, type BookSettings, type DnaIssue, type DnaNode, type BeatContent, type NodeContent, type NodeKind, type SceneContent } from "@/lib/novelDna";
import { editSpecs, KIND_LEVEL, tasteSpecs, type EditSpec } from "@/lib/dnaSchema";
import { CONTENT_TYPES, SCOPE_BANDS, briefIdea, type Brief } from "@/lib/brief";
import { describeOps, type NodeOp } from "@/lib/dnaChat";
import { AgentRail } from "@/components/book/dna/AgentRail";
import { sendAgentMessage, type AgentProposal } from "@/lib/agentThread";
import { chooseNodeProposal, discardNodeProposals } from "@/lib/dnaProposals";
import { expandNode, proposeGeneration } from "@/lib/dnaExpand";
import { DNA_STAGES, dnaHealth, buildJourney, stageProgress, STAGE_KINDS, type StageKey } from "@/lib/dnaJourney";

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
  act: "#fb923c",   // orange — acts
  beat: "#fbbf24",       // amber — causal units
  scene: "#4ade80",      // green — the leaf scenes
};

const KIND_BG: Record<string, string> = {
  seed: "#1e1a2e", premise: "#1a1a2e", pillar: "#16163a",
  character: "#0c1e2e", relationship: "#0c1e2e", world_fact: "#0c1e2e", location: "#031e1a", tentpole: "#0c1e2e", game: "#0c1e2e",
  thread: "#2a1020",
  act: "#1e1200", beat: "#1e1600", scene: "#001a10",
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
    case "act": return s(c.title) || s(c.goal);
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
// spineX = x of the chevron's CENTER for a node at this depth. Row paddingLeft is depth*20+(depth>0?20:4)
// and the chevron is a 12px span at the start, so its center sits 6px in. Every vertical rail/connector
// hangs off this so the line drops dead-center through the chevron above it.
const spineX = (depth: number) => depth * 20 + (depth > 0 ? 26 : 10);
const detailRowStyle = (depth: number): React.CSSProperties => ({ position: "relative", display: "flex", alignItems: "baseline", gap: 8, paddingLeft: depth * 20 + 20, paddingRight: 12, paddingTop: 1, paddingBottom: 1 });
const labelStyle: React.CSSProperties = { fontFamily: "ui-monospace, monospace", fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "#5c5c5c", width: 92, flexShrink: 0, textAlign: "right" };
// Tree connector lines removed — indentation alone carries the hierarchy. Kept as a no-op so the many
// detail-row call sites (fieldRowStart, OpDiffBlock, etc.) don't all need editing.
const ConnectorTick = (_: { depth: number }) => null;
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
      : spec.type === "number" ? (draft.trim() && !Number.isNaN(parseFloat(draft)) ? parseFloat(draft) : "")
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
  if (spec.type === "number") return typeof raw === "number" ? String(raw) : "";
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

// ── Prose-completion rollup for parent nodes (act / beat) ────────────────────
// A scene's prose is in one of three states: done (has prose, plan unchanged since), stale (prose exists but
// the scene plan moved under it → needs a re-write), or none (no prose yet). A beat rolls up its direct
// scenes; an act rolls up the scenes under all its beats. The badge on the parent makes "what's written /
// half-written / unwritten" legible without expanding the subtree.
type ProseState = "done" | "stale" | "none";
function proseStateOf(scene: DnaNode): ProseState {
  const text = (scene.content as SceneContent).prose?.text?.trim();
  if (!text) return "none";
  return isProseStale(scene) ? "stale" : "done";
}
function descendantScenes(node: DnaNode, nodes: DnaNode[]): DnaNode[] {
  if (node.kind === "beat") return nodes.filter((n) => n.parent_id === node.id && n.kind === "scene");
  if (node.kind === "act") {
    const beats = nodes.filter((n) => n.parent_id === node.id && n.kind === "beat");
    return beats.flatMap((b) => nodes.filter((n) => n.parent_id === b.id && n.kind === "scene"));
  }
  return [];
}
interface ProseRollup { done: number; stale: number; none: number; total: number }
function proseRollup(node: DnaNode, nodes: DnaNode[]): ProseRollup | null {
  if (node.kind !== "act" && node.kind !== "beat") return null;
  const scenes = descendantScenes(node, nodes);
  if (!scenes.length) return null;
  let done = 0, stale = 0, none = 0;
  for (const s of scenes) {
    const st = proseStateOf(s);
    if (st === "done") done++;
    else if (st === "stale") stale++;
    else none++;
  }
  return { done, stale, none, total: scenes.length };
}

// The compact bar + count chip the rollup renders on its parent row. Three-state hue: all-done green,
// nothing-started grey, anything-between amber (in progress). The segmented bar shows the mix at a glance.
const PROSE_DONE = "#4ade80", PROSE_STALE = "#f59e0b", PROSE_NONE = "#3a3a3a";
function ProseRollupBadge({ r }: { r: ProseRollup }) {
  const state = r.done === r.total ? "complete" : r.done === 0 && r.stale === 0 ? "none" : "in progress";
  const color = state === "complete" ? PROSE_DONE : state === "none" ? "#5a5a5a" : PROSE_STALE;
  const title = `prose ${state} — ${r.done} done · ${r.stale} stale · ${r.none} no prose (of ${r.total} scenes)`;
  return (
    <span title={title} style={{ display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
      <span style={{ display: "inline-flex", width: 22, height: 4, borderRadius: 2, overflow: "hidden", background: "#1a1a1a", border: "1px solid #00000040" }}>
        <span style={{ flex: r.done, background: PROSE_DONE }} />
        <span style={{ flex: r.stale, background: PROSE_STALE }} />
        <span style={{ flex: r.none, background: PROSE_NONE }} />
      </span>
      <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 8, letterSpacing: "0.06em", color }}>{r.done}/{r.total}</span>
    </span>
  );
}

// ── Node action kebab — groups less-used per-node actions behind a ⋮ button ──
// items = generic list (AI regen, etc.); onDelete is special (confirm dialog lives in the page handler).
interface KebabItem {
  label: string;
  color?: string;
  onClick: () => void | Promise<void>;
  dividerBefore?: boolean;
}
function NodeKebab({ onDelete, items = [] }: { onDelete?: () => void; items?: KebabItem[] }) {
  const [open, setOpen] = useState(false);
  const [busyIdx, setBusyIdx] = useState<number | null>(null);
  if (!onDelete && !items.length) return null;
  const mono = "ui-monospace, monospace";
  return (
    <span style={{ position: "relative", flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
      <span onClick={() => setOpen((v) => !v)} title="more actions"
        style={{ fontFamily: mono, fontSize: 14, color: open ? "#8a8aaa" : "#3a3a52", cursor: "pointer", padding: "0 3px", lineHeight: 1, userSelect: "none", display: "inline-block" }}>⋮</span>
      {open && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 98 }} onClick={() => setOpen(false)} />
          <div style={{ position: "absolute", right: 0, top: "calc(100% + 4px)", zIndex: 99, background: "#111118", border: "1px solid #2a2a3a", borderRadius: 5, padding: "4px 0", minWidth: 192, boxShadow: "0 4px 16px #00000080" }}>
            {items.map((it, i) => (
              <div key={i}>
                {it.dividerBefore && <div style={{ height: 1, background: "#1e1e2a", margin: "3px 0" }} />}
                <div onClick={async (e) => {
                  e.stopPropagation();
                  if (busyIdx !== null) return;
                  setBusyIdx(i);
                  setOpen(false);
                  try { await it.onClick(); } finally { setBusyIdx(null); }
                }} style={{ fontFamily: mono, fontSize: 11, color: busyIdx === i ? "#555" : (it.color ?? "#9a9aaa"), cursor: busyIdx === i ? "default" : "pointer", padding: "6px 14px", letterSpacing: "0.04em" }}>
                  {busyIdx === i ? "…" : it.label}
                </div>
              </div>
            ))}
            {onDelete && items.length > 0 && <div style={{ height: 1, background: "#1e1e2a", margin: "3px 0" }} />}
            {onDelete && (
              <div onClick={(e) => { e.stopPropagation(); setOpen(false); onDelete(); }}
                style={{ fontFamily: mono, fontSize: 11, color: "#c07070", cursor: "pointer", padding: "6px 14px", letterSpacing: "0.04em" }}>
                🗑 delete node
              </div>
            )}
          </div>
        </>
      )}
    </span>
  );
}

// ── Single tree row ──────────────────────────────────────────────────────────
function TreeRow({ node, index, depth, expandable, open, onToggle, onDelete, kebabItems, draggable, dragging, canDrop, onDragStartRow, onDragEndRow, onDropRow, mark, focus, flash, issues, dimmed, ctx, onContextFocus, prose, headerActions, staleActions, writingProse }: {
  node: DnaNode; index: Map<string, DnaNode>; depth: number;
  expandable: boolean; open: boolean; onToggle: () => void; onDelete?: () => void;
  kebabItems?: KebabItem[]; // regen actions, AI options, etc (all go in the ⋮ menu)
  prose?: ProseRollup | null; // act/beat: rolled-up prose-completion of descendant scenes
  headerActions?: React.ReactNode; // compact action buttons pinned to the header row
  staleActions?: { onApprove: () => Promise<void>; onRegen?: () => Promise<void>; onDiscard: () => Promise<void> };
  writingProse?: boolean; // true while this scene's prose is being streamed
  // #5 — drag-to-reorder among same-kind siblings. draggable = this row has a grip; canDrop = a valid
  // sibling is being dragged over it; dragging = this is the row being dragged.
  draggable?: boolean; dragging?: boolean; canDrop?: boolean;
  onDragStartRow?: () => void; onDragEndRow?: () => void; onDropRow?: (before: boolean) => void;
  mark?: "edit" | "delete"; focus?: boolean; flash?: boolean; // mark = proposed change (#1); focus = rail focus (#2); flash = jump target (#1)
  issues?: DnaIssue[]; dimmed?: boolean; // health-lens (#6): this node's lints + dim-when-clean
  ctx?: "focus" | "consumes" | "consumedBy"; onContextFocus?: () => void; // #7 context-highlight role + the badge trigger
}) {
  const [dropEdge, setDropEdge] = useState<"top" | "bottom" | null>(null);
  const [staleCardPos, setStaleCardPos] = useState<{ top: number; right: number } | null>(null);
  const [staleBusy, setStaleBusy] = useState<string | null>(null);
  const staleChipRef = useRef<HTMLSpanElement>(null);
  const runStale = async (key: string, fn: () => Promise<void>) => {
    setStaleBusy(key);
    try { await fn(); setStaleCardPos(null); }
    catch (e) { alert((e as Error).message); }
    finally { setStaleBusy(null); }
  };
  const openStaleCard = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!staleActions) return;
    const rect = staleChipRef.current?.getBoundingClientRect();
    if (!rect) return;
    setStaleCardPos({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
  };
  useEffect(() => {
    if (!staleCardPos) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setStaleCardPos(null); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [staleCardPos]);
  const suspects = isStale(node, index)
    ? ([node.parent_id ? index.get(node.parent_id) : null, ...refsOf(node).map((id) => index.get(id))].filter((n): n is DnaNode => !!n))
    : [];
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
      {dropEdge && <div style={{ position: "absolute", left: spineX(depth), right: 12, [dropEdge]: 0, height: 2, background: "#8a8aff", zIndex: 2, pointerEvents: "none" }} />}

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

        {/* Header actions — pinned right, before status chips */}
        {headerActions && (
          <span style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}
            onClick={(e) => e.stopPropagation()}>
            {headerActions}
          </span>
        )}

        {/* Status + stale + locked chips */}
        <span style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, marginLeft: "auto" }}>
          {prose && <ProseRollupBadge r={prose} />}
          {hasIssue && <span title={issues!.map((i) => `${i.severity === "error" ? "✕" : "⚠"} ${i.rule}: ${i.message}`).join("\n")}
            style={{ fontSize: 10, lineHeight: 1, color: hasErr ? "#f87171" : "#d0a060", flexShrink: 0 }}>{hasErr ? "▲" : "△"}</span>}
          {markColor && <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 8, textTransform: "uppercase", letterSpacing: "0.12em", color: markColor }}>{mark === "delete" ? "− remove" : "✎ edit"}</span>}
          {stale && (
            <span ref={staleChipRef} onClick={openStaleCard}
              style={{ fontFamily: "ui-monospace, monospace", fontSize: 8, textTransform: "uppercase", letterSpacing: "0.12em", color: "#f59e0b", cursor: staleActions ? "pointer" : "default", userSelect: "none" }}>
              stale
            </span>
          )}
          {/* Stale card — fixed-position popover anchored to the chip */}
          {staleCardPos && staleActions && (
            <>
              <div style={{ position: "fixed", inset: 0, zIndex: 49 }} onClick={() => setStaleCardPos(null)} />
              <div style={{ position: "fixed", top: staleCardPos.top, right: staleCardPos.right, zIndex: 50, width: 280, background: "#0d0d11", border: "1px solid #2a2a38", borderRadius: 8, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10, boxShadow: "0 8px 30px #000000aa", fontFamily: "ui-monospace, monospace" }}
                onClick={(e) => e.stopPropagation()}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 9, letterSpacing: "0.16em", textTransform: "uppercase", color: "#f59e0b" }}>stale</span>
                  <span onClick={() => setStaleCardPos(null)} style={{ fontSize: 11, color: "#555", cursor: "pointer" }}>✕</span>
                </div>
                <span style={{ fontSize: 11, color: "#c8a060", lineHeight: 1.5 }}>
                  {isProseStale(node) && !isStale(node, index)
                    ? "prose stale — the scene plan changed since it was written"
                    : "an input changed since this was generated"}
                </span>
                {suspects.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    <span style={{ fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "#5c5c5c" }}>suspects</span>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {suspects.map((n) => (
                        <span key={n.id} style={{ fontSize: 11, color: "#cfcfcf", background: "#16161c", border: `1px solid ${(KIND_COLOR[n.kind] ?? "#888")}44`, borderRadius: 3, padding: "1px 6px", display: "inline-flex", gap: 4, alignItems: "center" }}>
                          <span style={{ color: KIND_COLOR[n.kind] ?? "#888", fontSize: 9, letterSpacing: "0.06em", textTransform: "uppercase", flexShrink: 0 }}>{n.kind}</span>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 160 }}>{nodeTitle(n) || n.id}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <div style={{ display: "flex", gap: 6 }}>
                  {staleActions.onRegen && (
                    <span onClick={() => !staleBusy && void runStale("regen", staleActions.onRegen!)}
                      style={{ fontSize: 9, letterSpacing: "0.06em", color: staleBusy === "regen" ? "#555" : "#8a8aff", cursor: staleBusy ? "default" : "pointer", border: "1px solid #8a8aff44", borderRadius: 4, padding: "3px 10px", background: "#8a8aff0d" }}>
                      {staleBusy === "regen" ? "…" : "↻ regen"}
                    </span>
                  )}
                  <span onClick={() => !staleBusy && void runStale("approve", staleActions.onApprove)}
                    style={{ fontSize: 9, letterSpacing: "0.06em", color: staleBusy === "approve" ? "#555" : "#6abf6a", cursor: staleBusy ? "default" : "pointer", border: "1px solid #6abf6a44", borderRadius: 4, padding: "3px 10px", background: "#6abf6a0d" }}>
                    {staleBusy === "approve" ? "…" : "✓ accept"}
                  </span>
                </div>
              </div>
            </>
          )}
          {node.authoring.locked && <span style={{ fontSize: 10, color: color }}>🔒</span>}
          {writingProse
            ? <span className="dna-writing-label" style={{ fontFamily: "ui-monospace, monospace", fontSize: 9, letterSpacing: "0.08em", color: "#a8a8ff", flexShrink: 0, whiteSpace: "nowrap" }}>writing…</span>
            : <span style={{
                width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                background: node.authoring.status === "accepted" ? (stale ? "#f59e0b" : "#4ade80")
                  : node.authoring.status === "draft" ? "#fbbf24"
                    : "#444",
              }} title={node.authoring.status ?? "empty"} />
          }
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
          <NodeKebab onDelete={onDelete} items={kebabItems} />
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

// Post-pillar levels that the dna-expand engine can generate, mapped to their expand `target`. The cast &
// world groups, the story acts, the beat sheet, scenes, and prose — every place that previously only had a
// blank AddRow. (location has no engine target; act→beats comes from the pillar-level "beatsheet", not
// per-act — so neither gets a GenerateRow.)
const ENTITY_TARGET: Partial<Record<DnaNode["kind"], string>> = {
  character: "cast", world_fact: "world", relationship: "relationships",
  tentpole: "set-pieces", game: "games", thread: "threads", voice_profile: "voice_profile",
};

// A clickable "✦ generate <label>" affordance — runs the dna-expand engine and STAGES the result as a
// reviewable proposal on the agent thread (phantoms appear in the tree; apply/discard in the rail). The
// engine-quality sibling of AddRow (which inserts ONE blank node). Mirrors SpineLab's discipline: every AI
// action surfaces as a proposal first, never an auto-commit.
function GenerateRow({ label, depth, bookId, node, target, openRail }: {
  label: string; depth: number; bookId: number; node: DnaNode; target: string; openRail: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (busy) return;
    setBusy(true);
    try { await proposeGeneration(bookId, node, target); openRail(); }
    catch (e) { alert(`Generate failed: ${(e as Error).message}`); }
    finally { setBusy(false); }
  };
  return (
    <div style={detailRowStyle(depth)}>
      <ConnectorTick depth={depth} />
      <span style={{ width: 12, flexShrink: 0 }} />
      <span onClick={() => void run()} style={{
        fontFamily: "ui-monospace, monospace", fontSize: 11, letterSpacing: "0.04em",
        color: busy ? "#6a6a9a" : "#a8a8ff", cursor: busy ? "default" : "pointer",
        border: `1px solid ${busy ? "#8a8aff22" : "#8a8aff44"}`, borderRadius: 4, padding: "1px 8px", background: "#8a8aff10",
      }}>{busy ? "generating…" : `✦ ${label}`}</span>
    </div>
  );
}

// Compact inline "✦" (AI generate) and "＋" (manual add) for NodeGroup headers.
// Same affordance as GenerateRow/AddRow but rendered as tiny header chips, not full-width footer rows.
function GroupGenButton({ bookId, node, target, openRail, title }: { bookId: number; node: DnaNode; target: string; openRail: () => void; title?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <span onClick={async (e) => {
      e.stopPropagation();
      if (busy) return;
      setBusy(true);
      try { await proposeGeneration(bookId, node, target); openRail(); }
      catch (err) { alert(`Generate failed: ${(err as Error).message}`); }
      finally { setBusy(false); }
    }} title={title ?? "generate with AI"} style={{ fontFamily: "ui-monospace, monospace", fontSize: 10, letterSpacing: "0.04em", color: busy ? "#555" : "#a8a8ff", cursor: busy ? "default" : "pointer", border: `1px solid ${busy ? "#33333a" : "#8a8aff44"}`, borderRadius: 4, padding: "0px 6px", background: "#8a8aff08", flexShrink: 0 }}>
      {busy ? "…" : "✦"}
    </span>
  );
}
function GroupAddButton({ onAdd, title }: { onAdd: () => void | Promise<void>; title?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <span onClick={async (e) => {
      e.stopPropagation();
      if (busy) return;
      setBusy(true);
      try { await onAdd(); } finally { setBusy(false); }
    }} title={title ?? "add"} style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, color: busy ? "#555" : "#4a7a5a", cursor: busy ? "default" : "pointer", flexShrink: 0, lineHeight: 1 }}>
      {busy ? "…" : "＋"}
    </span>
  );
}

// Scenes in book order: pillar → acts → beats → scenes, each level sorted by position.
function scenesInOrder(nodes: DnaNode[]): DnaNode[] {
  const kids = (pid: string, kind: string) =>
    nodes.filter((n) => n.parent_id === pid && n.kind === kind).sort((a, b) => a.position - b.position);
  const pillar = nodes.find((n) => n.kind === "pillar");
  if (!pillar) return [];
  const out: DnaNode[] = [];
  for (const mov of kids(pillar.id, "act"))
    for (const beat of kids(mov.id, "beat"))
      out.push(...kids(beat.id, "scene"));
  return out;
}

// Which scenes can have prose written right now. Each page's prose is generated FROM the previous page's
// prose, so a scene is only writable once every scene before it (in reading order) is already "done". That
// makes the writable set the unbroken run of done scenes plus the first not-yet-done scene; everything past
// that first gap is blocked until the gap is filled.
function generatableProseIds(nodes: DnaNode[]): Set<string> {
  const out = new Set<string>();
  for (const s of scenesInOrder(nodes)) {
    out.add(s.id);
    if (proseStateOf(s) !== "done") break; // first not-done scene is the last writable one; stop here
  }
  return out;
}

// Beats in book order: pillar → acts → beats, each level sorted by position.
function beatsInOrder(nodes: DnaNode[]): DnaNode[] {
  const kids = (pid: string, kind: string) =>
    nodes.filter((n) => n.parent_id === pid && n.kind === kind).sort((a, b) => a.position - b.position);
  const pillar = nodes.find((n) => n.kind === "pillar");
  if (!pillar) return [];
  const out: DnaNode[] = [];
  for (const mov of kids(pillar.id, "act"))
    out.push(...kids(mov.id, "beat"));
  return out;
}

// Direct-commit prose write for a single scene — no proposal step.
function WriteProseButton({ bookId, node, depth, hasProse }: { bookId: number; node: DnaNode; depth: number; hasProse?: boolean }) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (busy) return;
    setBusy(true);
    try { await expandNode(bookId, node, "prose"); }
    catch (e) { alert(`Write prose failed: ${(e as Error).message}`); }
    finally { setBusy(false); }
  };
  return (
    <div style={detailRowStyle(depth)}>
      <ConnectorTick depth={depth} />
      <span style={{ width: 12, flexShrink: 0 }} />
      <span onClick={() => void run()} style={{
        fontFamily: "ui-monospace, monospace", fontSize: 11, letterSpacing: "0.04em",
        color: busy ? "#6a6a9a" : "#a8a8ff", cursor: busy ? "default" : "pointer",
        border: `1px solid ${busy ? "#8a8aff22" : "#8a8aff44"}`, borderRadius: 4, padding: "1px 8px", background: "#8a8aff10",
      }}>{busy ? "writing…" : hasProse ? "↻ re-write prose" : "✦ write prose"}</span>
    </div>
  );
}

// Sequential prose writer for all prose-less scenes in book order.
function WriteAllProseButton({ bookId, nodes, depth }: { bookId: number; nodes: DnaNode[]; depth: number }) {
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const cancelRef = useRef(false);  // set true to stop the loop at the next boundary
  const abortRef = useRef<AbortController | null>(null); // aborts the in-flight call immediately on stop
  const pending = scenesInOrder(nodes).filter((s) => !(s.content as SceneContent).prose?.text?.trim());
  if (!pending.length && !progress) return null;
  const run = async () => {
    if (progress) { cancelRef.current = true; abortRef.current?.abort(); return; } // a click while running stops now
    const list = scenesInOrder(nodes).filter((s) => !(s.content as SceneContent).prose?.text?.trim());
    if (!list.length) return;
    cancelRef.current = false;
    setProgress({ done: 0, total: list.length });
    // A scene that exhausts callExpand's retries SKIPS rather than aborting the whole batch — one unlucky
    // scene must not strand the other 80. Failures are collected and reported once at the end so the run can
    // be re-clicked to mop them up (it re-derives `pending`, so only the still-prose-less scenes re-run).
    const failures: { scene: number; message: string }[] = [];
    for (let i = 0; i < list.length; i++) {
      if (cancelRef.current) break; // stop at the boundary — the in-flight call (if any) already returned
      abortRef.current = new AbortController();
      try {
        await expandNode(bookId, list[i], "prose", { signal: abortRef.current.signal });
      } catch (e) {
        if (cancelRef.current) break; // intentional stop aborted the in-flight call — exit cleanly
        failures.push({ scene: i + 1, message: (e as Error).message });
      }
      setProgress({ done: i + 1, total: list.length });
    }
    abortRef.current = null;
    setProgress(null);
    if (failures.length && !cancelRef.current) {
      alert(`Wrote ${list.length - failures.length}/${list.length} scenes. ${failures.length} failed (re-click to retry them):\n` +
        failures.slice(0, 8).map((f) => `  scene ${f.scene}: ${f.message}`).join("\n") +
        (failures.length > 8 ? `\n  …and ${failures.length - 8} more` : ""));
    }
  };
  const label = progress
    ? `writing ${progress.done}/${progress.total}… ✕ stop`
    : `✦ write all prose (${pending.length})`;
  return (
    <div style={detailRowStyle(depth)}>
      <ConnectorTick depth={depth} />
      <span style={{ width: 12, flexShrink: 0 }} />
      <span onClick={() => void run()} style={{
        fontFamily: "ui-monospace, monospace", fontSize: 11, letterSpacing: "0.04em",
        color: progress ? "#6a6a9a" : "#a8a8ff", cursor: "pointer",
        border: `1px solid ${progress ? "#8a8aff22" : "#8a8aff44"}`, borderRadius: 4, padding: "1px 8px", background: "#8a8aff10",
      }}>{label}</span>
    </div>
  );
}

// Sequential scene generator: for all beats without scenes, in book order.
function GenerateAllScenesButton({ bookId, nodes, depth }: { bookId: number; nodes: DnaNode[]; depth: number }) {
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const cancelRef = useRef(false);  // set true to stop the loop at the next boundary
  const abortRef = useRef<AbortController | null>(null); // aborts the in-flight call immediately on stop
  const pending = beatsInOrder(nodes).filter((b) => !nodes.some((n) => n.parent_id === b.id && n.kind === "scene"));
  if (!pending.length && !progress) return null;
  const run = async () => {
    if (progress) { cancelRef.current = true; abortRef.current?.abort(); return; } // a click while running stops now
    const list = beatsInOrder(nodes).filter((b) => !nodes.some((n) => n.parent_id === b.id && n.kind === "scene"));
    if (!list.length) return;
    cancelRef.current = false;
    setProgress({ done: 0, total: list.length });
    for (let i = 0; i < list.length; i++) {
      if (cancelRef.current) break; // stop at the boundary — the in-flight call (if any) already returned
      abortRef.current = new AbortController();
      try {
        await expandNode(bookId, list[i], "scenes", { signal: abortRef.current.signal });
        setProgress({ done: i + 1, total: list.length });
      } catch (e) {
        if (cancelRef.current) break; // intentional stop aborted the in-flight call — exit cleanly
        alert(`Generate scenes failed at beat ${i + 1}: ${(e as Error).message}`);
        setProgress(null);
        return;
      }
    }
    abortRef.current = null;
    setProgress(null);
  };
  const label = progress
    ? `generating scenes ${progress.done}/${progress.total}… ✕ stop`
    : `✦ generate all scenes (${pending.length})`;
  return (
    <div style={detailRowStyle(depth)}>
      <ConnectorTick depth={depth} />
      <span style={{ width: 12, flexShrink: 0 }} />
      <span onClick={() => void run()} style={{
        fontFamily: "ui-monospace, monospace", fontSize: 11, letterSpacing: "0.04em",
        color: progress ? "#6a6a9a" : "#a8a8ff", cursor: "pointer",
        border: `1px solid ${progress ? "#8a8aff22" : "#8a8aff44"}`, borderRadius: 4, padding: "1px 8px", background: "#8a8aff10",
      }}>{label}</span>
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
  { level: "prose",  label: "prose only",         detail: "clear written prose — keep scene plans, beats, acts" },
  { level: "scenes", label: "scenes + prose",      detail: "delete all scene nodes — keep beats and acts" },
  { level: "beats",  label: "beats + scenes",      detail: "delete all beat nodes and their scenes — keep acts" },
  { level: "story",  label: "full story",          detail: "delete acts, beats, scenes and all prose — keep foundations" },
];
function DiscardStoryModal({ nodes, onClose }: { nodes: DnaNode[]; onClose: () => void }) {
  const [level, setLevel] = useState<DiscardLevel>("prose");
  const [busy, setBusy] = useState(false);
  const mono = "ui-monospace, monospace";

  const acts = nodes.filter((n) => n.kind === "act");
  const beats     = nodes.filter((n) => n.kind === "beat");
  const scenes    = nodes.filter((n) => n.kind === "scene");

  // Prose-only is selectable per-scene: list scenes that have prose, in reading order, all picked by default.
  const proseScenes = scenesInOrder(nodes).filter((s) => (s.content as SceneContent).prose?.text?.trim());
  const [picked, setPicked] = useState<Set<string>>(() => new Set(proseScenes.map((s) => s.id)));
  const togglePick = (id: string) =>
    setPicked((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const allPicked = proseScenes.length > 0 && picked.size === proseScenes.length;
  const toggleAll = () =>
    setPicked(allPicked ? new Set() : new Set(proseScenes.map((s) => s.id)));

  const counts: Record<DiscardLevel, string> = {
    prose:  `${picked.size} of ${proseScenes.length} scenes selected`,
    scenes: `${scenes.length} scenes`,
    beats:  `${beats.length} beats · ${scenes.length} scenes`,
    story:  `${acts.length} acts · ${beats.length} beats · ${scenes.length} scenes`,
  };

  const run = async () => {
    setBusy(true);
    try {
      if (level === "prose") {
        const withProse = proseScenes.filter((s) => picked.has(s.id));
        await Promise.all(withProse.map((s) => {
          const { prose: _p, ...rest } = s.content as SceneContent;
          return saveNode({ ...s, content: rest as NodeContent });
        }));
      } else if (level === "scenes") {
        await Promise.all(scenes.map((s) => deleteNode(s.id)));
      } else if (level === "beats") {
        await Promise.all(beats.map((b) => deleteNode(b.id)));
      } else {
        await Promise.all(acts.map((m) => deleteNode(m.id)));
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
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ fontFamily: mono, fontSize: 11, color: "#cfcfcf", letterSpacing: "0.04em" }}>{o.label}</div>
                  {o.level === "prose" && level === "prose" && proseScenes.length > 0 && (
                    <span onClick={(e) => { e.preventDefault(); toggleAll(); }}
                      style={{ fontFamily: mono, fontSize: 9, color: "#6a8aa0", cursor: "pointer", letterSpacing: "0.04em" }}>
                      {allPicked ? "select none" : "select all"}
                    </span>
                  )}
                </div>
                <div style={{ fontFamily: mono, fontSize: 10, color: "#555", marginTop: 2 }}>{o.detail}</div>
                {level === o.level && <div style={{ fontFamily: mono, fontSize: 9, color: "#7a3030", marginTop: 4, letterSpacing: "0.04em" }}>{counts[o.level]}</div>}
                {o.level === "prose" && level === "prose" && (
                  proseScenes.length === 0
                    ? <div style={{ fontFamily: mono, fontSize: 10, color: "#555", marginTop: 6 }}>no scenes have prose yet</div>
                    : <div style={{ marginTop: 6, maxHeight: 200, overflowY: "auto", display: "flex", flexDirection: "column", gap: 1, borderTop: "1px solid #22222e", paddingTop: 6 }}>
                        {proseScenes.map((s, i) => {
                          const sel = picked.has(s.id);
                          const words = (s.content as SceneContent).prose?.words ?? 0;
                          return (
                            <label key={s.id} onClick={(e) => { e.preventDefault(); e.stopPropagation(); togglePick(s.id); }}
                              style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 4px", borderRadius: 3, cursor: "pointer", background: sel ? "#1a1414" : "transparent" }}>
                              <input type="checkbox" checked={sel} readOnly style={{ accentColor: "#c06060", flexShrink: 0, pointerEvents: "none" }} />
                              <span style={{ fontFamily: mono, fontSize: 10, color: sel ? "#cf999c" : "#666", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {i + 1}. {nodeTitle(s) || "untitled scene"}
                              </span>
                              <span style={{ fontFamily: mono, fontSize: 9, color: "#555", flexShrink: 0 }}>{words}w</span>
                            </label>
                          );
                        })}
                      </div>
                )}
              </div>
            </label>
          ))}
        </div>
        <div style={{ display: "flex", gap: 16, justifyContent: "flex-end", paddingTop: 4 }}>
          <button onClick={onClose} disabled={busy} style={{ background: "none", border: "none", fontFamily: mono, fontSize: 11, color: "#555", cursor: "pointer", letterSpacing: "0.08em" }}>cancel</button>
          {(() => {
            const disabled = busy || (level === "prose" && picked.size === 0);
            return (
              <button onClick={() => void run()} disabled={disabled} style={{ background: "#3a1515", border: "1px solid #7a3030", borderRadius: 4, fontFamily: mono, fontSize: 11, color: disabled ? "#7a3030" : "#e07070", cursor: disabled ? "default" : "pointer", padding: "4px 14px", letterSpacing: "0.08em", opacity: disabled && !busy ? 0.5 : 1 }}>
                {busy ? "discarding…" : "discard"}
              </button>
            );
          })()}
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

// ── Options / picker (the candidate+judge channel) ───────────────────────────
// The spine rungs (logline/premise/pillar) are where one-shot error compounds hardest (analysis §6.1), so
// the manual generator omits the variety they need. These are the author's selection-pressure surface:
//  • SpineLab — two affordances that drive the ONE agent (every AI call is a chat turn): generate options
//    and ask-the-AI-to-pick. They send a templated message and open the rail; the agent does the work as a
//    visible turn.
//  • ProposalPicker — the agent's propose_options stages 2–4 candidates onto node.proposals; this renders
//    them as before→after cards. Picking commits (chooseProposal) + re-stales descendants; both pick and
//    discard log a turn back to the agent thread (dnaProposals.ts).
const SPINE_KINDS = new Set<string>(["seed", "premise", "pillar"]);
const SPINE_LABEL: Record<string, string> = { seed: "logline", premise: "premise", pillar: "pillar" };
// The next rung down each spine singleton — generation flows DOWN one step at a time, so each node leaves a
// hanging "generate {child}" slot (the spine singletons have no AddRow otherwise; deeper rungs do).
const SPINE_CHILD: Record<string, NodeKind> = { seed: "premise", premise: "pillar" };

function LabButton({ label, busy, onClick }: { label: string; busy: boolean; onClick: () => void }) {
  return (
    <span onClick={() => !busy && onClick()} style={{
      fontFamily: "ui-monospace, monospace", fontSize: 10, letterSpacing: "0.06em",
      color: busy ? "#555" : "#a8a8ff", cursor: busy ? "default" : "pointer",
      border: "1px solid #8a8aff44", borderRadius: 4, padding: "2px 8px", background: "#8a8aff10",
    }}>{busy ? "…" : label}</span>
  );
}

// The AI lab: generate/options · ask the AI to pick. Every button is a turn on the book's ONE agent thread —
// the chat is the agent's surface, so no AI action happens off it. Verbs name the artifact they act on
// (logline / premise / pillar) and adapt to state: an unforged logline (still the raw brief idea) gets a
// single "draft logline"; once a real logline / node exists, you get options.
function SpineLab({ node, depth, bookId, brief, hasChildren, openRail }: {
  node: DnaNode; depth: number; bookId: number; brief: Brief | null; hasChildren: boolean; openRail: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const label = SPINE_LABEL[node.kind] ?? node.kind;       // "logline" | "premise" | "pillar"
  const hasProposals = !!node.proposals?.length;
  const locked = node.authoring.locked;
  // The seed's logline is "unforged" while it's empty or still just the raw brief idea (the provisional copy
  // the seed gets on creation). Until it's forged, the meaningful verb is "draft", not "alternatives".
  const logline = node.kind === "seed" ? String((node.content as Record<string, unknown>).logline ?? "").trim() : "";
  const rawIdea = (briefIdea(brief) ?? "").trim();
  const unforged = node.kind === "seed" && (!logline || logline === rawIdea);
  // Empty (just-added placeholder) vs existing content → generate vs regenerate (the author's pick: a fresh
  // placeholder fills via options; an existing value re-stages a new best-of-N).
  const emptyContent = Object.keys((node.content ?? {}) as Record<string, unknown>).length === 0;
  const forgeable = node.kind === "seed" ? unforged : emptyContent; // not yet a real value to vary/sharpen

  const send = async (key: string, message: string) => {
    setBusy(key);
    try { await sendAgentMessage(bookId, message); openRail(); }
    catch (e) { alert(`Couldn't reach the agent: ${(e as Error).message}`); }
    finally { setBusy(null); }
  };
  const draftLoglineMsg = `Forge the LOGLINE for node [${node.id}] from the brief idea: one or two sentences naming the protagonist, the inciting incident, the primary goal, the main obstacle, and the stakes — sharpen the raw idea into a real logline (don't restate it). Propose it as a propose_node_ops edit to the logline field. Don't ask first — just propose it.`;
  // Bounded divergence: options must HONOR the parent (the ladder's one law — a child elaborates what's above
  // it, it never rewrites it). Name what's FIXED per rung so the agent varies only the open axis, instead of
  // reshaping the seed into different books.
  const constraint =
    node.kind === "seed"
      ? `Every option must be a faithful, SHARPER read of the SAME brief idea above — same story, not a different one; vary the framing, emphasis, and which angle leads.`
      : node.kind === "premise"
        ? `HARD CONSTRAINT — treat the logline above as LOCKED: every option must serve that SAME logline, keeping its protagonist, inciting incident, central goal, main obstacle, and stakes FIXED. Vary ONLY the dramatic question and the 5-part shape (how it's structured/interpreted). Do NOT alter any story element the logline already established — never reshape it into a different book.`
        : `HARD CONSTRAINT — treat the logline + premise above as LOCKED: every option must serve them. Vary ONLY the controlling idea and the ending; do NOT alter the established premise or story.`;
  const optionsMsg = `Draft 3 alternative ${label}s for node [${node.id}] and stage them with propose_options. ${constraint} Make them meaningfully different from EACH OTHER along the allowed axis, never near-duplicates. Honor the brief MANDATE (genre, heat, tone) verbatim. Don't ask first — just propose the options.`;
  const pickMsg = `Of the pending options on node [${node.id}], which is strongest for the brief and the book? Recommend ONE by its option number with a one-line reason — I'll commit the pick in the tree.`;
  return (
    <div style={{ ...detailRowStyle(depth), paddingTop: 4, paddingBottom: 4 }} onClick={(e) => e.stopPropagation()}>
      <ConnectorTick depth={depth} />
      <span style={{ width: 12, flexShrink: 0 }} />
      <span style={{ ...labelStyle, color: "#6a6a9a" }}>ai lab</span>
      <span style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {locked ? <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 10, color: "#444" }}>🔒 unlock to generate</span> : (
          <>
            {node.kind === "seed" && unforged
              ? <LabButton label="✦ derive logline from brief" busy={busy === "draft"} onClick={() => void send("draft", draftLoglineMsg)} />
              : <LabButton
                  label={node.kind === "seed" ? "↻ logline options" : emptyContent ? `✦ generate ${label} options` : `↻ regenerate ${label} options`}
                  busy={busy === "options"} onClick={() => void send("options", optionsMsg)} />}
            {hasProposals && <LabButton label="⚖ ask AI to pick" busy={busy === "pick"} onClick={() => void send("pick", pickMsg)} />}
          </>
        )}
      </span>
    </div>
  );
}

// The picker: render each staged option as a before→after card (reusing describeOps, like the proposal
// overlay). "use this" commits it; "discard all" clears. Both register a turn on the agent thread.
function ProposalPicker({ node, nodes, depth }: { node: DnaNode; nodes: DnaNode[]; depth: number }) {
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

// ── Recursive tree subtree ───────────────────────────────────────────────────
// ── Compact header action buttons — inline versions for the node header row ──
// These replace the full-width body versions; the same action, just smaller and at the top.

function HeaderWriteProseButton({ bookId, node, generatable, onOpenReader, onBusyChange }: {
  bookId: number; node: DnaNode; generatable: boolean; onOpenReader?: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const hasProse = !!(node.content as SceneContent).prose?.text?.trim();
  // Reading existing prose is always fine. Writing/re-writing is not: each page is generated FROM the
  // previous page's prose, so a scene whose earlier scenes aren't finished can't be written yet.
  const canRead = hasProse && !!onOpenReader;
  const blocked = !canRead && !generatable;
  const run = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (canRead) { onOpenReader!(); return; }
    if (busy || blocked) return;
    setBusy(true);
    onBusyChange?.(true);
    try { await expandNode(bookId, node, "prose"); }
    catch (err) { alert(`Write prose failed: ${(err as Error).message}`); }
    finally { setBusy(false); onBusyChange?.(false); }
  };
  return (
    <span onClick={(e) => void run(e)}
      title={blocked ? "finish the earlier scenes first — each page is written from the previous page's prose" : hasProse ? "read prose" : "write prose"}
      style={{
        fontFamily: "ui-monospace, monospace", fontSize: 10, letterSpacing: "0.04em",
        color: blocked ? "#3a3a44" : busy ? "#555" : "#a8a8ff",
        cursor: blocked ? "not-allowed" : busy ? "default" : "pointer",
        border: `1px solid ${blocked ? "#26262e" : busy ? "#33333a" : "#8a8aff44"}`,
        borderRadius: 4, padding: "0px 7px", background: blocked ? "#8a8aff04" : "#8a8aff08",
        flexShrink: 0, opacity: blocked ? 0.5 : 1,
      }}>
      {busy ? "…" : hasProse ? "read" : "✦ prose"}
    </span>
  );
}

function HeaderGenerateButton({ label, bookId, node, target, openRail }: {
  label: string; bookId: number; node: DnaNode; target: string; openRail: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const run = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try { await proposeGeneration(bookId, node, target); openRail(); }
    catch (err) { alert(`Generate failed: ${(err as Error).message}`); }
    finally { setBusy(false); }
  };
  return (
    <span onClick={(e) => void run(e)} title={label}
      style={{
        fontFamily: "ui-monospace, monospace", fontSize: 10, letterSpacing: "0.04em",
        color: busy ? "#555" : "#a8a8ff", cursor: busy ? "default" : "pointer",
        border: `1px solid ${busy ? "#33333a" : "#8a8aff44"}`,
        borderRadius: 4, padding: "0px 7px", background: "#8a8aff08", flexShrink: 0,
      }}>
      {busy ? "…" : label}
    </span>
  );
}



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
  proseGeneratable: Set<string>;        // scene ids whose prose can be written now (predecessors finished)
  proseOpenSet: Set<string>;            // scene ids whose prose block is expanded
  onToggleProse: (id: string) => void;
  writingProseIds: Set<string>;         // scene ids currently having prose streamed
  onProseWriting: (id: string, busy: boolean) => void;
  onDiscardStory: () => void;
  brief: Brief | null;                  // seed: the book's mandate (saved to books.brief)
  onSaveBrief: (patch: Partial<Brief>) => Promise<void>;
  bookId: number;                       // options/eval lab → drives the agent thread
  openRail: () => void;                 // surface the agent rail when a lab action fires a turn
  onAttachNode: (id: string) => void;   // slice 2 — attach this node to the agent's context tray (anchors)
  onOpenProseReader: (sceneId: string) => void; // open the prose reader modal for a scene
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
  // The AI lab (spine nodes only — where one-shot error compounds) + the options picker (any node with staged
  // candidates). Both render after this node's own fields, before its children. The picker shows even when the
  // lab doesn't (e.g. proposals on a non-spine node), and vice-versa.
  // SpineLab AI actions moved to the kebab (↻ regenerate X options). ProposalPicker stays in body (it's content).
  const lab = open && node.proposals?.length
    ? <ProposalPicker node={node} nodes={nodes} depth={depth + 1} />
    : null;
  // The hanging "generate the next rung →" slot for the spine singletons (seed→premise→pillar) — shown once
  // THIS node has real content and its single child rung is still empty. Adds an empty child placeholder
  // (its own options lab then fills it). Deeper rungs (pillar→acts, act→beats) already have AddRows.
  const spineChildKind = SPINE_CHILD[node.kind];
  const nodeEmpty = Object.keys((node.content ?? {}) as Record<string, unknown>).length === 0;
  const spineChildRow = open && spineChildKind && !nodeEmpty && !kids.some((k) => k.kind === spineChildKind)
    ? <AddRow label={`generate ${spineChildKind} →`} depth={depth + 1} onAdd={() => h.onAdd(node.id, spineChildKind)} />
    : null;

  // Header actions — primary / first-time generate only. Manual adds and regenerate go to the kebab.
  const hasChildScenes = node.kind === "beat" && kids.some((k) => k.kind === "scene");
  const headerActions: React.ReactNode =
    node.kind === "scene" ? <HeaderWriteProseButton bookId={h.bookId} node={node} generatable={h.proseGeneratable.has(node.id)} onOpenReader={() => h.onOpenProseReader(node.id)} onBusyChange={(busy) => h.onProseWriting(node.id, busy)} />
    : node.kind === "beat" && !hasChildScenes ? <HeaderGenerateButton label="✦ scenes" bookId={h.bookId} node={node} target="scenes" openRail={h.openRail} />
    : null;

  // Kebab items — regenerate actions, manual adds, AI options.
  const kebabItems: KebabItem[] = [];
  // Attach this node to the agent's context tray (slice 2) — on every node; the agent always sees the
  // whole book, this just anchors where it looks (the @-mention model). Detach from the chip in the rail.
  kebabItems.push({ label: "＋ add to agent context", color: "#a8a8ff", onClick: () => h.onAttachNode(node.id) });
  // Act: add a beat manually
  if (node.kind === "act") {
    kebabItems.push({ label: "+ add beat", color: "#4a7a5a", onClick: () => h.onAdd(node.id, "beat") });
  }
  // Scene with prose → offer to regenerate it
  if (node.kind === "scene") {
    const hasProse = !!(node.content as SceneContent).prose?.text?.trim();
    if (hasProse) {
      kebabItems.push({ label: "↻ regenerate prose", color: "#8a8aaa", onClick: () => { void expandNode(h.bookId, node, "prose"); } });
    }
  }
  // Beat with scenes → regenerate scenes (first-time is the header button; this is the redo)
  if (node.kind === "beat" && hasChildScenes) {
    kebabItems.push({ label: "↻ regenerate scenes", color: "#8a8aaa", onClick: async () => { await proposeGeneration(h.bookId, node, "scenes"); h.openRail(); } });
  }
  // Spine nodes → AI lab actions (derive / options / pick) — SpineLab is no longer shown inline
  if (SPINE_KINDS.has(node.kind) && !node.authoring.locked) {
    const spineLabel = SPINE_LABEL[node.kind] ?? node.kind;
    const logline = node.kind === "seed" ? String((node.content as Record<string, unknown>).logline ?? "").trim() : "";
    const rawIdea = (briefIdea(h.brief) ?? "").trim();
    const unforged = node.kind === "seed" && (!logline || logline === rawIdea);
    const emptyContent = Object.keys((node.content ?? {}) as Record<string, unknown>).length === 0;
    const constraint =
      node.kind === "seed"
        ? `Every option must be a faithful, SHARPER read of the SAME brief idea above — same story, not a different one; vary the framing, emphasis, and which angle leads.`
        : node.kind === "premise"
          ? `HARD CONSTRAINT — treat the logline above as LOCKED: every option must serve that SAME logline, keeping its protagonist, inciting incident, central goal, main obstacle, and stakes FIXED. Vary ONLY the dramatic question and the 5-part shape. Do NOT alter any story element the logline already established.`
          : `HARD CONSTRAINT — treat the logline + premise above as LOCKED: every option must serve them. Vary ONLY the controlling idea and the ending; do NOT alter the established premise or story.`;
    const draftLoglineMsg = `Forge the LOGLINE for node [${node.id}] from the brief idea: one or two sentences naming the protagonist, the inciting incident, the primary goal, the main obstacle, and the stakes — sharpen the raw idea into a real logline (don't restate it). Propose it as a propose_node_ops edit to the logline field. Don't ask first — just propose it.`;
    const optionsMsg = `Draft 3 alternative ${spineLabel}s for node [${node.id}] and stage them with propose_options. ${constraint} Make them meaningfully different from EACH OTHER along the allowed axis, never near-duplicates. Honor the brief MANDATE (genre, heat, tone) verbatim. Don't ask first — just propose the options.`;
    const pickMsg = `Of the pending options on node [${node.id}], which is strongest for the brief and the book? Recommend ONE by its option number with a one-line reason — I'll commit the pick in the tree.`;
    if (node.kind === "seed" && unforged) {
      kebabItems.push({ label: "✦ derive logline from brief", color: "#a8a8ff", onClick: async () => { await sendAgentMessage(h.bookId, draftLoglineMsg); h.openRail(); } });
    } else {
      kebabItems.push({ label: emptyContent ? `✦ generate ${spineLabel} options` : `↻ regenerate ${spineLabel} options`, color: "#a8a8ff", onClick: async () => { await sendAgentMessage(h.bookId, optionsMsg); h.openRail(); } });
    }
    if (node.proposals?.length) {
      kebabItems.push({ label: "⚖ ask AI to pick", color: "#a8a8ff", onClick: async () => { await sendAgentMessage(h.bookId, pickMsg); h.openRail(); } });
    }
  }

  // The pillar splits into STORY (the spine) + CAST & WORLD (the registry, sub-grouped by kind); a act
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
          {lab}
          {/* Foundations (cast & world) first — the materials — then the spine built from them. */}
          <NodeGroup groupId={`${node.id}::world`} label="cast & world" hint="the registry"
            count={entities.length} depth={depth + 1} collapsedSet={collapsedSet} onToggle={h.onToggle} alwaysShow>
            {ENTITY_GROUPS.map(({ kind, label }) => {
              const items = entities.filter((e) => e.kind === kind);
              const target = ENTITY_TARGET[kind];
              return (
                <NodeGroup key={kind} groupId={`${node.id}::world::${kind}`} label={label}
                  count={items.length} depth={depth + 2} collapsedSet={collapsedSet} onToggle={h.onToggle} alwaysShow
                  action={
                    <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      {target && <GroupGenButton bookId={h.bookId} node={node} target={target} openRail={h.openRail} title={`generate ${label}`} />}
                      <GroupAddButton onAdd={() => h.onAdd(node.id, kind)} title={`add ${kind}`} />
                    </span>
                  }
                  footer={phantoms(node.id, kind, depth + 3)}>
                  {sub(items, depth + 3)}
                </NodeGroup>
              );
            })}
          </NodeGroup>
          <NodeGroup groupId={`${node.id}::story`} label="story" hint="the spine — acts in order"
            count={ladder.length} depth={depth + 1} collapsedSet={collapsedSet} onToggle={h.onToggle} alwaysShow
            footer={<>
              {phantoms(node.id, "act", depth + 2)}
              <GenerateRow label="generate acts" depth={depth + 2} bookId={h.bookId} node={node} target="acts" openRail={h.openRail} />
              {/* The beat sheet is generated globally off the pillar (across all acts), not per-act — show it only once acts exist. */}
              {ladder.some((c) => c.kind === "act") && <GenerateRow label="generate beat sheet" depth={depth + 2} bookId={h.bookId} node={node} target="beatsheet" openRail={h.openRail} />}
              <GenerateAllScenesButton bookId={h.bookId} nodes={nodes} depth={depth + 2} />
              <WriteAllProseButton bookId={h.bookId} nodes={nodes} depth={depth + 2} />
              <AddRow label="act" depth={depth + 2} onAdd={() => h.onAdd(node.id, "act")} />
            </>}
            action={ladder.length > 0 ? (
              <span onClick={() => h.onDiscardStory()}
                title="Delete all acts, beats, scenes and prose"
                style={{ fontFamily: "ui-monospace, monospace", fontSize: 8, letterSpacing: "0.1em", textTransform: "uppercase", color: "#7a3030", cursor: "pointer" }}>
                discard ✕
              </span>
            ) : undefined}>
            {sub(ladder, depth + 2)}
          </NodeGroup>
        </>
      );
    } else if (node.kind === "seed") {
      // The seed IS the LOGLINE node — the first DERIVED artifact (protagonist · inciting · goal · obstacle ·
      // stakes). Show that labeled field first, then the lab that forges/refines it, then the BRIEF (the
      // constant, book-level origin it derives FROM — not a tree rung), then the premise child.
      body = (
        <>
          {fields}
          <div style={{ ...detailRowStyle(depth + 1), paddingTop: 0, paddingBottom: 2 }}>
            <ConnectorTick depth={depth + 1} />
            <span style={{ width: 12, flexShrink: 0 }} />
            <span style={{ ...labelStyle, color: "transparent" }}>·</span>
            <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 10, color: "#555", fontStyle: "italic" }}>
              the logline — derived from the brief (the origin) above; ≠ the raw idea. Refine it with the lab.
            </span>
          </div>
          {backlinks}
          {lab}
          {sub(kids, depth + 1)}
          {spineChildRow}
        </>
      );
    } else {
      // childAdd only used for phantoms now (beat→scene, act→beat); add/generate moved to header.
      const childAdd = node.kind === "beat" ? "scene" : null;
      body = (
        <>
          {fields}
          {backlinks}
          {lab}
          {node.kind === "scene" && (
            <ProseBlock node={node} depth={depth + 1} open={h.proseOpenSet.has(node.id)} onToggle={() => h.onToggleProse(node.id)} />
          )}
          {sub(kids, depth + 1)}
          {spineChildRow}
          {childAdd && phantoms(node.id, childAdd, depth + 1)}
        </>
      );
    }
  }

  // Delete is allowed on addable kinds (not the seed/premise/pillar singletons) when unlocked.
  const deletable = !node.authoring.locked && (isEntityKind(node.kind) || ["act", "beat", "scene"].includes(node.kind));
  // #5 — drag-to-reorder among same-kind siblings (entities by kind under the pillar; act/beat/scene by
  // parent). A row is a drop target only while a SIBLING (same parent + kind) is being dragged.
  const reorderable = isEntityKind(node.kind) || ["act", "beat", "scene"].includes(node.kind);
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

  // Stale actions — approve/regen/discard for any stale node.
  const nodeStale = isStale(node, index);
  const proseStale = node.kind === "scene" && isProseStale(node);
  const anyStale = nodeStale || proseStale;
  const staleActions = anyStale ? {
    onApprove: async () => {
      let n = node;
      if (nodeStale) n = stampInput(n, index);
      if (proseStale) n = stampProse(n);
      await saveNode(n);
    },
    onRegen: node.kind === "scene" && (proseStale || nodeStale)
      ? async () => { await expandNode(h.bookId, node, "prose"); }
      : undefined,
    onDiscard: async () => {
      if (proseStale && !nodeStale) {
        const sc = node.content as SceneContent;
        await saveNode({ ...node, content: { ...sc, prose: undefined }, authoring: { ...node.authoring, prose_src_hash: undefined } });
      } else {
        await saveNode({ ...node, authoring: { ...node.authoring, src_hash: undefined, prose_src_hash: undefined } });
      }
    },
  } : undefined;

  return (
    <div>
      <TreeRow node={node} index={index} depth={depth} expandable={expandable} open={open} onToggle={toggle}
        onDelete={deletable ? () => h.onDelete(node) : undefined}
        kebabItems={kebabItems.length ? kebabItems : undefined}
        draggable={reorderable} dragging={h.dragId === node.id} canDrop={canDrop}
        onDragStartRow={() => h.onDragStart(node.id)} onDragEndRow={h.onDragEnd}
        onDropRow={(before) => h.onDrop(node, before)}
        mark={mark} focus={focus} flash={h.flashId === node.id} issues={issues} dimmed={dimmed}
        ctx={ctx} onContextFocus={() => h.onContextFocus(node.id)} prose={proseRollup(node, nodes)}
        headerActions={headerActions} staleActions={staleActions}
        writingProse={h.writingProseIds.has(node.id)} />
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
        <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase", color: "#5a5a7a" }}>brief — mandate · the constant origin</span>
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

// ── Brief origin (step 0) ─────────────────────────────────────────────────────
// The brief is the ORIGIN — book-level input on books.brief, NOT a tree node. The seed (= the logline) is
// step 1, DERIVED from it (docs/dna-studio-analysis.md §1). So the brief renders here, ABOVE the tree, with a
// "↓ derives" cue — not nested inside the seed (which wrongly read as the brief being a detail OF the logline).
// Empty tree → the seed button lives here too (seeding derives the first node from this origin).
function BriefOrigin({ brief, onSave, seeded, onSeed, seeding }: {
  brief: Brief | null; onSave: (patch: Partial<Brief>) => Promise<void>; seeded: boolean; onSeed: () => void; seeding: boolean;
}) {
  const mono = "ui-monospace, monospace";
  return (
    <div style={{ borderBottom: "1px solid #1a1a1a", background: "#0b0b0f", paddingBottom: 8 }}>
      <BriefSection brief={brief} onSave={onSave} depth={1} />
      {seeded ? (
        <div style={{ padding: "8px 16px 2px 20px", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: "#a78bfa", fontSize: 13, lineHeight: 1 }}>↓</span>
          <span style={{ fontFamily: mono, fontSize: 10, color: "#6a6a8a", fontStyle: "italic" }}>
            derives the SEED below — a polished logline (protagonist · inciting · goal · obstacle · stakes), generated from this brief
          </span>
        </div>
      ) : (
        <div style={{ padding: "12px 16px 4px" }}>
          <div style={{ padding: "0 0 10px", color: "#555", fontSize: 12, fontStyle: "italic", letterSpacing: "0.02em" }}>
            No DNA tree yet — this brief is the origin. Edit it, then seed to derive the logline (the first node) from it.
          </div>
          <button onClick={onSeed} disabled={seeding} style={{
            background: "#8a8aff14", border: "1px solid #8a8aff66", borderRadius: 5,
            color: "#a8a8ff", fontSize: 10, cursor: seeding ? "default" : "pointer", letterSpacing: "0.1em",
            textTransform: "uppercase", padding: "5px 12px", fontFamily: mono,
          }}>{seeding ? "seeding…" : "✦ seed the tree — derive the logline from this brief"}</button>
        </div>
      )}
    </div>
  );
}

// ── Voice & Feel panel (#2 — taste lives here) ────────────────────────────────
// Aim 2: TASTE is user-owned and subjective (premise tone, pillar controlling idea, the whole voice profile,
// each character's idiolect) but it's scattered across four tree depths, so it reads as "more work than
// writing." This pins every `taste` field (tagged in dnaSchema, the SSOT) into ONE surface at the top of the
// tree. The MACHINERY (state keys, thread roles, grounds_in — the genOnly fields) is the AI's to maintain
// and stays hidden from the editor entirely. Reuses EditableField so edits flow through the same save path,
// and each group title jumps to the full node in the tree below.
// `asPage` renders it as the body of its own /dna/tree/taste tab (always open, no collapse chrome) instead of
// pinned atop the tree — keeps the taste fields from interleaving with the structural tree.
function VoiceFeelPanel({ nodes, index, onJump, asPage }: { nodes: DnaNode[]; index: Map<string, DnaNode>; onJump: (id: string) => void; asPage?: boolean }) {
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
  if (!groups.length) {
    return asPage ? (
      <div style={{ padding: "24px 16px", fontFamily: "ui-monospace, monospace", fontSize: 11, color: "#444" }}>
        no taste fields yet — they appear once the premise, pillar, voice profile, or characters exist.
      </div>
    ) : null;
  }
  const mono = "ui-monospace, monospace";
  const expanded = asPage || open;
  return (
    <div style={asPage ? { background: "#0c0c10" } : { borderBottom: "1px solid #1a1a1a", background: "#0c0c10" }}>
      <div onClick={asPage ? undefined : () => setOpen((v) => !v)} style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "9px 16px", cursor: asPage ? "default" : "pointer" }}>
        {!asPage && <span style={{ width: 12, color: "#7dd3fc", fontSize: 9 }}>{open ? "▼" : "▶"}</span>}
        <span style={{ fontFamily: mono, fontSize: 10, letterSpacing: "0.2em", textTransform: "uppercase", color: "#9bd3e6" }}>voice & feel</span>
        <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: "0.06em", color: "#3a4a52" }}>taste lives here — tone · idea · voice · idiolect</span>
      </div>
      {expanded && (
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

// ── Journey strip — "where am I / what's left" ────────────────────────────────
// The studio's strength the flat tree lacks: a sense of PLACE. The DNA rungs are grouped into 5 ordered
// stages (Idea→Foundations→Structure→Scenes→Prose); buildJourney derives each stage's done|now|locked from
// the tree, and stageSubsteps names the single next action inside the "now" stage. Clicking a stage reveals
// + scrolls to its layer (STAGE_KINDS). Pure-derived — no stored progress.
function JourneyStrip({ nodes, mode, onGoStage }: {
  nodes: DnaNode[]; mode: "prose" | "picture"; onGoStage: (key: StageKey) => void;
}) {
  const mono = "ui-monospace, monospace";
  const { stages } = buildJourney(nodes, mode);
  const prog = stageProgress(nodes, mode);
  // The open gaps, in spine order — the literal "what's left" ("18 beats need scenes · 29 scenes need prose").
  const gaps = DNA_STAGES.map((s) => prog[s.key].gapLabel).filter((g): g is string => !!g);
  // A stage's hue: done = green, partial = amber (started-not-finished), now = accent, locked = faint.
  const hue = (status: string, partial: boolean) =>
    status === "done" ? "#4ade80" : partial ? "#f59e0b" : status === "now" ? "#a8a8ff" : status === "locked" ? "#3a3a3a" : "#666";
  const glyph = (status: string, partial: boolean) =>
    status === "done" ? "✓" : partial ? "◑" : status === "now" ? "◉" : status === "locked" ? "·" : "○";

  return (
    <div style={{ padding: "8px 16px", borderBottom: "1px solid #111", display: "flex", flexDirection: "column", gap: 6 }}>
      {/* The 5 stages — each with its coverage fraction + a progress bar */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 4, flexWrap: "wrap" }}>
        {stages.map((s, i) => {
          const p = prog[s.key];
          const locked = s.status === "locked";
          const c = hue(s.status, p.partial);
          return (
            <span key={s.key} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <span onClick={locked ? undefined : () => onGoStage(s.key)} title={`${s.caption}\n\n${p.label}`}
                style={{
                  display: "inline-flex", flexDirection: "column", gap: 3, cursor: locked ? "default" : "pointer",
                  padding: "3px 9px", borderRadius: 5, minWidth: 72,
                  background: s.status === "now" ? "#8a8aff14" : "transparent",
                  border: `1px solid ${s.status === "now" ? "#8a8aff44" : "transparent"}`,
                }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <span style={{ fontFamily: mono, fontSize: 9, color: c, width: 8, textAlign: "center" }}>{glyph(s.status, p.partial)}</span>
                  <span style={{ fontFamily: mono, fontSize: 9, color: "#444", fontVariantNumeric: "tabular-nums" }}>{s.num}</span>
                  <span style={{ fontFamily: mono, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: c }}>{s.label}</span>
                  {p.total > 0 && (
                    <span style={{ fontFamily: mono, fontSize: 9, color: c, fontVariantNumeric: "tabular-nums", marginLeft: 2 }}>{p.done}/{p.total}</span>
                  )}
                </span>
                {/* coverage bar */}
                <span style={{ height: 3, background: "#1c1c1c", borderRadius: 2, overflow: "hidden" }}>
                  <span style={{ display: "block", height: "100%", width: `${Math.round(p.ratio * 100)}%`, background: c, transition: "width 0.3s" }} />
                </span>
              </span>
              {i < stages.length - 1 && <span style={{ color: "#262626", fontSize: 10, alignSelf: "center" }}>→</span>}
            </span>
          );
        })}
      </div>
      {/* What's left — the open gaps in plain words, in spine order */}
      {gaps.length > 0 && (
        <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
          <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: "#5c5c5c" }}>what's left</span>
          <span style={{ fontFamily: mono, fontSize: 10, color: "#9a7a4a" }}>{gaps.join("  ·  ")}</span>
        </div>
      )}
    </div>
  );
}

// ── Focus readout (#7) — "what controls this" ────────────────────────────────
// The badge-click context-focus already LIGHTS the ref-neighborhood in the tree (green = built from,
// blue = draws on it). But those rows scatter across a long tree, and the highlight is ref-graph only.
// This gathers the same focus into one fixed readout AND adds the three the in-tree hue omits: up-spine
// LINEAGE (the rungs it was hydrated from — inputHash uses the direct parent's content), LOCKS (pinned
// intent on it or above it), and STALENESS (an input moved since it was generated, with the suspects).
// Pure-derived; reuses the consumes/consumedBy sets the page already computes + refsOf/isStale.
function FocusPanel({ node, index, consumes, consumedBy, onJump, onClear, bottomInset = 16, staleActions }: {
  node: DnaNode; index: Map<string, DnaNode>;
  consumes: Set<string>; consumedBy: Set<string>;
  onJump: (id: string) => void; onClear: () => void; bottomInset?: number;
  staleActions?: { onApprove: () => Promise<void>; onRegen?: () => Promise<void>; onDiscard: () => Promise<void> };
}) {
  const mono = "ui-monospace, monospace";
  const [panelStaleBusy, setPanelStaleBusy] = useState<string | null>(null);
  const runPanelStale = async (key: string, fn: () => Promise<void>) => {
    setPanelStaleBusy(key);
    try { await fn(); }
    catch (e) { alert((e as Error).message); }
    finally { setPanelStaleBusy(null); }
  };
  // Up-spine lineage: walk parent_id to the root (root-first). The DIRECT parent is the rung this node
  // was generated from (inputHash hashes parent content), so we flag it as the source.
  const ancestors: DnaNode[] = [];
  for (let cur = node.parent_id ? index.get(node.parent_id) : undefined; cur; cur = cur.parent_id ? index.get(cur.parent_id) : undefined) ancestors.unshift(cur);
  const parent = node.parent_id ? index.get(node.parent_id) : undefined;
  const lockedAncestors = ancestors.filter((a) => a.authoring.locked);
  const consumesNodes = [...consumes].map((id) => index.get(id)).filter((n): n is DnaNode => !!n);
  const consumedByNodes = [...consumedBy].map((id) => index.get(id)).filter((n): n is DnaNode => !!n);
  const stale = isStale(node, index);
  const proseStale = node.kind === "scene" && isProseStale(node);
  // The candidate sources of staleness — the same input set inputHash() hashes: parent + referenced entities.
  const inputs = [parent, ...refsOf(node).map((id) => index.get(id))].filter((n): n is DnaNode => !!n);

  const Chip = ({ n, hue }: { n: DnaNode; hue?: string }) => (
    <span onClick={() => onJump(n.id)} title="jump to node"
      style={{ fontFamily: mono, fontSize: 11, color: "#cfcfcf", background: "#16161c", border: `1px solid ${hue ? `${hue}55` : "#24242e"}`, borderRadius: 3, padding: "1px 5px", display: "inline-flex", gap: 4, alignItems: "center", cursor: "pointer", maxWidth: 280 }}>
      <span style={{ color: hue ?? (KIND_COLOR[n.kind] ?? "#888"), fontSize: 9, letterSpacing: "0.06em", textTransform: "uppercase", flexShrink: 0 }}>{n.kind}</span>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nodeTitle(n) || n.id}</span>
      {n.authoring.locked && <span style={{ flexShrink: 0 }}>🔒</span>}
    </span>
  );
  const Section = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: "#5c5c5c" }}>
        {label}{hint ? <span style={{ color: "#3a3a3a", letterSpacing: "0.06em" }}> · {hint}</span> : null}
      </span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>{children}</div>
    </div>
  );
  const dash = <span style={{ fontFamily: mono, fontSize: 11, color: "#333" }}>—</span>;

  return (
    <div style={{
      position: "fixed", bottom: bottomInset, left: 16, zIndex: 15, width: 320, maxHeight: "62vh", overflowY: "auto",
      background: "#0d0d11", border: "1px solid #2a2a38", borderRadius: 8, padding: "12px 14px",
      display: "flex", flexDirection: "column", gap: 12, boxShadow: "0 8px 30px #000000aa",
    }}>
      {/* Header — the focused node + clear */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: "0.16em", textTransform: "uppercase", color: KIND_COLOR[node.kind] ?? "#888", flexShrink: 0 }}>{node.kind}</span>
        <span style={{ fontFamily: mono, fontSize: 12, color: "#e6e6e6", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nodeTitle(node) || node.id}</span>
        <span onClick={onClear} title="clear focus (esc)" style={{ fontSize: 12, color: "#555", cursor: "pointer", flexShrink: 0 }}>✕</span>
      </div>

      {/* Lineage ↑ — the rungs above; direct parent = the source it was hydrated from */}
      <Section label="lineage ↑" hint="hydrated from">
        {ancestors.length ? ancestors.map((a, i) => (
          <span key={a.id} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <Chip n={a} hue={a.id === parent?.id ? "#cfcfcf" : undefined} />
            {i < ancestors.length - 1 && <span style={{ color: "#3a3a3a", fontSize: 11 }}>›</span>}
          </span>
        )) : dash}
      </Section>

      {/* Built from ↑ (green) — the refs it consumes */}
      <Section label="built from" hint="refs ↑">
        {consumesNodes.length ? consumesNodes.map((n) => <Chip key={n.id} n={n} hue="#60a070" />) : dash}
      </Section>

      {/* Draws on it ↓ (blue) — the blast radius: what breaks if this changes */}
      <Section label="draws on it" hint={consumedByNodes.length ? `${consumedByNodes.length} downstream` : undefined}>
        {consumedByNodes.length ? consumedByNodes.map((n) => <Chip key={n.id} n={n} hue="#6a8aff" />) : dash}
      </Section>

      {/* Locks 🔒 — pinned intent on this node or above it */}
      <Section label="locks 🔒">
        {node.authoring.locked && <span style={{ fontFamily: mono, fontSize: 11, color: "#cfcfcf" }}>this node</span>}
        {lockedAncestors.map((a) => <Chip key={a.id} n={a} />)}
        {!node.authoring.locked && !lockedAncestors.length && <span style={{ fontFamily: mono, fontSize: 11, color: "#555" }}>none — free to regenerate</span>}
      </Section>

      {/* Freshness ⚠ — stale iff an input moved since this was generated */}
      <Section label="freshness">
        {stale || proseStale ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontFamily: mono, fontSize: 11, color: "#f59e0b" }}>
              ⚠ {proseStale && !stale ? "prose stale — the scene plan changed since it was written" : "stale — an input changed since this was generated"}
            </span>
            {stale && inputs.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
                <span style={{ fontFamily: mono, fontSize: 9, color: "#5c5c5c", letterSpacing: "0.06em" }}>suspects:</span>
                {inputs.map((n) => <Chip key={n.id} n={n} />)}
              </div>
            )}
            {staleActions && (
              <div style={{ display: "flex", gap: 6 }}>
                {staleActions.onRegen && (
                  <span onClick={() => !panelStaleBusy && void runPanelStale("regen", staleActions.onRegen!)}
                    style={{ fontFamily: mono, fontSize: 9, letterSpacing: "0.06em", color: panelStaleBusy === "regen" ? "#555" : "#8a8aff", cursor: panelStaleBusy ? "default" : "pointer", border: "1px solid #8a8aff44", borderRadius: 4, padding: "2px 8px", background: "#8a8aff0d" }}>
                    {panelStaleBusy === "regen" ? "…" : "↻ regen"}
                  </span>
                )}
                <span onClick={() => !panelStaleBusy && void runPanelStale("approve", staleActions.onApprove)}
                  style={{ fontFamily: mono, fontSize: 9, letterSpacing: "0.06em", color: panelStaleBusy === "approve" ? "#555" : "#6abf6a", cursor: panelStaleBusy ? "default" : "pointer", border: "1px solid #6abf6a44", borderRadius: 4, padding: "2px 8px", background: "#6abf6a0d" }}>
                  {panelStaleBusy === "approve" ? "…" : "✓ accept"}
                </span>
              </div>
            )}
          </div>
        ) : (
          <span style={{ fontFamily: mono, fontSize: 11, color: node.authoring.src_hash ? "#4ade80" : "#555" }}>
            {node.authoring.src_hash ? "✓ fresh — in sync with its inputs" : "not generated yet"}
          </span>
        )}
      </Section>
    </div>
  );
}

// A small accent action used inside the timeline — runs an async generate and shows a busy state.
function GenAction({ label, title, onRun, size = "sm" }: { label: string; title?: string; onRun: () => Promise<void>; size?: "sm" | "xs" }) {
  const [busy, setBusy] = useState(false);
  const run = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try { await onRun(); } catch (err) { alert(`Generate failed: ${(err as Error).message}`); }
    finally { setBusy(false); }
  };
  return (
    <span onClick={run} title={title} style={{
      fontFamily: "ui-monospace, monospace", fontSize: size === "xs" ? 8 : 9, letterSpacing: "0.06em",
      color: busy ? "#6a6a9a" : "#a8a8ff", cursor: busy ? "default" : "pointer", whiteSpace: "nowrap",
      border: `1px solid ${busy ? "#8a8aff22" : "#8a8aff44"}`, borderRadius: 4, padding: size === "xs" ? "0px 5px" : "1px 7px", background: "#8a8aff10",
    }}>{busy ? "…" : `✦ ${label}`}</span>
  );
}

// A view-toggle chip for the fixed quick bar — lit in its accent when active.
function QuickToggle({ active, accent, label, icon, onClick }: { active: boolean; accent: string; label: string; icon: string; onClick: () => void }) {
  return (
    <button onClick={onClick} title={label} style={{
      display: "flex", alignItems: "center", gap: 5, cursor: "pointer",
      background: active ? `${accent}22` : "transparent", border: `1px solid ${active ? `${accent}66` : "transparent"}`,
      borderRadius: 6, padding: "3px 9px", fontFamily: "ui-monospace, monospace", fontSize: 10,
      letterSpacing: "0.08em", textTransform: "uppercase", color: active ? accent : "#888",
    }}>
      <span style={{ fontSize: 11, lineHeight: 1 }}>{icon}</span>
      <span>{label}</span>
    </button>
  );
}

// ── Spine timeline — the SERIAL structure (reading order) ─────────────────────
// The tree shows HIERARCHY (grouped, collapsible); this shows the SPINE as it's actually experienced —
// acts left→right, beats ordered within each, scenes ordered within each. A filmstrip of the story's
// flow + completion: each scene cell is colored by whether its prose is written / stale / still just planned,
// so "where the draft actually stands" reads in one glance. Clicking any unit jumps to it in the tree.
function SpineTimeline({ nodes, mode, rightInset, bookId, onJump, onClose }: {
  nodes: DnaNode[]; mode: "prose" | "picture"; rightInset: number; bookId: number;
  onJump: (id: string) => void; onClose: () => void;
}) {
  const mono = "ui-monospace, monospace";
  const kids = (pid: string, kind: NodeKind) => nodes.filter((n) => n.parent_id === pid && n.kind === kind).sort((a, b) => a.position - b.position);
  const pillar = nodes.find((n) => n.kind === "pillar");
  const movs = pillar ? kids(pillar.id, "act") : [];
  // Acts are EXPANDED by default (working detail visible). We track the COLLAPSED ones, so empty = all open
  // and a newly generated act also starts expanded. Collapse one to get the at-a-glance pip overview.
  const [collapsedActs, setCollapsedActs] = useState<Set<string>>(new Set());
  const toggleAct = (id: string) => setCollapsedActs((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allExpanded = collapsedActs.size === 0;
  const toggleAll = () => setCollapsedActs(allExpanded ? new Set(movs.map((m) => m.id)) : new Set());

  // Generate verbs, mirroring the tree's expand targets (pillar→acts, act→beats, beat→scenes, scene→prose).
  // Direct commit (like the tree's bulk buttons); Realtime refreshes the strip. Prose loops the beat's
  // unwritten scenes in order.
  const genActs = () => expandNode(bookId, pillar!, "acts").then(() => undefined);
  const genBeats = (mov: DnaNode) => expandNode(bookId, mov, "beats").then(() => undefined);
  const genScenes = (beat: DnaNode) => expandNode(bookId, beat, "scenes").then(() => undefined);
  const writeBeatProse = async (beat: DnaNode) => {
    const pending = kids(beat.id, "scene").filter((s) => sceneState(s) === "planned");
    for (const s of pending) await expandNode(bookId, s, "prose");
  };

  const sceneWritten = (s: DnaNode) => {
    const c = s.content as SceneContent;
    return mode === "picture" ? !!c.image_url?.trim() : !!c.prose?.text?.trim();
  };
  // Scene cell is always SCENE-green-outlined (it IS a scene); the FILL is the completion signal: hollow =
  // planned, solid green = prose written. Stale (written-but-out-of-date) is the amber exception.
  const sceneState = (s: DnaNode): "planned" | "written" | "stale" =>
    !sceneWritten(s) ? "planned" : (mode !== "picture" && isProseStale(s)) ? "stale" : "written";

  const roman = (n: number) => ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"][n] ?? String(n + 1);
  const beatGlyphOf = (b: DnaNode) => {
    const c = (b.content as BeatContent).connector;
    return c === "therefore" ? "∴" : c === "but" ? "↯" : "";
  };

  return (
    <div style={{
      position: "fixed", left: 0, right: rightInset, bottom: 0, zIndex: 16,
      background: "#0b0b0f", borderTop: "1px solid #20202c", maxHeight: 300, display: "flex", flexDirection: "column",
      boxShadow: "0 -8px 30px #00000088",
    }}>
      {/* Header — title + nesting key + scene-state legend + close */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "9px 16px", borderBottom: "1px solid #16161c", flexWrap: "wrap" }}>
        <span style={{ fontFamily: mono, fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase", color: "#cfcfcf" }}>Spine · reading order</span>
        {/* nesting key — what contains what */}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: mono, fontSize: 10 }}>
          <span style={{ color: KIND_COLOR.act, letterSpacing: "0.08em", textTransform: "uppercase" }}>act</span>
          <span style={{ color: "#444" }}>▸</span>
          <span style={{ color: KIND_COLOR.beat, letterSpacing: "0.08em", textTransform: "uppercase" }}>beat</span>
          <span style={{ color: "#444" }}>▸</span>
          <span style={{ color: KIND_COLOR.scene, letterSpacing: "0.08em", textTransform: "uppercase" }}>scene</span>
        </span>
        <span style={{ width: 1, height: 14, background: "#222" }} />
        {/* scene-state legend — hollow green = planned · solid green = written · amber = stale */}
        <span style={{ display: "flex", gap: 12 }}>
          {([
            ["planned", { background: "transparent", border: `1.5px solid ${KIND_COLOR.scene}` }],
            ["written", { background: KIND_COLOR.scene, border: `1.5px solid ${KIND_COLOR.scene}` }],
            ["stale", { background: "#f59e0b", border: "1.5px solid #f59e0b" }],
          ] as const).map(([l, swatch]) => (
            <span key={l} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 12, height: 14, borderRadius: 3, ...swatch }} />
              <span style={{ fontFamily: mono, fontSize: 10, color: "#777", letterSpacing: "0.06em", textTransform: "uppercase" }}>{l}</span>
            </span>
          ))}
        </span>
        {movs.length > 0 && (
          <span onClick={toggleAll} style={{ marginLeft: "auto", fontFamily: mono, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "#666", cursor: "pointer" }}>
            {allExpanded ? "collapse all" : "expand all"}
          </span>
        )}
        <span onClick={onClose} title="close timeline" style={{ marginLeft: movs.length > 0 ? 0 : "auto", fontSize: 15, color: "#666", cursor: "pointer", lineHeight: 1 }}>✕</span>
      </div>

      {/* The filmstrip — acts left→right, each holding its beats, each beat holding its scenes */}
      <div style={{ display: "flex", gap: 10, padding: "12px 16px", overflowX: "auto", alignItems: "flex-start" }}>
        {!movs.length && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontFamily: mono, fontSize: 12, color: "#444" }}>no acts yet</span>
            {pillar && <GenAction label="generate acts" title="generate the act structure from the pillar" onRun={genActs} />}
          </span>
        )}
        {movs.map((mov, mi) => {
          const beats = kids(mov.id, "beat");
          const allScenes = beats.flatMap((b) => kids(b.id, "scene"));
          const written = allScenes.filter(sceneWritten).length;
          const expanded = !collapsedActs.has(mov.id);
          return (
            <div key={mov.id} style={{ display: "flex", flexDirection: "column", gap: 7, border: `1px solid ${KIND_COLOR.act}33`, borderRadius: 8, padding: "8px 10px", background: "#0e0e14", flexShrink: 0 }}>
              {/* ACT header — the Act pill jumps to it in the tree; expand/collapse is the chevron bottom-right */}
              <div style={{ display: "flex", alignItems: "center", gap: 7, maxWidth: expanded ? 360 : 320, minWidth: 190 }}>
                <span onClick={() => onJump(mov.id)} title={`open act in tree`} style={{ fontFamily: mono, fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: "#0a0a0a", background: KIND_COLOR.act, padding: "1px 6px", borderRadius: 4, flexShrink: 0, cursor: "pointer" }}>Act {roman(mi)}</span>
                <span style={{ fontFamily: mono, fontSize: 11, color: "#dcdcdc", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nodeTitle(mov) || ""}</span>
                <span style={{ fontFamily: mono, fontSize: 9, color: "#666", flexShrink: 0, marginLeft: "auto", paddingLeft: 6 }}>{written}/{allScenes.length}</span>
              </div>

              {/* COLLAPSED — at-a-glance: scene pips grouped by beat (gaps mark beat boundaries) */}
              {!expanded && (
                <div style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap", maxWidth: 340, minHeight: 14 }}>
                  {!beats.length && (pillar
                    ? <GenAction size="xs" label="generate beats" title="generate this act's beats" onRun={() => genBeats(mov)} />
                    : <span style={{ fontFamily: mono, fontSize: 9, color: "#3a3a3a", fontStyle: "italic" }}>no beats</span>)}
                  {beats.map((beat, bi) => {
                    const sc = kids(beat.id, "scene");
                    return (
                      <div key={beat.id} onClick={(e) => { e.stopPropagation(); onJump(beat.id); }} title={`beat ${bi + 1} — ${nodeTitle(beat)}`}
                        style={{ display: "flex", gap: 2, cursor: "pointer" }}>
                        {!sc.length && <span title="no scenes yet" style={{ width: 7, height: 12, borderRadius: 2, border: `1px dashed ${KIND_COLOR.beat}88` }} />}
                        {sc.map((s) => {
                          const st = sceneState(s);
                          const edge = st === "stale" ? "#f59e0b" : KIND_COLOR.scene;
                          return <span key={s.id} style={{ width: 7, height: 12, borderRadius: 2, background: st !== "planned" ? edge : "transparent", border: `1px solid ${edge}` }} />;
                        })}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* EXPANDED — full BEATS row */}
              {expanded && (
              <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
                {!beats.length && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 10px", border: "1px dashed #24242e", borderRadius: 6 }}>
                    <span style={{ fontFamily: mono, fontSize: 10, color: "#3a3a3a", fontStyle: "italic" }}>no beats</span>
                    <GenAction label="generate beats" title="generate this act's beats" onRun={() => genBeats(mov)} />
                  </span>
                )}
                {beats.map((beat, bi) => {
                  const scenes = kids(beat.id, "scene");
                  return (
                    <div key={beat.id} style={{ display: "flex", flexDirection: "column", gap: 6, border: `1px solid ${KIND_COLOR.beat}33`, borderRadius: 6, padding: "6px 7px", background: "#13130c", width: 122 }}>
                      {/* BEAT header */}
                      <div onClick={() => onJump(beat.id)} title={`beat ${bi + 1} — ${nodeTitle(beat)}`} style={{ display: "flex", flexDirection: "column", gap: 3, cursor: "pointer" }}>
                        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <span style={{ fontFamily: mono, fontSize: 8, letterSpacing: "0.1em", textTransform: "uppercase", color: KIND_COLOR.beat, border: `1px solid ${KIND_COLOR.beat}55`, borderRadius: 3, padding: "0px 4px" }}>B{bi + 1}</span>
                          {beatGlyphOf(beat) && <span style={{ color: KIND_COLOR.beat, fontSize: 10 }}>{beatGlyphOf(beat)}</span>}
                          <span style={{ fontFamily: mono, fontSize: 8, color: "#4a4a4a", marginLeft: "auto" }}>{scenes.length || ""}</span>
                        </span>
                        <span style={{ fontFamily: mono, fontSize: 9.5, color: "#aeaeae", lineHeight: 1.35, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{nodeTitle(beat) || "—"}</span>
                      </div>
                      {/* SCENES — numbered cells + the generate/write action for this beat */}
                      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                        <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                          {scenes.map((sc, si) => {
                            const state = sceneState(sc);
                            // Always green outline (it IS a scene). Filled green = prose written; hollow = planned;
                            // amber = stale. Number ink flips to dark on a filled cell for contrast.
                            const edge = state === "stale" ? "#f59e0b" : KIND_COLOR.scene;
                            const filled = state !== "planned";
                            return (
                              <span key={sc.id} onClick={() => onJump(sc.id)} title={`scene ${si + 1} — ${nodeTitle(sc) || "untitled"} · ${state}`}
                                style={{ width: 20, height: 22, borderRadius: 4, background: filled ? edge : "transparent", border: `1.5px solid ${edge}`, color: filled ? "#0a1a0e" : KIND_COLOR.scene, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: mono, fontSize: 10, fontWeight: 700, cursor: "pointer" }}>
                                {si + 1}
                              </span>
                            );
                          })}
                        </div>
                        {/* beat-scoped action: no scenes → generate; planned scenes → write their prose */}
                        {(() => {
                          if (!scenes.length) return <GenAction size="xs" label="scenes" title="generate this beat's scenes" onRun={() => genScenes(beat)} />;
                          const planned = scenes.filter((s) => sceneState(s) === "planned").length;
                          if (planned > 0) return <GenAction size="xs" label={`write prose (${planned})`} title="write prose for this beat's planned scenes" onRun={() => writeBeatProse(beat)} />;
                          return null;
                        })()}
                      </div>
                    </div>
                  );
                })}
              </div>
              )}

              {/* Expand/collapse — bottom-right chevron: ▾ points down to "more", ▴ folds it back up */}
              {beats.length > 0 && (
                <div onClick={() => toggleAct(mov.id)} title={expanded ? "collapse act" : "expand act — beats & scenes"}
                  onMouseEnter={(e) => { e.currentTarget.style.color = KIND_COLOR.act; e.currentTarget.style.background = `${KIND_COLOR.act}14`; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = `${KIND_COLOR.act}aa`; e.currentTarget.style.background = "transparent"; }}
                  style={{ alignSelf: "flex-end", display: "flex", alignItems: "center", gap: 4, cursor: "pointer", color: `${KIND_COLOR.act}aa`, borderRadius: 5, padding: "1px 7px", marginTop: 1 }}>
                  <span style={{ fontFamily: mono, fontSize: 8, letterSpacing: "0.12em", textTransform: "uppercase" }}>{expanded ? "less" : `${beats.length} beats`}</span>
                  <span style={{ fontSize: 11, lineHeight: 1 }}>{expanded ? "▴" : "▾"}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Prose reader ─────────────────────────────────────────────────────────────
// A focused reading view for a scene's written prose, with prev/next navigation
// through all scenes that have prose (in reading order).
function ProseReaderModal({ sceneId, nodes, bookId: _bookId, onClose }: {
  sceneId: string; nodes: DnaNode[]; bookId: number; onClose: () => void;
}) {
  const mono = "ui-monospace, monospace";
  const [currentId, setCurrentId] = useState(sceneId);
  const written = scenesInOrder(nodes).filter((s) => (s.content as SceneContent).prose?.text?.trim());
  const idx = written.findIndex((s) => s.id === currentId);
  // The opened scene may have no prose yet (e.g. opened from its header before writing);
  // fall back to showing it standalone so the reader still renders something sensible.
  const scene = idx >= 0 ? written[idx] : byId(nodes)[currentId];
  const prose = scene ? (scene.content as SceneContent).prose : undefined;
  const text = prose?.text?.trim() ?? "";
  const paragraphs = text ? text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean) : [];
  const prev = idx > 0 ? written[idx - 1] : null;
  const next = idx >= 0 && idx < written.length - 1 ? written[idx + 1] : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 60, display: "flex", alignItems: "stretch", justifyContent: "center", padding: "32px 24px" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ position: "absolute", inset: 0, background: "#000000c8" }} />
      <div style={{ position: "relative", background: "#0e0e12", border: "1px solid #2a2a38", borderRadius: 8, width: "min(720px, 100%)", display: "flex", flexDirection: "column", maxHeight: "100%", overflow: "hidden" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, padding: "16px 28px", borderBottom: "1px solid #1c1c26", flexShrink: 0 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: mono, fontSize: 9, letterSpacing: "0.2em", textTransform: "uppercase", color: "#5a6a80" }}>
              prose reader{idx >= 0 ? ` · ${idx + 1} / ${written.length}` : ""}
            </div>
            <div style={{ fontFamily: mono, fontSize: 13, color: "#cfcfcf", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {scene ? (nodeTitle(scene) || "untitled scene") : "scene not found"}
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontFamily: mono, fontSize: 16, color: "#666", cursor: "pointer", lineHeight: 1, flexShrink: 0 }}>✕</button>
        </div>
        {/* Body */}
        <div style={{ overflowY: "auto", padding: "32px 28px 40px", flex: 1 }}>
          {paragraphs.length > 0 ? (
            <div style={{ maxWidth: 640, margin: "0 auto", display: "flex", flexDirection: "column", gap: "1.1em" }}>
              {paragraphs.map((p, i) => (
                <p key={i} style={{ margin: 0, fontFamily: "Georgia, 'Times New Roman', serif", fontSize: 17, lineHeight: 1.7, color: "#d8d8dc" }}>{p}</p>
              ))}
            </div>
          ) : (
            <div style={{ fontFamily: mono, fontSize: 12, color: "#666", textAlign: "center", marginTop: 40 }}>no prose written for this scene yet</div>
          )}
        </div>
        {/* Footer nav */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 28px", borderTop: "1px solid #1c1c26", flexShrink: 0 }}>
          <button onClick={() => prev && setCurrentId(prev.id)} disabled={!prev}
            style={{ background: "none", border: "none", fontFamily: mono, fontSize: 11, color: prev ? "#8a9ab0" : "#333", cursor: prev ? "pointer" : "default", letterSpacing: "0.06em" }}>← prev</button>
          <span style={{ fontFamily: mono, fontSize: 10, color: "#555" }}>{prose?.words ? `${prose.words}w` : ""}</span>
          <button onClick={() => next && setCurrentId(next.id)} disabled={!next}
            style={{ background: "none", border: "none", fontFamily: mono, fontSize: 11, color: next ? "#8a9ab0" : "#333", cursor: next ? "pointer" : "default", letterSpacing: "0.06em" }}>next →</button>
        </div>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function DnaTreePage() {
  const { bookSlug } = useParams();
  const bookId = getNumericId(bookSlug);
  // Two views share this page (one route, splat-matched so switching doesn't remount): the structural tree and
  // the "voice & feel" taste surface. Keeping taste on its own /dna/tree/taste tab stops its fields from
  // interleaving with the tree structure.
  const location = useLocation();
  const navigate = useNavigate();
  const tab: "tree" | "taste" = location.pathname.endsWith("/taste") ? "taste" : "tree";
  const treePath = `/books/${bookSlug}/dna/tree`;

  const [bookName, setBookName] = useState<string>("");
  const [settings, setSettings] = useState<BookSettings>({});
  const [nodes, setNodes] = useState<DnaNode[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collapsedSet, setCollapsedSet] = useState<Set<string>>(new Set());
  const [openSet, setOpenSet] = useState<Set<string>>(new Set()); // detail-only leaves the user dug into
  // The reviser rail's open/closed state persists across tab switches (no remount) AND reloads (localStorage,
  // per book) — the chat thread itself lives server-side in book_agent_runs, this just remembers the rail.
  const railKey = `dna-rail-open:${bookId}`;
  const [railOpen, setRailOpen] = useState<boolean>(() => localStorage.getItem(railKey) === "1");
  useEffect(() => { localStorage.setItem(railKey, railOpen ? "1" : "0"); }, [railKey, railOpen]);
  // Slice 2 (docs/agent-context-model.md): the agent's context tray — DNA node ids the author attached as
  // anchors (Cursor's @-file model). Persisted per book; the agent always sees the whole book, these just
  // bias where it looks. Attach from a node's kebab; detach from the chip in the rail. Opening the rail on
  // attach makes the new context visible immediately.
  const attachKey = `agent-attached:${bookId}`;
  const [attachedIds, setAttachedIds] = useState<string[]>(() => {
    try { const v = localStorage.getItem(attachKey); return v ? (JSON.parse(v) as string[]) : []; } catch { return []; }
  });
  useEffect(() => { try { localStorage.setItem(attachKey, JSON.stringify(attachedIds)); } catch { /* ignore */ } }, [attachKey, attachedIds]);
  const attachNode = useCallback((id: string) => { setAttachedIds((ids) => (ids.includes(id) ? ids : [...ids, id])); setRailOpen(true); }, []);
  const detachNode = useCallback((id: string) => setAttachedIds((ids) => ids.filter((x) => x !== id)), []);
  // #1 — pending proposals from the agent thread (book_agent_runs), mirrored so the tree can overlay them.
  const [agentProposals, setAgentProposals] = useState<AgentProposal[]>([]);
  const [showIssues, setShowIssues] = useState(false); // drill into the lints behind the score
  // The serial spine filmstrip (bottom) — persists across reloads, per book (mirrors railOpen above).
  const timelineKey = `dna-timeline-open:${bookId}`;
  const [timelineOpen, setTimelineOpen] = useState<boolean>(() => localStorage.getItem(timelineKey) === "1");
  useEffect(() => { localStorage.setItem(timelineKey, timelineOpen ? "1" : "0"); }, [timelineKey, timelineOpen]);
  const [healthLens, setHealthLens] = useState(false); // #6 — dim clean nodes; surface only the broken ones
  const [contextId, setContextId] = useState<string | null>(null); // #7 — the node whose ref-neighborhood is lit
  const [flashId, setFlashId] = useState<string | null>(null); // #1 — the node a jump just revealed
  const [dragId, setDragId] = useState<string | null>(null); // #5 — the node being dragged
  const [brief, setBrief] = useState<Brief | null>(null);
  const [proseOpenSet, setProseOpenSet] = useState<Set<string>>(new Set());
  const [writingProseIds, setWritingProseIds] = useState<Set<string>>(new Set());
  const onProseWriting = useCallback((id: string, busy: boolean) => {
    setWritingProseIds((prev) => { const next = new Set(prev); busy ? next.add(id) : next.delete(id); return next; });
  }, []);
  const [proseReaderSceneId, setProseReaderSceneId] = useState<string | null>(null); // prose reader modal
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
    // idea ≠ logline (docs/dna-studio-analysis.md §0/§1): the raw idea is NOT the logline. We only seed the
    // logline from the idea when it's still EMPTY (a provisional starting point), and never overwrite a
    // logline that already exists — once the author drafts/refines one (the "draft logline" verb generates a
    // real protagonist/inciting/goal/obstacle/stakes logline via dna-expand), editing the idea won't clobber
    // it. Journey gating / studio / overview read seed.content.logline, so the empty-seed case still fills.
    if ("idea" in patch && nodes) {
      const seed = nodes.find((n) => n.kind === "seed");
      const existing = (seed?.content as { logline?: string } | undefined)?.logline?.trim();
      if (seed && !existing) await patchNodeContent(seed, { logline: (patch.idea ?? "").trim() } as NodeContent);
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
  const proseGeneratable = useMemo(() => generatableProseIds(nodes ?? []), [nodes]); // scenes writable now (forward prose dependency)

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
  // Journey strip — clicking a stage reveals its whole layer (so nothing's collapsed-and-hidden) and
  // scrolls to the first node of that layer in position order.
  const goStage = useCallback((key: StageKey) => {
    const kinds = STAGE_KINDS[key];
    const matches = nodes.filter((n) => kinds.includes(n.kind));
    if (!matches.length) return;
    revealNodes(matches.map((n) => n.id));
    const target = matches.slice().sort((a, b) => a.position - b.position)[0];
    jumpTo(target.id);
  }, [nodes, revealNodes, jumpTo]);
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
      {/* Fixed quick-toggle bar — always-on access to the main view modes (clears the rail when it's open) */}
      <div style={{
        position: "fixed", top: 8, right: railOpen ? 432 : 14, zIndex: 25, display: "flex", gap: 3,
        background: "#0d0d12e6", border: "1px solid #20202c", borderRadius: 9, padding: "4px 5px",
        boxShadow: "0 4px 18px #00000088", backdropFilter: "blur(6px)",
      }}>
        {tab === "tree" && <QuickToggle active={timelineOpen} accent="#fb923c" icon="▦" label="Timeline" onClick={() => setTimelineOpen((v) => !v)} />}
        <QuickToggle active={railOpen} accent="#8a8aff" icon="✦" label="Editor" onClick={() => setRailOpen((v) => !v)} />
        {tab === "tree" && (health.errors + health.warns) > 0 && (
          <QuickToggle active={healthLens} accent="#d0a060" icon="◐" label="Lens"
            onClick={() => { const on = !healthLens; setHealthLens(on); if (on) revealNodes(health.issues.map((i) => i.nodeId).filter((x): x is string => !!x)); }} />
        )}
      </div>
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
            <AgentRail bookId={bookId} nodes={nodes} settings={settings} attachedIds={attachedIds} onDetach={detachNode} />
          </div>
        </div>
      )}
      {/* #7 — the focus readout: "what controls this" for the badge-clicked node (bottom-left, clears of the rail) */}
      {tab === "tree" && ctxNode && (() => {
        const ctxNodeStale = isStale(ctxNode, index);
        const ctxProseStale = ctxNode.kind === "scene" && isProseStale(ctxNode);
        const ctxAnyStale = ctxNodeStale || ctxProseStale;
        const ctxStaleActions = ctxAnyStale ? {
          onApprove: async () => {
            let n = ctxNode;
            if (ctxNodeStale) n = stampInput(n, index);
            if (ctxProseStale) n = stampProse(n);
            await saveNode(n);
          },
          onRegen: ctxNode.kind === "scene" && (ctxProseStale || ctxNodeStale)
            ? async () => { await expandNode(bookId, ctxNode, "prose"); }
            : undefined,
          onDiscard: async () => {
            if (ctxProseStale && !ctxNodeStale) {
              const sc = ctxNode.content as SceneContent;
              await saveNode({ ...ctxNode, content: { ...sc, prose: undefined }, authoring: { ...ctxNode.authoring, prose_src_hash: undefined } });
            } else {
              await saveNode({ ...ctxNode, authoring: { ...ctxNode.authoring, src_hash: undefined, prose_src_hash: undefined } });
            }
          },
        } : undefined;
        return (
          <FocusPanel node={ctxNode} index={index} consumes={ctxConsumes} consumedBy={ctxConsumedBy}
            onJump={jumpTo} onClear={() => setContextId(null)} bottomInset={timelineOpen ? 212 : 16}
            staleActions={ctxStaleActions} />
        );
      })()}
      {/* The serial spine — reading-order filmstrip across the bottom (acts → beats → scenes) */}
      {tab === "tree" && timelineOpen && (
        <SpineTimeline nodes={nodes} mode={settings.mode ?? "prose"} rightInset={railOpen ? 420 : 0} bookId={bookId}
          onJump={jumpTo} onClose={() => setTimelineOpen(false)} />
      )}
      {/* Header bar */}
      <div style={{ padding: "12px 16px", borderBottom: "1px solid #1a1a1a", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <span style={{ color: "#666", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase" }}>
          {bookName || bookSlug} · dna
        </span>
        {/* Tab strip — tree (structure) vs voice & feel (taste). Same component, splat route, no remount. */}
        <div style={{ display: "flex", gap: 4 }}>
          {([["tree", "tree", treePath], ["taste", "voice & feel", `${treePath}/taste`]] as const).map(([key, label, to]) => (
            <button key={key} onClick={() => navigate(to)} style={{
              background: tab === key ? "#9bd3e618" : "none", border: `1px solid ${tab === key ? "#9bd3e655" : "transparent"}`,
              borderRadius: 5, color: tab === key ? "#9bd3e6" : "#555", fontSize: 10, cursor: "pointer",
              letterSpacing: "0.1em", textTransform: "uppercase", padding: "3px 10px", fontFamily: "ui-monospace, monospace",
            }}>{label}</button>
          ))}
        </div>
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
          {tab === "tree" && <button onClick={expandAll} style={{ background: "none", border: "none", color: "#555", fontSize: 10, cursor: "pointer", letterSpacing: "0.1em", textTransform: "uppercase" }}>expand all</button>}
          {tab === "tree" && <button onClick={collapseAll} style={{ background: "none", border: "none", color: "#555", fontSize: 10, cursor: "pointer", letterSpacing: "0.1em", textTransform: "uppercase" }}>collapse all</button>}
          <a href={`/books/${bookSlug}/dna.json`} style={{ color: "#555", fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", textDecoration: "none" }}>json →</a>
          <a href={`/books/${bookSlug}/dna`} style={{ color: "#555", fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", textDecoration: "none" }}>studio →</a>
          <button onClick={() => void forkDna()} disabled={forking} title="Copy this DNA tree into a new book to experiment freely"
            style={{ background: "none", border: "none", color: forking ? "#444" : "#555", fontSize: 10, cursor: forking ? "default" : "pointer", letterSpacing: "0.1em", textTransform: "uppercase" }}>
            {forking ? "forking…" : "fork →"}
          </button>
          {/* Timeline + Editor toggles moved to the fixed quick bar (top-right) */}
        </div>
      </div>

      {/* ── voice & feel tab: the taste surface on its own, off the structural tree ── */}
      {tab === "taste" && (
        <VoiceFeelPanel nodes={nodes} index={index} asPage onJump={(id) => { navigate(treePath); jumpTo(id); }} />
      )}

      {/* ── tree tab: journey → legend → lints → proposals → brief → the structural tree ── */}
      {tab === "tree" && (<>
      {/* Journey strip — where am I / what's left (studio's strength, brought onto the tree) */}
      {roots.length > 0 && <JourneyStrip nodes={nodes} mode={settings.mode ?? "prose"} onGoStage={goStage} />}
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

      {/* The BRIEF — the ORIGIN (step 0), above the tree. The seed (logline) below is derived from it. */}
      <BriefOrigin brief={brief} onSave={saveBrief} seeded={roots.length > 0} onSeed={() => void seedTree()} seeding={seeding} />

      {/* Tree */}
      <div style={{ paddingTop: 8, paddingBottom: timelineOpen ? 220 : 48 }}>
        {roots.map((root) => (
          <Subtree key={root.id} node={root} index={index} nodes={nodes} depth={0}
            collapsedSet={collapsedSet} openSet={openSet}
            h={{ onToggle: toggleNode, onToggleDetail: toggleDetail, onAdd: addNode, onDelete: removeNode, onJump: jumpTo, dragId, onDragStart: setDragId, onDragEnd: () => setDragId(null), onDrop: onDropReorder, backlinks, flashId, proposal: proposalView, focusKinds: null, issuesByNode, healthLens, contextId, ctxConsumes, ctxConsumedBy, onContextFocus: focusContext, proseGeneratable, proseOpenSet, onToggleProse: toggleProse, writingProseIds, onProseWriting, onDiscardStory: discardStory, brief, onSaveBrief: saveBrief, bookId, openRail: () => setRailOpen(true), onAttachNode: attachNode, onOpenProseReader: setProseReaderSceneId }} />
        ))}
      </div>
      </>)}
      {proseReaderSceneId && nodes && (
        <ProseReaderModal
          sceneId={proseReaderSceneId}
          nodes={nodes}
          bookId={bookId}
          onClose={() => setProseReaderSceneId(null)}
        />
      )}
    </div>
  );
}
