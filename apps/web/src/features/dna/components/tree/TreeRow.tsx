import { useEffect, useRef, useState } from "react";
import { isProseStale, isStale, refsOf, type DnaIssue, type DnaNode } from "@/features/dna/lib/novelDna";
import { KIND_EXPLAINER } from "@/features/dna/lib/dnaSchema";
import { detailRowStyle, fieldRowStart, KIND_BG, KIND_COLOR, labelStyle, MONO, SERIF, spineX, T } from "./treeChrome";
import { beatGlyph, beatSlot, hiddenFields, nodeTitle, type ProseRollup } from "./nodeDisplay";
import { type StaleActions } from "./staleActions";
import { Highlighted } from "./search";

// ── Backlinks (#2): the inbound edges — which nodes cross-reference THIS one ───
// refsOf is one-directional (a scene points at its pov/threads/tentpoles…); this shows the inverse so the
// tree reads as a graph, not a list. Each is a jump link (#1). Makes an entity's reach visible — and makes
// delete honest (the same index gates the delete guard, #4).
export function BacklinksRow({ node, backlinks, depth, onJump }: {
  node: DnaNode; backlinks: Map<string, DnaNode[]>; depth: number; onJump?: (id: string) => void;
}) {
  const inbound = backlinks.get(node.id);
  if (!inbound?.length) return null;
  return (
    <div style={detailRowStyle(depth)}>
      {fieldRowStart(depth)}
      <span style={labelStyle}>referenced by</span>
      <span style={{ display: "flex", flexWrap: "wrap", gap: 4, flex: 1, alignItems: "center" }}>
        {inbound.map((n) => (
          <span key={n.id} onClick={() => onJump?.(n.id)} title={onJump ? "jump to node" : undefined}
            style={{ fontFamily: MONO, fontSize: 11, color: T.inkSoft, background: T.raised, border: `1px solid ${T.border}`, borderRadius: 4, padding: "1px 6px", display: "inline-flex", gap: 4, alignItems: "center", cursor: onJump ? "pointer" : "default" }}>
            <span style={{ color: KIND_COLOR[n.kind] ?? T.muted, fontSize: 9.5, letterSpacing: "0.06em", textTransform: "uppercase" }}>{n.kind}</span>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 }}>{nodeTitle(n) || n.id}</span>
          </span>
        ))}
      </span>
    </div>
  );
}

// ── Structural fields (genOnly plan/output data — threads, causality keys, sketch, chapter markers,
// continuity/confusion reads): collapsed behind a toggle chip so a node with nothing there stays silent, and
// a node with a lot of it (a beat/scene mid-book) doesn't dump raw JSON into the row by default. Read-only —
// this data is AI-authored plan/output, not hand-edited (see EditableField for the editable fields).
export function HiddenFieldsRow({ node, index, depth }: { node: DnaNode; index: Map<string, DnaNode>; depth: number }) {
  const [open, setOpen] = useState(false);
  const fields = hiddenFields(node, index);
  if (!fields.length) return null;
  return (
    <div>
      <div style={detailRowStyle(depth)}>
        {fieldRowStart(depth)}
        <span onClick={() => setOpen((v) => !v)}
          style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: T.faint, cursor: "pointer", userSelect: "none" }}>
          {open ? "▾" : "▸"} structural · {fields.length}
        </span>
      </div>
      {open && fields.map((f) => (
        <div key={f.key} style={detailRowStyle(depth)} title={f.note}>
          {fieldRowStart(depth)}
          <span style={{ ...labelStyle, color: T.faint }}>{f.label}</span>
          <span style={{ fontFamily: MONO, fontSize: 11, color: T.muted, whiteSpace: "pre-wrap", wordBreak: "break-word", flex: 1, lineHeight: 1.5 }}>
            {f.value}
          </span>
        </div>
      ))}
    </div>
  );
}

// The compact bar + count chip the rollup renders on its parent row. Three-state hue: all-done green,
// nothing-started grey, anything-between amber (in progress). The segmented bar shows the mix at a glance.
function ProseRollupBadge({ r }: { r: ProseRollup }) {
  const state = r.done === r.total ? "complete" : r.done === 0 && r.stale === 0 ? "none" : "in progress";
  const color = state === "complete" ? T.good : state === "none" ? T.faint : T.stale;
  const title = `prose ${state} — ${r.done} done · ${r.stale} stale · ${r.none} no prose (of ${r.total} scenes)`;
  return (
    <span title={title} style={{ display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
      <span style={{ display: "inline-flex", width: 22, height: 4, borderRadius: 2, overflow: "hidden", background: T.inset, border: `1px solid ${T.border}` }}>
        <span style={{ flex: r.done, background: T.good }} />
        <span style={{ flex: r.stale, background: T.stale }} />
        <span style={{ flex: r.none, background: T.border }} />
      </span>
      <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: "0.06em", color }}>{r.done}/{r.total}</span>
    </span>
  );
}

