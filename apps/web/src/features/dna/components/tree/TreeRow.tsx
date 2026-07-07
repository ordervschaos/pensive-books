import { useEffect, useRef, useState } from "react";
import { isProseStale, isStale, refsOf, type DnaIssue, type DnaNode } from "@/features/dna/lib/novelDna";
import { KIND_EXPLAINER } from "@/features/dna/lib/dnaSchema";
import { detailRowStyle, fieldRowStart, KIND_BG, KIND_COLOR, labelStyle, spineX } from "./treeChrome";
import { beatGlyph, nodeTitle, type ProseRollup } from "./nodeDisplay";
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
export function TreeRow({ node, index, depth, expandable, open, lockedOpen, onToggle, onDelete, onAttach, kebabItems, draggable, dragging, canDrop, onDragStartRow, onDragEndRow, onDropRow, mark, focus, flash, issues, dimmed, ctx, onContextFocus, prose, headerActions, staleActions, writingProse, seq, searchPattern }: {
  node: DnaNode; index: Map<string, DnaNode>; depth: number; seq?: number; // seq = global reading-order # (beat/scene)
  expandable: boolean; open: boolean; lockedOpen?: boolean; onToggle: () => void; onDelete?: () => void;
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
        onClick={expandable && !lockedOpen ? onToggle : undefined}
        title={lockedOpen ? "Pick or discard the staged options below to collapse this" : undefined}
        style={{
          display: "flex", alignItems: "baseline", gap: 8,
          paddingLeft: depth * 20 + (depth > 0 ? 20 : 4),
          paddingRight: 12, paddingTop: 3, paddingBottom: 3,
          cursor: expandable && !lockedOpen ? "pointer" : "default",
          position: "relative",
          // Precedence (spec collision budget): proposal mark > context hue (#7) > rail focus (#2).
          boxShadow: markColor ? `inset 3px 0 0 ${markColor}` : ctxColor ? `inset 3px 0 0 ${ctxColor}` : focus ? "inset 2px 0 0 #8a8aff66" : undefined,
          background: markColor ? `${markColor}12` : ctxColor ? `${ctxColor}1a` : focus ? "#8a8aff08" : undefined,
        }}
      >
        {/* Expand/collapse chevron — locked open (dimmed further) while options are staged */}
        <span style={{ width: 12, flexShrink: 0, color: expandable ? `${color}${lockedOpen ? "40" : "80"}` : "transparent", fontSize: 9, lineHeight: 1 }}>
          {expandable ? (open ? "▼" : "▶") : "·"}
        </span>

        {/* Kind badge — also the #7 context-focus trigger (light this node's ref-neighborhood) */}
        <span
          onClick={onContextFocus ? (e) => { e.stopPropagation(); onContextFocus(); } : undefined}
          title={KIND_EXPLAINER[node.kind] + (onContextFocus ? " — click to focus: light what this is built from / what draws on it" : "")}
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
