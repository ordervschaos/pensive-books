// Shared visual atoms for the DNA tree surface: the kind color maps and the row
// geometry/styles every row, field, and panel hangs off. No data logic here.

// ── Kind color map — groups: spine (seed→pillar), entities, structure, leaf ───
export const KIND_COLOR: Record<string, string> = {
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

export const KIND_BG: Record<string, string> = {
  seed: "#1e1a2e", premise: "#1a1a2e", pillar: "#16163a",
  character: "#0c1e2e", relationship: "#0c1e2e", world_fact: "#0c1e2e", location: "#031e1a", tentpole: "#0c1e2e", game: "#0c1e2e",
  thread: "#2a1020",
  act: "#1e1200", beat: "#1e1600", scene: "#001a10",
};

// ── Shared geometry + atoms for a detail field row ────────────────────────────
// spineX = x of the chevron's CENTER for a node at this depth. Row paddingLeft is depth*20+(depth>0?20:4)
// and the chevron is a 12px span at the start, so its center sits 6px in. Every vertical rail/connector
// hangs off this so the line drops dead-center through the chevron above it.
export const spineX = (depth: number) => depth * 20 + (depth > 0 ? 26 : 10);
export const detailRowStyle = (depth: number): React.CSSProperties => ({ position: "relative", display: "flex", alignItems: "baseline", gap: 8, paddingLeft: depth * 20 + 20, paddingRight: 12, paddingTop: 1, paddingBottom: 1 });
export const labelStyle: React.CSSProperties = { fontFamily: "ui-monospace, monospace", fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "#5c5c5c", width: 92, flexShrink: 0, textAlign: "right" };
// Tree connector lines removed — indentation alone carries the hierarchy. Kept as a no-op so the many
// detail-row call sites (fieldRowStart, OpDiffBlock, etc.) don't all need editing.
export const ConnectorTick = (_: { depth: number }) => null;
export const fieldRowStart = (depth: number) => (
  <>
    <ConnectorTick depth={depth} />
    <span style={{ width: 12, flexShrink: 0 }} />
  </>
);
export const inputStyle: React.CSSProperties = { fontFamily: "ui-monospace, monospace", fontSize: 12, color: "#e6e6e6", background: "#16161a", border: "1px solid #3a3a55", borderRadius: 3, padding: "3px 6px", lineHeight: 1.5, outline: "none" };

// A view-toggle chip for the fixed quick bar — lit in its accent when active.

export function QuickToggle({ active, accent, label, icon, onClick }: { active: boolean; accent: string; label: string; icon: string; onClick: () => void }) {
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
