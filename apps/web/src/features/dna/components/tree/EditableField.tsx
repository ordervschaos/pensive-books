import { useEffect, useRef, useState } from "react";
import { patchNodeContent } from "@/features/dna/lib/bookNodes";
import { type DnaNode, type NodeContent } from "@/features/dna/lib/novelDna";
import { type EditSpec } from "@/features/dna/lib/dnaSchema";
import { detailRowStyle, fieldRowStart, inputStyle, labelStyle, MONO, SERIF, T } from "./treeChrome";
import { contentAt, displayValue, nodeTitle, refName } from "./nodeDisplay";
import { Highlighted } from "./search";

// Editable fields per kind + KIND_LEVEL now live in @/features/dna/lib/dnaSchema (the single source of truth); the
// editor below renders straight off editSpecs(kind). EditSpec carries an optional `required` flag the
// schema's validateContent() reads — the editor ignores it (every field is still editable).

// ── An editable content field: typed editor by spec.type ──────────────────────
// Self-contained — writes straight through saveNode(editContent(...)) so the nested patch deep-merges and
// Realtime reflects it back. Locked nodes are read-only. `parentKey` nests the patch for object sub-fields.
export function EditableField({ node, spec, depth, index, parentKey, onJump, searchPattern }: {
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
        <div style={detailRowStyle(depth)}>{fieldRowStart(depth)}<span style={{ ...labelStyle, color: T.inkSoft }}>{spec.label}</span></div>
        {spec.fields!.map((sub) => <EditableField key={sub.key} node={node} spec={sub} depth={depth + 1} index={index} parentKey={spec.key} onJump={onJump} searchPattern={searchPattern} />)}
      </>
    );
  }

  const emptyRow = (
    <div style={detailRowStyle(depth)}>{fieldRowStart(depth)}<span style={labelStyle} title={spec.hint}>{spec.label}</span>
      <span onClick={() => !locked && setEditing(true)} style={{ fontFamily: SERIF, fontSize: 13, color: T.faint, flex: 1, cursor: locked ? "default" : "pointer", fontStyle: "italic" }}>
        {locked ? "—" : `＋ ${spec.label}`}
      </span>
    </div>
  );

  // ── refs: chips + an add-dropdown; always-interactive when expanded ──────────
  if (spec.type === "refs") {
    const ids = Array.isArray(raw) ? (raw as string[]) : [];
    const candidates = [...index.values()].filter((n) => n.kind === spec.refKind && !ids.includes(n.id));
    return (
      <div style={detailRowStyle(depth)}>{fieldRowStart(depth)}<span style={labelStyle} title={spec.hint}>{spec.label}</span>
        <span style={{ display: "flex", flexWrap: "wrap", gap: 4, flex: 1, alignItems: "center" }}>
          {ids.map((id) => (
            <span key={id} style={{ fontFamily: MONO, fontSize: 11, color: T.inkSoft, background: T.raised, border: `1px solid ${T.border}`, borderRadius: 4, padding: "1px 6px", display: "inline-flex", gap: 4, alignItems: "center" }}>
              <span onClick={() => onJump?.(id)} title={onJump ? "jump to node" : undefined} style={{ cursor: onJump ? "pointer" : "default", borderBottom: onJump ? `1px dotted ${T.faint}` : undefined }}><Highlighted text={refName(id, index)} pattern={searchPattern ?? null} /></span>
              {!locked && <span onClick={() => !busy && void write(ids.filter((x) => x !== id))} style={{ cursor: "pointer", color: T.faint }}>✕</span>}
            </span>
          ))}
          {!locked && candidates.length > 0 && (
            <select value="" disabled={busy} onChange={(e) => e.target.value && void write([...ids, e.target.value])}
              style={{ ...inputStyle, fontSize: 12, padding: "1px 4px" }}>
              <option value="">＋ add…</option>
              {candidates.map((c) => <option key={c.id} value={c.id}>{nodeTitle(c) || c.id}</option>)}
            </select>
          )}
          {!ids.length && locked && <span style={{ color: T.faint, fontFamily: MONO, fontSize: 11 }}>—</span>}
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
        <div style={detailRowStyle(depth)}>{fieldRowStart(depth)}<span style={labelStyle} title={spec.hint}>{spec.label}</span>
          <span style={{ flex: 1, display: "flex", alignItems: "baseline", gap: 6, minWidth: 0 }}>
            {jumpId
              ? <span onClick={() => onJump!(jumpId)} title="jump to node" style={{ fontFamily: SERIF, fontSize: 14, color: busy ? T.faint : T.accent, cursor: "pointer", borderBottom: `1px dotted ${T.faint}`, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><Highlighted text={value} pattern={searchPattern ?? null} /></span>
              : <span onClick={() => !locked && setEditing(true)} style={{ fontFamily: SERIF, fontSize: 14, color: busy ? T.faint : T.ink, cursor: locked ? "default" : "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><Highlighted text={value} pattern={searchPattern ?? null} /></span>}
            {!locked && jumpId && <span onClick={() => setEditing(true)} title="change" style={{ fontSize: 10, color: T.faint, cursor: "pointer", flexShrink: 0 }}>▾</span>}
          </span>
          {!locked && <span onClick={() => !busy && void write("")} title="clear field" style={{ fontSize: 11, color: T.faint, cursor: "pointer", flexShrink: 0, alignSelf: "center", padding: "0 2px" }}>✕</span>}
        </div>
      );
    }
    const opts = spec.type === "select" ? (spec.options ?? []).map((o) => ({ id: o, label: o }))
      : [...index.values()].filter((n) => n.kind === spec.refKind).map((n) => ({ id: n.id, label: nodeTitle(n) || n.id }));
    return (
      <div style={detailRowStyle(depth)}>{fieldRowStart(depth)}<span style={labelStyle} title={spec.hint}>{spec.label}</span>
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
      <div style={detailRowStyle(depth)}>{fieldRowStart(depth)}<span style={labelStyle} title={spec.hint}>{spec.label}</span>
        <span onClick={() => !locked && (setDraft(rawAsDraft(raw, spec)), setEditing(true))} style={{ fontFamily: SERIF, fontSize: 14, color: busy ? T.faint : T.ink, whiteSpace: "pre-wrap", wordBreak: "break-word", flex: 1, lineHeight: 1.55, cursor: locked ? "default" : "text" }}><Highlighted text={value} pattern={searchPattern ?? null} /></span>
        {!locked && <span onClick={() => !busy && void write(spec.type === "list" ? [] : "")} title="clear field" style={{ fontSize: 11, color: T.faint, cursor: "pointer", flexShrink: 0, alignSelf: "center", padding: "0 2px" }}>✕</span>}
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
    <div style={detailRowStyle(depth)} onClick={(e) => e.stopPropagation()}>{fieldRowStart(depth)}<span style={labelStyle} title={spec.hint}>{spec.label}</span>
      {spec.multiline ? <textarea rows={Math.min(8, Math.max(2, draft.split("\n").length))} {...common} /> : <input {...common} />}
      <span style={{ fontFamily: MONO, fontSize: 9.5, color: T.faint, flexShrink: 0, alignSelf: "center" }}>{spec.multiline ? "⌘↵ · esc" : "↵ · esc"}</span>
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
