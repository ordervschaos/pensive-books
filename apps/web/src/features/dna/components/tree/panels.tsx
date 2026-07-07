// The tree tab's satellite panels: VoiceFeelPanel (taste), JourneyStrip (place),
// FocusPanel (what controls this), SpineTimeline (reading-order filmstrip).
import { useState } from "react";
import { isProseStale, isStale, refsOf, type BeatContent, type DnaNode, type NodeKind, type SceneContent } from "@/features/dna/lib/novelDna";
import { tasteSpecs, type EditSpec } from "@/features/dna/lib/dnaSchema";
import { buildJourney, DNA_STAGES, stageProgress, type StageKey } from "@/features/dna/lib/dnaJourney";
import { KIND_COLOR } from "./treeChrome";
import { nodeTitle } from "./nodeDisplay";
import { EditableField } from "./EditableField";

// ── Voice & Feel panel (#2 — taste lives here) ────────────────────────────────
// Aim 2: TASTE is user-owned and subjective (premise tone, pillar controlling idea, the whole voice profile,
// each character's idiolect) but it's scattered across four tree depths, so it reads as "more work than
// writing." This pins every `taste` field (tagged in dnaSchema, the SSOT) into ONE surface at the top of the
// tree. The MACHINERY (state keys, thread roles, grounds_in — the genOnly fields) is the AI's to maintain
// and stays hidden from the editor entirely. Reuses EditableField so edits flow through the same save path,
// and each group title jumps to the full node in the tree below.
// `asPage` renders it as the body of its own /dna/tree/taste tab (always open, no collapse chrome) instead of
// pinned atop the tree — keeps the taste fields from interleaving with the structural tree.
export function VoiceFeelPanel({ nodes, index, onJump, asPage }: { nodes: DnaNode[]; index: Map<string, DnaNode>; onJump: (id: string) => void; asPage?: boolean }) {
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
export function JourneyStrip({ nodes, onGoStage }: {
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
export function FocusPanel({ node, index, consumes, consumedBy, onJump, onClear, bottomInset = 16, staleActions }: {
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

// ── Spine timeline — the SERIAL structure (reading order) ─────────────────────
// The tree shows HIERARCHY (grouped, collapsible); this shows the SPINE as it's actually experienced —
// acts left→right, beats ordered within each, scenes ordered within each. A filmstrip of the story's
// flow + completion: each scene cell is colored by whether its prose is written / stale / still just planned,
// so "where the draft actually stands" reads in one glance. Clicking any unit jumps to it in the tree.
export function SpineTimeline({ nodes, rightInset, bookId, onJump, onClose }: {
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