// ── Node action kebab — groups less-used per-node actions behind a ⋮ button ──
// items = generic list (AI regen, etc.); onDelete is special (confirm dialog lives in the page handler).
export interface KebabItem {
  label: string;
  color?: string;
  onClick: () => void | Promise<void>;
  dividerBefore?: boolean;
}
function NodeKebab({ onDelete, items = [] }: { onDelete?: () => void; items?: KebabItem[] }) {
  const [open, setOpen] = useState(false);
  const [busyIdx, setBusyIdx] = useState<number | null>(null);
  if (!onDelete && !items.length) return null;
  return (
    <span style={{ position: "relative", flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
      <span onClick={() => setOpen((v) => !v)} title="more actions"
        style={{ fontFamily: MONO, fontSize: 14, color: open ? T.ink : T.faint, cursor: "pointer", padding: "0 3px", lineHeight: 1, userSelect: "none", display: "inline-block" }}>⋮</span>
      {open && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 98 }} onClick={() => setOpen(false)} />
          <div style={{ position: "absolute", right: 0, top: "calc(100% + 4px)", zIndex: 99, background: T.raised, border: `1px solid ${T.border}`, borderRadius: 7, padding: "4px 0", minWidth: 192, boxShadow: T.shadow }}>
            {items.map((it, i) => (
              <div key={i}>
                {it.dividerBefore && <div style={{ height: 1, background: T.borderSoft, margin: "3px 0" }} />}
                <div onClick={async (e) => {
                  e.stopPropagation();
                  if (busyIdx !== null) return;
                  setBusyIdx(i);
                  setOpen(false);
                  try { await it.onClick(); } finally { setBusyIdx(null); }
                }} style={{ fontFamily: MONO, fontSize: 11, color: busyIdx === i ? T.faint : (it.color ?? T.inkSoft), cursor: busyIdx === i ? "default" : "pointer", padding: "6px 14px", letterSpacing: "0.04em" }}>
                  {busyIdx === i ? "…" : it.label}
                </div>
              </div>
            ))}
            {onDelete && items.length > 0 && <div style={{ height: 1, background: T.borderSoft, margin: "3px 0" }} />}
            {onDelete && (
              <div onClick={(e) => { e.stopPropagation(); setOpen(false); onDelete(); }}
                style={{ fontFamily: MONO, fontSize: 11, color: T.bad, cursor: "pointer", padding: "6px 14px", letterSpacing: "0.04em" }}>
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
export function TreeRow({ node, index, depth, expandable, open, lockedOpen, onToggle, onDelete, onAttach, kebabItems, draggable, dragging, canDrop, onDragStartRow, onDragEndRow, onDropRow, mark, flash, issues, dimmed, ctx, onContextFocus, prose, headerActions, staleActions, seq, searchPattern }: {
  node: DnaNode; index: Map<string, DnaNode>; depth: number; seq?: number; // seq = global reading-order # (beat/scene)
  expandable: boolean; open: boolean; lockedOpen?: boolean; onToggle: () => void; onDelete?: () => void;
  onAttach?: () => void; // attach this node to the agent's context tray (always-visible row action, not buried in the kebab)
  kebabItems?: KebabItem[]; // regen actions, AI options, etc (all go in the ⋮ menu)
  prose?: ProseRollup | null; // act/beat: rolled-up prose-completion of descendant scenes
  headerActions?: React.ReactNode; // compact action buttons pinned to the header row
  staleActions?: StaleActions;
  // #5 — drag-to-reorder among same-kind siblings. draggable = this row has a grip; canDrop = a valid
  // sibling is being dragged over it; dragging = this is the row being dragged.
  draggable?: boolean; dragging?: boolean; canDrop?: boolean;
  onDragStartRow?: () => void; onDragEndRow?: () => void; onDropRow?: (before: boolean) => void;
  mark?: "edit" | "delete"; flash?: boolean; // mark = proposed change (#1); flash = jump target (#1)
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
  const color = KIND_COLOR[node.kind] ?? T.muted;
  const bg = KIND_BG[node.kind] ?? "transparent";
  const title = nodeTitle(node);
  const glyph = beatGlyph(node);
  const slot = beatSlot(node);
  const markColor = mark === "delete" ? T.bad : mark === "edit" ? T.accent : null;
  // Health glyph — a right-side ▲/△ on a different visual axis than the round stale dot, so they don't fight.
  const hasErr = issues?.some((i) => i.severity === "error") ?? false;
  const hasIssue = (issues?.length ?? 0) > 0;
  // #7 context-highlight hue: the focus node, what it's BUILT FROM (green), what's built ON it (blue).
  const ctxColor = ctx === "focus" ? T.ink : ctx === "consumes" ? T.ctxA : ctx === "consumedBy" ? T.ctxB : null;

  return (
    <div id={`dna-node-${node.id}`}
      onDragOver={canDrop ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; const r = e.currentTarget.getBoundingClientRect(); setDropEdge(e.clientY < r.top + r.height / 2 ? "top" : "bottom"); } : undefined}
      onDragLeave={canDrop ? () => setDropEdge(null) : undefined}
      onDrop={canDrop ? (e) => { e.preventDefault(); onDropRow?.(dropEdge !== "bottom"); setDropEdge(null); } : undefined}
      style={{ position: "relative", transition: "background 0.4s, opacity 0.3s", opacity: dragging ? 0.4 : dimmed ? 0.35 : undefined, background: flash ? `${T.accent}1a` : undefined, boxShadow: flash ? `inset 0 0 0 1px ${T.accent}66` : undefined, borderRadius: flash ? 4 : undefined }}>
      {/* #5 — drop indicator: a line at the edge the dragged sibling would land on */}
      {dropEdge && <div style={{ position: "absolute", left: spineX(depth), right: 12, [dropEdge]: 0, height: 2, background: T.accent, zIndex: 2, pointerEvents: "none" }} />}

      {/* The node row */}
      <div
        onClick={expandable && !lockedOpen ? onToggle : undefined}
        title={lockedOpen ? "Pick or discard the staged options below to collapse this" : undefined}
        style={{
          display: "flex", alignItems: "baseline", gap: 8,
          paddingLeft: depth * 20 + (depth > 0 ? 20 : 4),
          paddingRight: 12, paddingTop: 3, paddingBottom: 3,
          cursor: expandable && !lockedOpen ? "pointer" : "default",
          position: "relative",
          // Precedence (spec collision budget): proposal mark > context hue (#7).
          boxShadow: markColor ? `inset 3px 0 0 ${markColor}` : ctxColor ? `inset 3px 0 0 ${ctxColor}` : undefined,
          background: markColor ? `${markColor}0f` : ctxColor ? `${ctxColor}14` : undefined,
        }}
      >
        {/* Expand/collapse chevron — locked open (dimmed further) while options are staged */}
        <span style={{ width: 12, flexShrink: 0, color: expandable ? `${color}${lockedOpen ? "50" : "90"}` : "transparent", fontSize: 9, lineHeight: 1 }}>
          {expandable ? (open ? "▼" : "▶") : "·"}
        </span>

        {/* Kind badge — also the #7 context-focus trigger (light this node's ref-neighborhood) */}
        <span
          onClick={onContextFocus ? (e) => { e.stopPropagation(); onContextFocus(); } : undefined}
          title={KIND_EXPLAINER[node.kind] + (onContextFocus ? " — click to focus: light what this is built from / what draws on it" : "")}
          style={{
            fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.1em",
            textTransform: "uppercase", color: ctx === "focus" ? T.paper : color, background: ctx === "focus" ? color : bg,
            padding: "1px 5px", borderRadius: 3, border: `1px solid ${ctx === "focus" ? color : `${color}30`}`,
            whiteSpace: "nowrap", flexShrink: 0, cursor: onContextFocus ? "pointer" : "default",
          }}>
          {node.kind}{seq != null && <span style={{ opacity: 0.7, marginLeft: 4 }}>{seq}</span>}
        </span>

        {/* Structure-slot badge — the beat's named function (hook / midpoint / climax…), hover for its job */}
        {slot && (
          <span title={slot.hint} style={{
            fontFamily: MONO, fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase",
            color: T.accent, background: `${T.accent}14`, border: `1px solid ${T.accent}40`,
            padding: "1px 5px", borderRadius: 3, whiteSpace: "nowrap", flexShrink: 0,
          }}>
            {slot.label}
          </span>
        )}

        {/* Title / content preview */}
        {(glyph || title) && (
          <span style={{
            fontFamily: SERIF, fontSize: 14, color: mark === "delete" ? T.remove : T.ink,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1,
            textDecoration: mark === "delete" ? "line-through" : undefined,
          }}>
            {glyph && <span style={{ color: KIND_COLOR.beat, marginRight: 2, fontFamily: MONO, fontSize: 12 }}>{glyph}</span>}
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
            style={{ fontSize: 10, lineHeight: 1, color: hasErr ? T.bad : T.warn, flexShrink: 0 }}>{hasErr ? "▲" : "△"}</span>}
          {markColor && <span style={{ fontFamily: MONO, fontSize: 9, textTransform: "uppercase", letterSpacing: "0.12em", color: markColor }}>{mark === "delete" ? "− remove" : "✎ edit"}</span>}
          {stale && (
            <span ref={staleChipRef} onClick={openStaleCard}
              style={{ fontFamily: MONO, fontSize: 9, textTransform: "uppercase", letterSpacing: "0.12em", color: T.stale, cursor: staleActions ? "pointer" : "default", userSelect: "none" }}>
              stale
            </span>
          )}
          {/* Stale card — fixed-position popover anchored to the chip */}
          {staleCardPos && staleActions && (
            <>
              <div style={{ position: "fixed", inset: 0, zIndex: 49 }} onClick={() => setStaleCardPos(null)} />
              <div style={{ position: "fixed", top: staleCardPos.top, right: staleCardPos.right, zIndex: 50, width: 280, background: T.raised, border: `1px solid ${T.border}`, borderRadius: 8, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10, boxShadow: T.shadow, fontFamily: MONO }}
                onClick={(e) => e.stopPropagation()}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", color: T.stale }}>stale</span>
                  <span onClick={() => setStaleCardPos(null)} style={{ fontSize: 11, color: T.muted, cursor: "pointer" }}>✕</span>
                </div>
                <span style={{ fontSize: 11, color: T.warmText, lineHeight: 1.5 }}>
                  {isProseStale(node) && !isStale(node, index)
                    ? "prose stale — the scene plan changed since it was written"
                    : "an input changed since this was generated"}
                </span>
                {suspects.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    <span style={{ fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", color: T.muted }}>suspects</span>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {suspects.map((n) => (
                        <span key={n.id} style={{ fontSize: 11, color: T.inkSoft, background: T.surface, border: `1px solid ${(KIND_COLOR[n.kind] ?? T.muted)}44`, borderRadius: 3, padding: "1px 6px", display: "inline-flex", gap: 4, alignItems: "center" }}>
                          <span style={{ color: KIND_COLOR[n.kind] ?? T.muted, fontSize: 9.5, letterSpacing: "0.06em", textTransform: "uppercase", flexShrink: 0 }}>{n.kind}</span>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 160 }}>{nodeTitle(n) || n.id}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <div style={{ display: "flex", gap: 6 }}>
                  {staleActions.onRegen && (
                    <span onClick={() => !staleBusy && void runStale("regen", staleActions.onRegen!)}
                      style={{ fontSize: 10, letterSpacing: "0.06em", color: staleBusy === "regen" ? T.faint : T.accent, cursor: staleBusy ? "default" : "pointer", border: `1px solid ${T.accent}44`, borderRadius: 4, padding: "3px 10px", background: `${T.accent}0d` }}>
                      {staleBusy === "regen" ? "…" : "↻ regen"}
                    </span>
                  )}
                  <span onClick={() => !staleBusy && void runStale("approve", staleActions.onApprove)}
                    style={{ fontSize: 10, letterSpacing: "0.06em", color: staleBusy === "approve" ? T.faint : T.good, cursor: staleBusy ? "default" : "pointer", border: `1px solid ${T.good}44`, borderRadius: 4, padding: "3px 10px", background: `${T.good}0d` }}>
                    {staleBusy === "approve" ? "…" : "✓ accept"}
                  </span>
                </div>
              </div>
            </>
          )}
          {node.authoring.locked && <span style={{ fontSize: 10, color: color }}>🔒</span>}
          <span style={{
            width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
            background: node.authoring.status === "accepted" ? (stale ? T.stale : T.good)
              : node.authoring.status === "draft" ? T.warn
                : T.empty,
          }} title={node.authoring.status ?? "empty"} />
          <span style={{ fontFamily: MONO, fontSize: 9, color: T.faint, letterSpacing: "0.05em" }}>
            {node.id}
          </span>
          {draggable && (
            <span draggable
              onClick={(e) => e.stopPropagation()}
              onDragStart={(e) => { e.stopPropagation(); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", node.id); onDragStartRow?.(); }}
              onDragEnd={(e) => { e.stopPropagation(); onDragEndRow?.(); }}
              title="drag to reorder" style={{ fontSize: 11, color: T.faint, cursor: "grab", padding: "0 2px", flexShrink: 0, lineHeight: 1 }}>⠿</span>
          )}
          {onAttach && (
            <span onClick={(e) => { e.stopPropagation(); onAttach(); }} title="add to agent context"
              style={{ fontFamily: MONO, fontSize: 13, color: T.accent, cursor: "pointer", padding: "0 2px", lineHeight: 1, userSelect: "none", flexShrink: 0 }}>
              ＋
            </span>
          )}
          <NodeKebab onDelete={onDelete} items={kebabItems} />
        </span>
      </div>
    </div>
  );
}
