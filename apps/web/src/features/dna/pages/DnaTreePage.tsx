// DnaTreePage — /books/:slug/dna/tree
// Visual tree of the live book_nodes hierarchy. No app chrome; nav suppressed via ConditionalNav.
// Color-coded by node kind; connector lines via CSS borders; collapsible per-node.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { deleteNode, patchNodeContent, saveNode, saveNodes } from "@/features/dna/lib/bookNodes";
import { backlinkIndex, beatsInOrder, byId, childrenOf, isEntityKind, isProseStale, isStale, newId, pillarOf, refsOf, stampInput, stampProse, type BookSettings, type DnaIssue, type DnaNode, type BeatContent, type NodeContent, type NodeKind, type SceneContent } from "@/features/dna/lib/novelDna";
import { bootstrapLoglineFromBrief, ensureSeed } from "@/features/dna/lib/dnaExpand";
import { editSpecs, KIND_LEVEL, tasteSpecs, type EditSpec } from "@/features/dna/lib/dnaSchema";
import { CONTENT_TYPES, SCOPE_BANDS, briefIdea, type Brief } from "@/lib/brief";
import { describeOps, type NodeOp } from "@/features/dna/lib/dnaChat";
import { AgentRail } from "@/features/dna/components/AgentRail";
import { TreeOverviewTab } from "@/features/dna/components/TreeOverviewTab";
import { type AgentProposal } from "@/features/dna/lib/agentThread";
import { chooseNodeProposal, discardNodeProposals } from "@/features/dna/lib/dnaProposals";
import { DNA_STAGES, dnaHealth, buildJourney, stageProgress, STAGE_KINDS, type StageKey } from "@/features/dna/lib/dnaJourney";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useBookPermissions } from "@/hooks/use-book-permissions";
import {
  listVersions, loadVersion, snapshotTree, restoreVersion, diffAgainstVersion,
  type TreeVersion, type TreeDiff,
} from "@/features/dna/lib/treeVersions";
import { reconcileDna } from "@/features/dna/lib/novelDnaRender";

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
    case "premise": return s(c.dramatic_question) || s((c.shape as Record<string, unknown>)?.name);
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

// Editable fields per kind + KIND_LEVEL now live in @/features/dna/lib/dnaSchema (the single source of truth); the
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
function EditableField({ node, spec, depth, index, parentKey, onJump, searchPattern }: {
  node: DnaNode; spec: EditSpec; depth: number; index: Map<string, DnaNode>; parentKey?: string;
  onJump?: (id: string) => void; // #1 — click a ref to jump to its node
  searchPattern?: RegExp | null; // #8 — highlight this field's displayed value when the search panel has a live match pattern
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
        {spec.fields!.map((sub) => <EditableField key={sub.key} node={node} spec={sub} depth={depth + 1} index={index} parentKey={spec.key} onJump={onJump} searchPattern={searchPattern} />)}
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
              <span onClick={() => onJump?.(id)} title={onJump ? "jump to node" : undefined} style={{ cursor: onJump ? "pointer" : "default", borderBottom: onJump ? "1px dotted #4a5a6a" : undefined }}><Highlighted text={refName(id, index)} pattern={searchPattern ?? null} /></span>
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
              ? <span onClick={() => onJump!(jumpId)} title="jump to node" style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, color: busy ? "#666" : "#9bd3e6", cursor: "pointer", borderBottom: "1px dotted #4a5a6a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><Highlighted text={value} pattern={searchPattern ?? null} /></span>
              : <span onClick={() => !locked && setEditing(true)} style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, color: busy ? "#666" : "#cfcfcf", cursor: locked ? "default" : "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><Highlighted text={value} pattern={searchPattern ?? null} /></span>}
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
        <span onClick={() => !locked && (setDraft(rawAsDraft(raw, spec)), setEditing(true))} style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, color: busy ? "#666" : "#cfcfcf", whiteSpace: "pre-wrap", wordBreak: "break-word", flex: 1, lineHeight: 1.5, cursor: locked ? "default" : "text" }}><Highlighted text={value} pattern={searchPattern ?? null} /></span>
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
function TreeRow({ node, index, depth, expandable, open, onToggle, onDelete, onAttach, kebabItems, draggable, dragging, canDrop, onDragStartRow, onDragEndRow, onDropRow, mark, focus, flash, issues, dimmed, ctx, onContextFocus, prose, headerActions, staleActions, writingProse, seq, searchPattern }: {
  node: DnaNode; index: Map<string, DnaNode>; depth: number; seq?: number; // seq = global reading-order # (beat/scene)
  expandable: boolean; open: boolean; onToggle: () => void; onDelete?: () => void;
  onAttach?: () => void; // attach this node to the agent's context tray (always-visible row action, not buried in the kebab)
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
  searchPattern?: RegExp | null; // #8 — highlight this row's title when the search panel has a live match pattern
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
          {node.kind}{seq != null && <span style={{ opacity: 0.65, marginLeft: 4 }}>{seq}</span>}
        </span>

        {/* Title / content preview */}
        {(glyph || title) && (
          <span style={{
            fontFamily: "ui-monospace, monospace", fontSize: 12, color: mark === "delete" ? "#9a7070" : "#c9c9c9",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1,
            textDecoration: mark === "delete" ? "line-through" : undefined,
          }}>
            {glyph && <span style={{ color: "#fbbf24", marginRight: 2 }}>{glyph}</span>}
            <Highlighted text={title} pattern={searchPattern ?? null} />
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
          {onAttach && (
            <span onClick={(e) => { e.stopPropagation(); onAttach(); }} title="add to agent context"
              style={{ fontFamily: "ui-monospace, monospace", fontSize: 13, color: "#a8a8ff", cursor: "pointer", padding: "0 2px", lineHeight: 1, userSelect: "none", flexShrink: 0 }}>
              ＋
            </span>
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

// Compact inline "＋" (manual add) for NodeGroup headers. AI generation for these groups now lives on the
// agent (the rail), not as per-group buttons.
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
// The agent (the rail) generates options via propose_options; here we only PICK among them:
//  • ProposalPicker — the agent's propose_options stages 2–4 candidates onto node.proposals; this renders
//    them as before→after cards. Picking commits (chooseProposal) + re-stales descendants; both pick and
//    discard log a turn back to the agent thread (dnaProposals.ts).
const SPINE_KINDS = new Set<string>(["seed", "premise", "pillar"]);
const SPINE_LABEL: Record<string, string> = { seed: "logline", premise: "premise", pillar: "pillar" };
// The next rung down each spine singleton — the author can add the placeholder manually; the agent fills it.
const SPINE_CHILD: Record<string, NodeKind> = { seed: "premise", premise: "pillar" };

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
// Read-only header affordance for a scene that already has prose — opens the reader. Writing prose is the
// agent's job now (the rail), so there is no inline write/generate button on the row.
function ReadProseButton({ node, onOpenReader }: { node: DnaNode; onOpenReader?: () => void }) {
  const hasProse = !!(node.content as SceneContent).prose?.text?.trim();
  if (!hasProse || !onOpenReader) return null;
  return (
    <span onClick={(e) => { e.stopPropagation(); onOpenReader(); }} title="read prose"
      style={{
        fontFamily: "ui-monospace, monospace", fontSize: 10, letterSpacing: "0.04em",
        color: "#a8a8ff", cursor: "pointer",
        border: "1px solid #8a8aff44", borderRadius: 4, padding: "0px 7px", background: "#8a8aff08", flexShrink: 0,
      }}>
      read
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
  seq: Map<string, number>;             // beat/scene → its global reading-order number (shown in the kind badge)
  searchPattern: RegExp | null;         // #8 — the active search panel's pattern (null = panel closed/empty); highlights titles + field values
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
  const fields = specs.map((spec) => <EditableField key={spec.key} node={node} spec={spec} depth={depth + 1} index={index} onJump={h.onJump} searchPattern={h.searchPattern} />);
  const backlinks = <BacklinksRow node={node} backlinks={h.backlinks} depth={depth + 1} onJump={h.onJump} />;
  const sub = (items: DnaNode[], d: number) => items.map((child) => (
    <Subtree key={child.id} node={child} index={index} nodes={nodes} depth={d}
      collapsedSet={collapsedSet} openSet={openSet} h={h} />
  ));
  // #1 — phantom add rows the proposal would create under (parentId, kind), rendered before the ＋ add row.
  const phantoms = (parentId: string, kind: string, d: number) =>
    (h.proposal?.addsByParent.get(addKey(parentId, kind)) ?? []).map((add, i) => <PhantomRow key={`ph-${i}`} add={add} depth={d} />);
  // The options picker (any node with staged candidates) renders after this node's own fields, before its
  // children. Generating the candidates is the agent's job (propose_options in the rail); this just picks.
  const lab = open && node.proposals?.length
    ? <ProposalPicker node={node} nodes={nodes} depth={depth + 1} />
    : null;
  // The hanging "+ next rung" slot for the spine singletons (seed→premise→pillar) — a MANUAL placeholder add,
  // shown once THIS node has real content and its single child rung is still empty. The agent fills it (or
  // creates the rung itself). Deeper rungs (pillar→acts, act→beats) already have AddRows.
  const spineChildKind = SPINE_CHILD[node.kind];
  const nodeEmpty = Object.keys((node.content ?? {}) as Record<string, unknown>).length === 0;
  const spineChildRow = open && spineChildKind && !nodeEmpty && !kids.some((k) => k.kind === spineChildKind)
    ? <AddRow label={`+ ${spineChildKind}`} depth={depth + 1} onAdd={() => h.onAdd(node.id, spineChildKind)} />
    : null;

  // Header actions — a scene with prose gets a read affordance; everything else is agent-driven (the rail).
  const headerActions: React.ReactNode =
    node.kind === "scene" ? <ReadProseButton node={node} onOpenReader={() => h.onOpenProseReader(node.id)} />
    : null;

  // Kebab items — MANUAL adds only. AI generation (options, beats, scenes, prose, regenerate) is the agent's
  // job now, in the rail. (Attach-to-agent-context lives on the row itself as the "@" icon.)
  const kebabItems: KebabItem[] = [];
  // Act: add a beat manually
  if (node.kind === "act") {
    kebabItems.push({ label: "+ add beat", color: "#4a7a5a", onClick: () => h.onAdd(node.id, "beat") });
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
              return (
                <NodeGroup key={kind} groupId={`${node.id}::world::${kind}`} label={label}
                  count={items.length} depth={depth + 2} collapsedSet={collapsedSet} onToggle={h.onToggle} alwaysShow
                  action={<GroupAddButton onAdd={() => h.onAdd(node.id, kind)} title={`add ${kind}`} />}
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
    // Regeneration is the agent's job now (ask it in the rail); the stale badge only offers accept/discard.
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
        seq={h.seq.get(node.id)} searchPattern={h.searchPattern}
        onDelete={deletable ? () => h.onDelete(node) : undefined}
        onAttach={() => h.onAttachNode(node.id)}
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
// The brief is the ORIGIN; the seed (logline) is auto-derived from it on first open (see the bootstrap in the
// load effect), so the tree is never empty and the agent always has a root to build from.
function BriefOrigin({ brief, onSave }: {
  brief: Brief | null; onSave: (patch: Partial<Brief>) => Promise<void>;
}) {
  const mono = "ui-monospace, monospace";
  return (
    <div style={{ borderBottom: "1px solid #1a1a1a", background: "#0b0b0f", paddingBottom: 8 }}>
      <BriefSection brief={brief} onSave={onSave} depth={1} />
      <div style={{ padding: "8px 16px 2px 20px", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ color: "#a78bfa", fontSize: 13, lineHeight: 1 }}>↓</span>
        <span style={{ fontFamily: mono, fontSize: 10, color: "#6a6a8a", fontStyle: "italic" }}>
          derives the SEED below — a polished logline (protagonist · inciting · goal · obstacle · stakes), generated from this brief
        </span>
      </div>
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
function JourneyStrip({ nodes, onGoStage }: {
  nodes: DnaNode[]; onGoStage: (key: StageKey) => void;
}) {
  const mono = "ui-monospace, monospace";
  const { stages } = buildJourney(nodes);
  const prog = stageProgress(nodes);
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

// A view-toggle chip for the fixed quick bar — lit in its accent when active.
// ── Search (⌕) — a persistent left-docked panel, VS Code's Search sidebar rather than its Quick Open: stays
// open across jumps (so several hits can be clicked through without re-typing), case/whole-word/regex
// toggles, an include-kind filter (kind is DNA's "which file" — the natural grouping unit here), results
// grouped by kind with collapsible headers, and the match highlighted in place. Closed only by Esc, the ✕,
// or the toolbar toggle — same open/close contract as the timeline/editor rail panels.
interface SearchOpts { caseSensitive: boolean; wholeWord: boolean; useRegex: boolean }
function escapeRegExp(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function buildSearchPattern(query: string, opts: SearchOpts): RegExp | null {
  const q = query.trim();
  if (!q) return null;
  let source = opts.useRegex ? q : escapeRegExp(q);
  if (opts.wholeWord) source = `\\b(?:${source})\\b`;
  try { return new RegExp(source, opts.caseSensitive ? "g" : "gi"); } catch { return null; }
}
interface SearchHit { node: DnaNode; titleHit: boolean; snippet: string }
// Title hits first (an exec() per string, `lastIndex` reset each call since the pattern carries the "g" flag
// and is reused across nodes). A content hit's snippet windows ±40 chars around the actual match length —
// not the query length, since regex/whole-word matches don't have to be the same size as the typed query.
function searchDna(nodes: DnaNode[], pattern: RegExp | null, includeKinds: Set<string>): SearchHit[] {
  if (!pattern) return [];
  const hits: SearchHit[] = [];
  for (const n of nodes) {
    if (includeKinds.size && !includeKinds.has(n.kind)) continue;
    const title = nodeTitle(n);
    pattern.lastIndex = 0;
    if (pattern.test(title)) { hits.push({ node: n, titleHit: true, snippet: title }); continue; }
    const text = JSON.stringify(n.content ?? {});
    pattern.lastIndex = 0;
    const m = pattern.exec(text);
    if (!m) continue;
    const len = m[0].length || 1;
    const start = Math.max(0, m.index - 40);
    const end = Math.min(text.length, m.index + len + 40);
    const snippet = (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
    hits.push({ node: n, titleHit: false, snippet });
  }
  return hits.sort((a, b) => Number(b.titleHit) - Number(a.titleHit));
}
// Split text into hit/non-hit runs against `pattern`, for inline highlighting. Forces the "g" flag (a fresh
// RegExp, not the shared one — sharing would leave lastIndex in a state the caller doesn't expect) and
// guards zero-length matches (a bare regex like "a*") so it can't spin forever advancing lastIndex by hand.
function highlightRuns(text: string, pattern: RegExp): { text: string; hit: boolean }[] {
  const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  const runs: { text: string; hit: boolean }[] = [];
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) runs.push({ text: text.slice(last, m.index), hit: false });
    const len = m[0].length || 1;
    runs.push({ text: text.slice(m.index, m.index + len), hit: true });
    last = m.index + len;
    re.lastIndex = last;
  }
  if (last < text.length) runs.push({ text: text.slice(last), hit: false });
  return runs;
}
function Highlighted({ text, pattern }: { text: string; pattern: RegExp | null }) {
  if (!pattern || !text) return <>{text}</>;
  return <>{highlightRuns(text, pattern).map((r, i) => r.hit
    ? <mark key={i} style={{ background: "#f5c84233", color: "#f5c842", borderRadius: 2, padding: "0 1px" }}>{r.text}</mark>
    : <span key={i}>{r.text}</span>)}</>;
}
function SearchToggleBtn({ active, label, title, onClick }: { active: boolean; label: string; title: string; onClick: () => void }) {
  return (
    <button onClick={onClick} title={title} style={{
      fontFamily: "ui-monospace, monospace", fontSize: 10, padding: "2px 5px", borderRadius: 3, cursor: "pointer",
      background: active ? "#9bd3e633" : "transparent", border: `1px solid ${active ? "#9bd3e688" : "#2a2a3a"}`,
      color: active ? "#9bd3e6" : "#666",
    }}>{label}</button>
  );
}

// caseSensitive/wholeWord/useRegex/includeKinds are lifted to the page (owned alongside `query`) rather than
// local state, because the page ALSO needs them: it highlights the same pattern in the tree itself and
// auto-reveals matched nodes, so the panel and the tree must compute against the identical options — one
// source of truth, not two toggle sets that could drift apart.
function SearchPanel({
  nodes, query, onQueryChange,
  caseSensitive, onCaseSensitiveChange, wholeWord, onWholeWordChange, useRegex, onUseRegexChange,
  includeKinds, onIncludeKindsChange, onJump, onClose,
}: {
  nodes: DnaNode[]; query: string; onQueryChange: (q: string) => void;
  caseSensitive: boolean; onCaseSensitiveChange: (v: boolean) => void;
  wholeWord: boolean; onWholeWordChange: (v: boolean) => void;
  useRegex: boolean; onUseRegexChange: (v: boolean) => void;
  includeKinds: Set<string>; onIncludeKindsChange: (s: Set<string>) => void;
  onJump: (id: string) => void; onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [activeIdx, setActiveIdx] = useState(0);

  // Kinds actually present in this book's tree, in schema-hierarchy order (KIND_COLOR's key order), with any
  // kind KIND_COLOR doesn't know about (e.g. voice_profile) appended rather than silently dropped.
  const kindsPresent = useMemo(() => {
    const present = new Set<string>(nodes.map((n) => n.kind));
    const ordered = Object.keys(KIND_COLOR).filter((k) => present.has(k));
    return [...ordered, ...[...present].filter((k) => !ordered.includes(k))];
  }, [nodes]);

  const pattern = useMemo(() => buildSearchPattern(query, { caseSensitive, wholeWord, useRegex }), [query, caseSensitive, wholeWord, useRegex]);
  const invalidRegex = useRegex && query.trim() !== "" && pattern === null;
  const hits = useMemo(() => searchDna(nodes, pattern, includeKinds), [nodes, pattern, includeKinds]);
  const groups = useMemo(() => {
    const byKind = new Map<string, SearchHit[]>();
    for (const h of hits) { const arr = byKind.get(h.node.kind); if (arr) arr.push(h); else byKind.set(h.node.kind, [h]); }
    return kindsPresent.filter((k) => byKind.has(k)).map((k) => [k, byKind.get(k)!] as const);
  }, [hits, kindsPresent]);
  const flatVisible = useMemo(() => groups.filter(([k]) => !collapsedGroups.has(k)).flatMap(([, hs]) => hs), [groups, collapsedGroups]);
  useEffect(() => { setActiveIdx(0); }, [query, caseSensitive, wholeWord, useRegex, includeKinds]);
  const activeHit = flatVisible[Math.min(activeIdx, flatVisible.length - 1)];

  const toggleKind = (k: string) => { const next = new Set(includeKinds); if (next.has(k)) next.delete(k); else next.add(k); onIncludeKindsChange(next); };
  const toggleGroup = (k: string) => setCollapsedGroups((prev) => { const next = new Set(prev); if (next.has(k)) next.delete(k); else next.add(k); return next; });

  return (
    <div style={{
      position: "fixed", top: 0, left: 0, bottom: 0, width: 320, zIndex: 22,
      background: "#0b0b0fee", borderRight: "1px solid #1c1c26", display: "flex", flexDirection: "column",
      fontFamily: "ui-monospace, monospace", backdropFilter: "blur(6px)",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px 6px" }}>
        <span style={{ fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: "#666" }}>search</span>
        <span onClick={onClose} title="close (esc)" style={{ color: "#666", cursor: "pointer", fontSize: 13, lineHeight: 1 }}>✕</span>
      </div>
      <div style={{ padding: "0 12px 8px", display: "flex", flexDirection: "column", gap: 6, borderBottom: "1px solid #1a1a22" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <input ref={inputRef} value={query} placeholder="search nodes…"
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") { e.preventDefault(); onClose(); }
              else if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, flatVisible.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)); }
              else if (e.key === "Enter" && activeHit) { e.preventDefault(); onJump(activeHit.node.id); }
            }}
            style={{ flex: 1, minWidth: 0, background: "#16161c", border: "1px solid #2a2a3a", borderRadius: 4, color: "#e6e6e6", fontSize: 12, padding: "6px 8px", outline: "none", fontFamily: "inherit" }} />
          <SearchToggleBtn active={caseSensitive} label="Aa" title="match case" onClick={() => onCaseSensitiveChange(!caseSensitive)} />
          <SearchToggleBtn active={wholeWord} label="ab" title="match whole word" onClick={() => onWholeWordChange(!wholeWord)} />
          <SearchToggleBtn active={useRegex} label=".*" title="use regular expression" onClick={() => onUseRegexChange(!useRegex)} />
        </div>
        {invalidRegex && <span style={{ fontSize: 10, color: "#f87171" }}>invalid regular expression</span>}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
          {kindsPresent.map((k) => (
            <span key={k} onClick={() => toggleKind(k)} title={`limit to ${k}`}
              style={{
                fontSize: 9, letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer", padding: "1px 6px", borderRadius: 3,
                color: includeKinds.has(k) ? "#0a0a0a" : (KIND_COLOR[k] ?? "#888"),
                background: includeKinds.has(k) ? (KIND_COLOR[k] ?? "#888") : "transparent",
                border: `1px solid ${(KIND_COLOR[k] ?? "#888")}55`,
              }}>{k}</span>
          ))}
          {includeKinds.size > 0 && <span onClick={() => onIncludeKindsChange(new Set())} style={{ fontSize: 9, color: "#666", cursor: "pointer", textDecoration: "underline" }}>clear</span>}
        </div>
        <span style={{ fontSize: 10, color: "#555" }}>
          {query.trim() ? `${hits.length} result${hits.length === 1 ? "" : "s"} in ${groups.length} kind${groups.length === 1 ? "" : "s"}` : "type to search titles + content"}
        </span>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "4px 0 12px" }}>
        {query.trim() && hits.length === 0 && !invalidRegex && (
          <div style={{ padding: "10px 12px", fontSize: 11, color: "#555" }}>no matches</div>
        )}
        {groups.map(([kind, kindHits]) => {
          const collapsed = collapsedGroups.has(kind);
          return (
            <div key={kind}>
              <div onClick={() => toggleGroup(kind)}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 12px", cursor: "pointer", position: "sticky", top: 0, background: "#0b0b0fee", zIndex: 1 }}>
                <span style={{ fontSize: 9, color: "#555", width: 10 }}>{collapsed ? "▶" : "▼"}</span>
                <span style={{ fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: KIND_COLOR[kind] ?? "#888" }}>{kind}</span>
                <span style={{ fontSize: 9, color: "#444" }}>{kindHits.length}</span>
              </div>
              {!collapsed && kindHits.map((hit) => (
                <div key={hit.node.id} onClick={() => onJump(hit.node.id)} onMouseEnter={() => setActiveIdx(flatVisible.indexOf(hit))}
                  style={{ padding: "5px 12px 5px 26px", cursor: "pointer", background: hit === activeHit ? "#8a8aff14" : "transparent" }}>
                  <div style={{ fontSize: 11, color: hit.titleHit ? "#cfcfcf" : "#8a8a8a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1.5 }}>
                    <Highlighted text={hit.snippet || "(untitled)"} pattern={pattern} />
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

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
function SpineTimeline({ nodes, rightInset, bookId, onJump, onClose }: {
  nodes: DnaNode[]; rightInset: number; bookId: number;
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

  // The timeline is a read/navigate surface — structure and prose are generated from the tree/reader,
  // not from here. Cells only reflect state and jump to the node on click.
  const sceneWritten = (s: DnaNode) => !!(s.content as SceneContent).prose?.text?.trim();
  // Scene cell is always SCENE-green-outlined (it IS a scene); the FILL is the completion signal: hollow =
  // planned, solid green = prose written. Stale (written-but-out-of-date) is the amber exception.
  const sceneState = (s: DnaNode): "planned" | "written" | "stale" =>
    !sceneWritten(s) ? "planned" : isProseStale(s) ? "stale" : "written";

  // global 1-based reading-order numbering — one pass each so chips show book-wide position (matching the
  // tree badge's `seq` and the agent digest). Beats were per-act ("B1" reset each act); now book-wide too.
  const globalSceneNums = new Map<string, number>();
  { let n = 0; for (const m of movs) for (const b of kids(m.id, "beat")) for (const s of kids(b.id, "scene")) globalSceneNums.set(s.id, ++n); }
  const globalBeatNums = new Map<string, number>();
  { let n = 0; for (const m of movs) for (const b of kids(m.id, "beat")) globalBeatNums.set(b.id, ++n); }

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
                  {!beats.length && <span style={{ fontFamily: mono, fontSize: 9, color: "#3a3a3a", fontStyle: "italic" }}>no beats</span>}
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
                  </span>
                )}
                {beats.map((beat, bi) => {
                  const scenes = kids(beat.id, "scene");
                  const bn = globalBeatNums.get(beat.id) ?? bi + 1; // book-wide beat number (matches the tree badge)
                  return (
                    <div key={beat.id} style={{ display: "flex", flexDirection: "column", gap: 6, border: `1px solid ${KIND_COLOR.beat}33`, borderRadius: 6, padding: "6px 7px", background: "#13130c", width: 122 }}>
                      {/* BEAT header */}
                      <div onClick={() => onJump(beat.id)} title={`beat ${bn} — ${nodeTitle(beat)}`} style={{ display: "flex", flexDirection: "column", gap: 3, cursor: "pointer" }}>
                        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <span style={{ fontFamily: mono, fontSize: 8, letterSpacing: "0.1em", textTransform: "uppercase", color: KIND_COLOR.beat, border: `1px solid ${KIND_COLOR.beat}55`, borderRadius: 3, padding: "0px 4px" }}>B{bn}</span>
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
                            const gn = globalSceneNums.get(sc.id) ?? si + 1;
                            return (
                              <span key={sc.id} onClick={() => onJump(sc.id)} title={`scene ${gn} — ${nodeTitle(sc) || "untitled"} · ${state}`}
                                style={{ width: 20, height: 22, borderRadius: 4, background: filled ? edge : "transparent", border: `1.5px solid ${edge}`, color: filled ? "#0a1a0e" : KIND_COLOR.scene, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: mono, fontSize: 10, fontWeight: 700, cursor: "pointer" }}>
                                {gn}
                              </span>
                            );
                          })}
                        </div>
                        {!scenes.length && <span style={{ fontFamily: mono, fontSize: 8, color: "#3a3a3a", fontStyle: "italic" }}>no scenes</span>}
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
// through all scenes that have prose (in reading order). Built on the shadcn
// Dialog (Radix) so body-scroll lock, Escape-to-close, and outside-click come
// for free instead of being hand-rolled on a fixed-position div.
function ProseReaderModal({ sceneId, nodes, bookId: _bookId, onClose, onAttachNode }: {
  sceneId: string; nodes: DnaNode[]; bookId: number; onClose: () => void; onAttachNode: (id: string) => void;
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

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="flex max-h-[85vh] w-[min(720px,92vw)] max-w-[720px] flex-col gap-0 overflow-hidden border-[#2a2a38] bg-[#0e0e12] p-0 text-[#8a9ab0] sm:rounded-lg">
        {/* Header */}
        <div style={{ minWidth: 0, padding: "16px 40px 16px 28px", borderBottom: "1px solid #1c1c26", flexShrink: 0 }}>
          <div style={{ fontFamily: mono, fontSize: 9, letterSpacing: "0.2em", textTransform: "uppercase", color: "#5a6a80" }}>
            prose reader{idx >= 0 ? ` · ${idx + 1} / ${written.length}` : ""}
          </div>
          <DialogTitle className="truncate font-normal tracking-normal" style={{ fontFamily: mono, fontSize: 13, color: "#cfcfcf", marginTop: 3 }}>
            {scene ? (nodeTitle(scene) || "untitled scene") : "scene not found"}
          </DialogTitle>
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
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            {scene && (
              <button onClick={() => onAttachNode(scene.id)}
                style={{ background: "none", border: "none", fontFamily: mono, fontSize: 10, color: "#a8a8ff", cursor: "pointer", letterSpacing: "0.04em" }}>
                ＋ add to agent context
              </button>
            )}
            <span style={{ fontFamily: mono, fontSize: 10, color: "#555" }}>{prose?.words ? `${prose.words}w` : ""}</span>
          </div>
          <button onClick={() => next && setCurrentId(next.id)} disabled={!next}
            style={{ background: "none", border: "none", fontFamily: mono, fontSize: 11, color: next ? "#8a9ab0" : "#333", cursor: next ? "pointer" : "default", letterSpacing: "0.06em" }}>next →</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Version history ───────────────────────────────────────────────────────────
// A simple, linear "save points" history for the tree (book_tree_versions) — Notion/Docs-style, not
// git: no branches, no per-hunk staging (the agent's proposal cards already cover pre-commit review at
// op-granularity while a run is live). This is the fallback net for auto-accept mode, where the agent
// commits its own picks with no per-op review: snapshotTree() checkpoints right before auto arms
// (AgentRail.toggleAuto), and this modal shows what's changed since the last checkpoint and can restore
// an old one. Restore is forward-moving — it appends a new version, never rewrites history.
function HistoryModal({ bookId, nodes, onClose }: { bookId: number; nodes: DnaNode[]; onClose: () => void }) {
  const mono = "ui-monospace, monospace";
  const { toast } = useToast();
  const [versions, setVersions] = useState<Omit<TreeVersion, "nodes">[]>([]);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [sinceLastDiff, setSinceLastDiff] = useState<TreeDiff | null>(null);
  const [openDiffs, setOpenDiffs] = useState<Record<number, TreeDiff | "loading">>({});
  const [confirmRestoreId, setConfirmRestoreId] = useState<number | null>(null);
  const [restoringId, setRestoringId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listVersions(bookId);
      setVersions(list);
      setSinceLastDiff(list.length > 0 ? diffAgainstVersion(nodes, await loadVersion(list[0].id)) : null);
    } catch (e) {
      toast({ title: "Couldn't load version history", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, toast]);
  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    setSaving(true);
    try { await snapshotTree(bookId, label.trim() || undefined); setLabel(""); await load(); }
    catch (e) { toast({ title: "Couldn't save version", description: String((e as Error)?.message ?? e), variant: "destructive" }); }
    finally { setSaving(false); }
  };

  const toggleDiff = async (id: number) => {
    if (openDiffs[id]) { setOpenDiffs((p) => { const n = { ...p }; delete n[id]; return n; }); return; }
    setOpenDiffs((p) => ({ ...p, [id]: "loading" }));
    try {
      const versionNodes = await loadVersion(id);
      setOpenDiffs((p) => ({ ...p, [id]: diffAgainstVersion(nodes, versionNodes) }));
    }
    catch (e) {
      toast({ title: "Couldn't load that version", description: String((e as Error)?.message ?? e), variant: "destructive" });
      setOpenDiffs((p) => { const n = { ...p }; delete n[id]; return n; });
    }
  };

  const restore = async (id: number) => {
    if (confirmRestoreId !== id) { setConfirmRestoreId(id); return; }
    setConfirmRestoreId(null);
    setRestoringId(id);
    try {
      await restoreVersion(bookId, id, nodes);
      await load();
      toast({ title: "Restored", description: "The tree now matches that version." });
    } catch (e) { toast({ title: "Couldn't restore", description: String((e as Error)?.message ?? e), variant: "destructive" }); }
    finally { setRestoringId(null); }
  };

  const when = (iso: string) => { try { return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); } catch { return iso; } };
  const diffLabel = (d: TreeDiff) => {
    const parts: string[] = [];
    if (d.added) parts.push(`+${d.added}`);
    if (d.removed) parts.push(`−${d.removed}`);
    if (d.changed) parts.push(`~${d.changed}`);
    return parts.length ? parts.join(" ") : "no changes";
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="flex max-h-[85vh] w-[min(560px,92vw)] max-w-[560px] flex-col gap-0 overflow-hidden border-[#2a2a38] bg-[#0e0e12] p-0 text-[#8a9ab0] sm:rounded-lg">
        <div style={{ padding: "16px 24px 14px", borderBottom: "1px solid #1c1c26", flexShrink: 0 }}>
          <div style={{ fontFamily: mono, fontSize: 9, letterSpacing: "0.2em", textTransform: "uppercase", color: "#5a6a80" }}>history</div>
          <DialogTitle className="font-normal tracking-normal" style={{ fontFamily: mono, fontSize: 13, color: "#cfcfcf", marginTop: 3 }}>
            Tree versions
          </DialogTitle>
          {sinceLastDiff && (
            <div style={{ marginTop: 8, fontFamily: mono, fontSize: 11, color: sinceLastDiff.added + sinceLastDiff.removed + sinceLastDiff.changed > 0 ? "#d0a060" : "#555" }}>
              since last version: {diffLabel(sinceLastDiff)}
            </div>
          )}
          <div style={{ marginTop: 10, display: "flex", gap: 6 }}>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="name this version (optional)…"
              onKeyDown={(e) => { if (e.key === "Enter") void save(); }}
              style={{ flex: 1, minWidth: 0, background: "#16161c", border: "1px solid #2a2a3a", borderRadius: 4, color: "#e6e6e6", fontSize: 12, padding: "6px 8px", outline: "none", fontFamily: "inherit" }} />
            <button onClick={() => void save()} disabled={saving}
              style={{ fontFamily: mono, fontSize: 11, letterSpacing: "0.04em", color: "#a8a8ff", background: "#8a8aff14", border: "1px solid #8a8aff44", borderRadius: 4, padding: "0 12px", cursor: saving ? "default" : "pointer", opacity: saving ? 0.6 : 1 }}>
              {saving ? "saving…" : "save version"}
            </button>
          </div>
        </div>
        <div style={{ overflowY: "auto", padding: "6px 0 14px", flex: 1 }}>
          {loading && <div style={{ padding: "16px 24px", fontFamily: mono, fontSize: 11, color: "#555" }}>loading…</div>}
          {!loading && versions.length === 0 && (
            <div style={{ padding: "16px 24px", fontFamily: mono, fontSize: 11, color: "#555" }}>
              No saved versions yet. Versions checkpoint automatically when auto-accept arms, or save one above.
            </div>
          )}
          {versions.map((v) => {
            const d = openDiffs[v.id];
            return (
              <div key={v.id} style={{ padding: "8px 24px", borderBottom: "1px solid #1a1a22" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontFamily: mono, fontSize: 12, color: v.label ? "#cfcfcf" : "#8a8a8a", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {v.label ?? "auto checkpoint"}
                  </span>
                  <span style={{ fontFamily: mono, fontSize: 10, color: "#555" }}>{when(v.created_at)}</span>
                </div>
                <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 12 }}>
                  <button onClick={() => void toggleDiff(v.id)} style={{ background: "none", border: "none", fontFamily: mono, fontSize: 10, color: "#666", cursor: "pointer", padding: 0 }}>
                    {d ? (d === "loading" ? "loading…" : diffLabel(d)) : "diff vs. live"}
                  </button>
                  <button onClick={() => void restore(v.id)} disabled={restoringId === v.id}
                    style={{ background: "none", border: "none", fontFamily: mono, fontSize: 10, color: confirmRestoreId === v.id ? "#f87171" : "#8a9ab0", cursor: "pointer", padding: 0 }}>
                    {restoringId === v.id ? "restoring…" : confirmRestoreId === v.id ? "confirm restore?" : "restore"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
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
  const { toast } = useToast();
  const tab: "tree" | "taste" | "overview" = location.pathname.endsWith("/overview") ? "overview" : location.pathname.endsWith("/taste") ? "taste" : "tree";
  const treePath = `/books/${bookSlug}/dna/tree`;
  const overviewPath = `${treePath}/overview`;

  // Permission gate — DnaStudioPage used to enforce this (bounce non-editors); the tree had none. RLS
  // protects the data either way, but the page itself should bounce like the old studio did.
  const { canEdit, hasAccess, loading: permLoading } = useBookPermissions(bookSlug);
  useEffect(() => {
    if (permLoading) return;
    if (!hasAccess || !canEdit) navigate(`/books/${bookSlug}`, { replace: true });
  }, [permLoading, hasAccess, canEdit, bookSlug, navigate]);

  const [bookName, setBookName] = useState<string>("");
  const [settings, setSettings] = useState<BookSettings>({});
  const [nodes, setNodes] = useState<DnaNode[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collapsedSet, setCollapsedSet] = useState<Set<string>>(new Set());
  const [openSet, setOpenSet] = useState<Set<string>>(new Set()); // detail-only leaves the user dug into
  // The reviser rail's open/closed state persists across tab switches (no remount) AND reloads (localStorage,
  // per book) — the chat thread itself lives server-side in book_agent_runs, this just remembers the rail.
  const railKey = `dna-rail-open:${bookId}`;
  // Default-open: the editor rail is the primary way to work the tree, so show it unless the author explicitly
  // closed it ("0"). Unset (new book / first visit) lands with the rail open.
  const [railOpen, setRailOpen] = useState<boolean>(() => localStorage.getItem(railKey) !== "0");
  useEffect(() => { localStorage.setItem(railKey, railOpen ? "1" : "0"); }, [railKey, railOpen]);
  // Slice 2 (docs/agent-context-model.md): the agent's context tray — DNA node ids the author attached as
  // anchors (Cursor's @-file model). Persisted per book; the agent always sees the whole book, these just
  // bias where it looks. Attach from the node row's "@" icon; detach from the chip in the rail. Opening the rail on
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
  // #8 — the search panel: left-docked, persists open/closed per book like the rail/timeline do.
  const searchKey = `dna-search-open:${bookId}`;
  const [searchOpen, setSearchOpen] = useState<boolean>(() => localStorage.getItem(searchKey) === "1");
  useEffect(() => { localStorage.setItem(searchKey, searchOpen ? "1" : "0"); }, [searchKey, searchOpen]);
  const [searchQuery, setSearchQuery] = useState("");
  // Lifted alongside searchQuery (not local to SearchPanel) because the tree ALSO consumes this pattern —
  // TreeRow/EditableField highlight against it directly, so panel + tree must share one computed pattern.
  const [searchCaseSensitive, setSearchCaseSensitive] = useState(false);
  const [searchWholeWord, setSearchWholeWord] = useState(false);
  const [searchUseRegex, setSearchUseRegex] = useState(false);
  const [searchIncludeKinds, setSearchIncludeKinds] = useState<Set<string>>(new Set());
  const searchPattern = useMemo(
    () => (searchOpen ? buildSearchPattern(searchQuery, { caseSensitive: searchCaseSensitive, wholeWord: searchWholeWord, useRegex: searchUseRegex }) : null),
    [searchOpen, searchQuery, searchCaseSensitive, searchWholeWord, searchUseRegex],
  );
  const [flashId, setFlashId] = useState<string | null>(null); // #1 — the node a jump just revealed
  const [dragId, setDragId] = useState<string | null>(null); // #5 — the node being dragged
  const [brief, setBrief] = useState<Brief | null>(null);
  const [proseOpenSet, setProseOpenSet] = useState<Set<string>>(new Set());
  const [writingProseIds, setWritingProseIds] = useState<Set<string>>(new Set());
  const onProseWriting = useCallback((id: string, busy: boolean) => {
    setWritingProseIds((prev) => { const next = new Set(prev); if (busy) next.add(id); else next.delete(id); return next; });
  }, []);
  const [proseReaderSceneId, setProseReaderSceneId] = useState<string | null>(null); // prose reader modal
  const toggleProse = useCallback((id: string) => {
    setProseOpenSet((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }, []);
  const [discardOpen, setDiscardOpen] = useState(false);
  const discardStory = useCallback(() => setDiscardOpen(true), []);
  const [historyOpen, setHistoryOpen] = useState(false);

  const saveBrief = useCallback(async (patch: Partial<Brief>) => {
    const next = { ...brief, ...patch, updated_at: new Date().toISOString() } as Brief;
    setBrief(next);
    const { error: err } = await supabase.from("books").update({ brief: next }).eq("id", bookId);
    if (err) throw new Error(err.message);
    setSettings((prev) => ({ ...prev, word_target: next.scope?.word_target }));
    // The moment idea is submitted, ensure the seed exists and kick off a real logline draft in the
    // background — bootstrapLoglineFromBrief is idempotent (a no-op once the logline has moved past the
    // raw idea placeholder), so this is safe to fire on every idea save.
    if ("idea" in patch) void bootstrapLoglineFromBrief(bookId, next.idea);
  }, [brief, bookId]);

  // Seed an empty tree: create the root `seed` node, prefilling its logline from the brief's idea.
  // Everything else (premise/pillar/cast/spine) grows from here via the reviser or the studio.
  // The load+bootstrap effect runs once per book (also dedupes React strict-mode's double-invoke, so an
  // empty tree can't be auto-seeded into two duplicate roots).
  const bootstrappedFor = useRef<number | null>(null);

  useEffect(() => {
    if (!bookId) { setError("no book id"); return; }
    if (bootstrappedFor.current === bookId) return;
    bootstrappedFor.current = bookId;
    void (async () => {
      const [{ data: nodeRows, error: nodesErr }, { data: book, error: bookErr }] = await Promise.all([
        supabase.from("book_nodes").select("*").eq("book_id", bookId).order("position"),
        supabase.from("books").select("name, author, brief").eq("id", bookId).maybeSingle(),
      ]);
      if (nodesErr || bookErr) { setError((nodesErr ?? bookErr)?.message ?? "error"); return; }
      setBookName(book?.name ?? "");
      const loadedBrief = (book?.brief as Brief | null) ?? null;
      setBrief(loadedBrief);
      setSettings({ title: book?.name ?? undefined, author: (book?.author as string | null) ?? undefined,
        word_target: loadedBrief?.scope?.word_target });
      const loaded = (nodeRows ?? []) as DnaNode[];
      // Bootstrap the ROOT: the agent can't create a parent-less seed node, so an empty tree gets one
      // automatically (the seed = the logline origin, derived from the brief idea). The agent builds
      // everything below it — this replaces the old manual "seed the tree" button.
      if (loaded.length === 0) {
        const idea = briefIdea(loadedBrief)?.trim();
        try {
          const seed = await ensureSeed(bookId, idea);
          setNodes([seed]); setOpenSet((p) => new Set(p).add(seed.id));
          // Safety net for a seed that already exists with an idea but no draft yet (e.g. the brief was
          // saved from a surface that predates this, or the fire-and-forget call from that save never
          // landed) — bootstrapLoglineFromBrief is idempotent, so this is a no-op once it's already drafted.
          if (idea) void bootstrapLoglineFromBrief(bookId, idea);
          return;
        } catch { /* leave the tree empty; the live subscription still reflects reality */ }
      }
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

  // Live subscription on the `books` row — name/author/brief can change from elsewhere (e.g. a second tab
  // on Book Edit), so the tree needs its own live projection of it too (refresh = no-op).
  useEffect(() => {
    if (!bookId) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const reload = () => void supabase.from("books").select("name, author, brief").eq("id", bookId).maybeSingle().then(({ data: book }) => {
      if (!book) return;
      setBookName(book.name ?? "");
      const loadedBrief = (book.brief as Brief | null) ?? null;
      setBrief(loadedBrief);
      setSettings((prev) => ({ ...prev, title: book.name ?? undefined, author: (book.author as string | null) ?? undefined,
        word_target: loadedBrief?.scope?.word_target }));
    });
    const soon = () => { if (t) clearTimeout(t); t = setTimeout(reload, 400); };
    const ch = supabase.channel(`treebook_${bookId}_${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "books", filter: `id=eq.${bookId}` }, soon)
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

  // ── Render / read — project the tree onto pages (ported from DnaStudio's top bar, Phase 3) ────────────
  const [rendering, setRendering] = useState<"render" | "read" | null>(null);
  const renderPages = useCallback(async () => {
    if (!bookId || rendering) return;
    setRendering("render");
    try {
      const r = await reconcileDna(bookId);
      toast({ title: "Rendered", description: `${r.pages} pages · ${r.created} added · ${r.updated} updated · ${r.archived} archived.` });
    } catch (e) {
      toast({ title: "Couldn't render", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally { setRendering(null); }
  }, [bookId, rendering, toast]);
  // Render-then-read: project the tree onto pages FIRST (idempotent), then open the reader — so the prose
  // you read is always current, never the stale "I forgot to render" page.
  const renderAndRead = useCallback(async () => {
    if (!bookId || rendering) return;
    setRendering("read");
    try { await reconcileDna(bookId); window.location.href = `/books/${bookSlug}`; }
    catch (e) { toast({ title: "Couldn't render", description: String((e as Error)?.message ?? e), variant: "destructive" }); setRendering(null); }
  }, [bookId, bookSlug, rendering, toast]);

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

  // #8 — while search is active, un-collapse every match's ancestors as you type — otherwise a hit buried in
  // a collapsed act/beat would never actually become visible (or highlighted) in the tree. Mirrors the health
  // lens's reveal-on-toggle; here it re-runs on every pattern/filter change instead of a single toggle click.
  useEffect(() => {
    if (!nodes || !searchPattern) return;
    const matches = searchDna(nodes, searchPattern, searchIncludeKinds);
    if (matches.length) revealNodes(matches.map((m) => m.node.id));
  }, [nodes, searchPattern, searchIncludeKinds, revealNodes]);

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

  // #8 — "/" opens search from anywhere except while typing in an editable field (fields are click-to-edit
  // inputs/textareas scattered through the tree, so this can't be a plain global listener).
  useEffect(() => {
    if (searchOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/") return;
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable) return;
      e.preventDefault();
      setSearchOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [searchOpen]);

  // A search hit (or any future off-tab jump) needs to land on the tree tab first — jumpTo only manipulates
  // tree-local reveal state, it doesn't switch tabs itself.
  const goToNode = useCallback((id: string) => { if (tab !== "tree") navigate(treePath); jumpTo(id); }, [tab, navigate, treePath, jumpTo]);

  // The Overview tab's "onOpen" — same off-tab landing as goToNode, then either jump straight to a specific
  // node (a drill-in from the shape map / issues list) or fall back to goStage's first-of-kind jump.
  const openStage = useCallback((key: StageKey, focusId?: string) => {
    if (tab !== "tree") navigate(treePath);
    if (focusId) jumpTo(focusId); else goStage(key);
  }, [tab, navigate, treePath, jumpTo, goStage]);

  const base: React.CSSProperties = {
    margin: 0, minHeight: "100vh",
    fontFamily: "ui-monospace, 'Cascadia Code', 'Source Code Pro', monospace",
    background: "#0a0a0a", color: "#888",
    userSelect: "text",
  };

  if (permLoading || !hasAccess || !canEdit) return null;
  if (error) return <div style={{ ...base, padding: 24, color: "#f87171" }}>error: {error}</div>;
  if (!nodes) return <div style={{ ...base, padding: 24 }}>loading…</div>;

  const index = byId(nodes);
  const roots = nodes.filter((n) => n.parent_id === null).sort((a, b) => a.position - b.position);

  // Global reading-order numbers for beats and scenes — ONE numbering shared by the tree badge (below), the
  // timeline strip, and (mirrored) the agent's digest, so "beat 3" / "scene 14" denote the same node in all
  // three. Derived from the same act→beat→scene walk the render uses; a node is only ever one kind, so a
  // single map is unambiguous.
  const seq = new Map<string, number>();
  beatsInOrder(nodes).forEach((b, i) => seq.set(b.id, i + 1));
  scenesInOrder(nodes).forEach((s, i) => seq.set(s.id, i + 1));

  // Kind distribution for the stats bar
  const counts = nodes.reduce<Record<string, number>>((acc, n) => { acc[n.kind] = (acc[n.kind] ?? 0) + 1; return acc; }, {});
  const accepted = nodes.filter((n) => n.authoring.status === "accepted").length;
  const staleCount = nodes.filter((n) => isStale(n, index) || (n.kind === "scene" && isProseStale(n))).length;

  // The journey, for the Overview tab (same computation DnaStudio used to drive its own Overview mount).
  const { stages: journeyStages, nowIndex: journeyNowIndex } = buildJourney(nodes);
  const nowKey = journeyStages[journeyNowIndex]?.key ?? "premise";

  // #4 — DNA health: completeness + strength + the lints behind them (structural faults included).
  const health = dnaHealth(nodes, settings);
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
    <div style={{ ...base, marginRight: railOpen ? 420 : 0, marginLeft: searchOpen ? 320 : 0 }}>
      {/* Fixed quick-toggle bar — always-on access to the main view modes (clears the rail when it's open) */}
      <div style={{
        position: "fixed", top: 8, right: railOpen ? 432 : 14, zIndex: 25, display: "flex", gap: 3,
        background: "#0d0d12e6", border: "1px solid #20202c", borderRadius: 9, padding: "4px 5px",
        boxShadow: "0 4px 18px #00000088", backdropFilter: "blur(6px)",
      }}>
        <QuickToggle active={searchOpen} accent="#9bd3e6" icon="⌕" label="Search" onClick={() => setSearchOpen((v) => !v)} />
        {tab === "tree" && <QuickToggle active={timelineOpen} accent="#fb923c" icon="▦" label="Timeline" onClick={() => setTimelineOpen((v) => !v)} />}
        <QuickToggle active={railOpen} accent="#8a8aff" icon="✦" label="Editor" onClick={() => setRailOpen((v) => !v)} />
        {tab === "tree" && <QuickToggle active={historyOpen} accent="#a0a0a0" icon="⟲" label="History" onClick={() => setHistoryOpen((v) => !v)} />}
        {tab === "tree" && (health.errors + health.warns) > 0 && (
          <QuickToggle active={healthLens} accent="#d0a060" icon="◐" label="Lens"
            onClick={() => { const on = !healthLens; setHealthLens(on); if (on) revealNodes(health.issues.map((i) => i.nodeId).filter((x): x is string => !!x)); }} />
        )}
      </div>
      {searchOpen && (
        <SearchPanel nodes={nodes} query={searchQuery} onQueryChange={setSearchQuery}
          caseSensitive={searchCaseSensitive} onCaseSensitiveChange={setSearchCaseSensitive}
          wholeWord={searchWholeWord} onWholeWordChange={setSearchWholeWord}
          useRegex={searchUseRegex} onUseRegexChange={setSearchUseRegex}
          includeKinds={searchIncludeKinds} onIncludeKindsChange={setSearchIncludeKinds}
          onJump={goToNode} onClose={() => setSearchOpen(false)} />
      )}
      {discardOpen && <DiscardStoryModal nodes={nodes} onClose={() => setDiscardOpen(false)} />}
      {historyOpen && nodes && <HistoryModal bookId={bookId} nodes={nodes} onClose={() => setHistoryOpen(false)} />}
      {/* The tool-using editor's agent (durable book-agent thread), promoted into the tree rail. The
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
            <AgentRail bookId={bookId} nodes={nodes} settings={settings} bookSlug={bookSlug} attachedIds={attachedIds} onDetach={detachNode} />
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
        <SpineTimeline nodes={nodes} rightInset={railOpen ? 420 : 0} bookId={bookId}
          onJump={jumpTo} onClose={() => setTimelineOpen(false)} />
      )}
      {/* Header bar */}
      <div style={{ padding: "12px 16px", borderBottom: "1px solid #1a1a1a", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <span style={{ color: "#666", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase" }}>
          {bookName || bookSlug} · dna
        </span>
        {/* Tab strip — overview (the dashboard) / tree (structure) / voice & feel (taste). Same component,
            splat route, no remount. */}
        <div style={{ display: "flex", gap: 4 }}>
          {([["overview", "overview", overviewPath], ["tree", "tree", treePath], ["taste", "voice & feel", `${treePath}/taste`]] as const).map(([key, label, to]) => (
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
          {/* Ported from the vanilla studio's sidebar (docs/plan-one-studio-consolidation.md Phase 3) — the
              studio's only two verbs that weren't already native to the tree. */}
          <button onClick={() => void renderPages()} disabled={!!rendering} title="Project the DNA tree onto the reader's pages"
            style={{ background: "none", border: "none", color: rendering ? "#444" : "#555", fontSize: 10, cursor: rendering ? "default" : "pointer", letterSpacing: "0.1em", textTransform: "uppercase" }}>
            {rendering === "render" ? "rendering…" : "render pages →"}
          </button>
          <button onClick={() => void renderAndRead()} disabled={!!rendering} title="Render the latest pages and open the reader"
            style={{ background: "none", border: "none", color: rendering ? "#444" : "#555", fontSize: 10, cursor: rendering ? "default" : "pointer", letterSpacing: "0.1em", textTransform: "uppercase" }}>
            {rendering === "read" ? "rendering…" : "read →"}
          </button>
          <button onClick={() => void forkDna()} disabled={forking} title="Copy this DNA tree into a new book to experiment freely"
            style={{ background: "none", border: "none", color: forking ? "#444" : "#555", fontSize: 10, cursor: forking ? "default" : "pointer", letterSpacing: "0.1em", textTransform: "uppercase" }}>
            {forking ? "forking…" : "fork →"}
          </button>
          {/* Timeline + Editor toggles moved to the fixed quick bar (top-right) */}
        </div>
      </div>

      {/* ── overview tab: the studio's dashboard — shape, next move, issues ── */}
      {tab === "overview" && (
        <TreeOverviewTab bookId={bookId} nodes={nodes} settings={settings} stages={journeyStages} nowKey={nowKey}
          onOpen={openStage} onChanged={() => {}} />
      )}

      {/* ── voice & feel tab: the taste surface on its own, off the structural tree ── */}
      {tab === "taste" && (
        <VoiceFeelPanel nodes={nodes} index={index} asPage onJump={(id) => { navigate(treePath); jumpTo(id); }} />
      )}

      {/* ── tree tab: journey → legend → lints → proposals → brief → the structural tree ── */}
      {tab === "tree" && (<>
      {/* Journey strip — where am I / what's left (studio's strength, brought onto the tree) */}
      {roots.length > 0 && <JourneyStrip nodes={nodes} onGoStage={goStage} />}
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

      {/* The BRIEF — the ORIGIN (step 0), above the tree. The seed (logline) below is derived from it. */}
      <BriefOrigin brief={brief} onSave={saveBrief} />

      {/* Tree */}
      <div style={{ paddingTop: 8, paddingBottom: timelineOpen ? 220 : 48 }}>
        {roots.map((root) => (
          <Subtree key={root.id} node={root} index={index} nodes={nodes} depth={0}
            collapsedSet={collapsedSet} openSet={openSet}
            h={{ onToggle: toggleNode, onToggleDetail: toggleDetail, onAdd: addNode, onDelete: removeNode, onJump: jumpTo, dragId, onDragStart: setDragId, onDragEnd: () => setDragId(null), onDrop: onDropReorder, backlinks, flashId, proposal: proposalView, focusKinds: null, issuesByNode, healthLens, contextId, ctxConsumes, ctxConsumedBy, onContextFocus: focusContext, seq, searchPattern, proseGeneratable, proseOpenSet, onToggleProse: toggleProse, writingProseIds, onProseWriting, onDiscardStory: discardStory, brief, onSaveBrief: saveBrief, bookId, openRail: () => setRailOpen(true), onAttachNode: attachNode, onOpenProseReader: setProseReaderSceneId }} />
        ))}
      </div>
      </>)}
      {proseReaderSceneId && nodes && (
        <ProseReaderModal
          sceneId={proseReaderSceneId}
          nodes={nodes}
          bookId={bookId}
          onClose={() => setProseReaderSceneId(null)}
          onAttachNode={attachNode}
        />
      )}
    </div>
  );
}
