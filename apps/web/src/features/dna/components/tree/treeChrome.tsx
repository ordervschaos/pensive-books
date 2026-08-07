// Shared visual atoms for the DNA tree surface: the Console token set (two skins), the kind color
// maps, and the row geometry/styles every row, field, and panel hangs off. No data logic here.
//
// ── Console tokens — two named skins ──────────────────────────────────────────
// The DNA studio's formalized skins (docs/dna-studio-redesign-handoff.md §3/§8-1):
//   • Console-on-Paper — the default. Neutrals mirror `.theme-paper`'s --pv-* primitives
//     (packages/shared/src/styles/tokens.css).
//   • Terminal — the original dark mono console, now a real theme: picked app-wide as the
//     "Terminal" theme (ThemeProvider), CSS-var side defined as `.theme-terminal` in tokens.css.
// TS hex constants (not CSS vars) because the tree styles inline and composes alpha suffixes
// (`${c}22`), which CSS vars can't do. `T`/`KIND_COLOR`/`KIND_BG` are MUTABLE objects with stable
// identity — setConsoleTheme() swaps their contents; StudioTreePage calls it from the app theme and
// remounts the studio (key=mode) so every inline style recomputes. Mono stays the structural voice
// (labels, badges, meta); Newsreader serif carries content the author reads/writes.
export const MONO = "'JetBrains Mono', ui-monospace, Menlo, monospace";
export const SERIF = "'Newsreader', 'Iowan Old Style', Georgia, serif";

export type ConsoleThemeName = "paper" | "terminal";

interface ConsolePalette {
  bg: string;         // the page
  surface: string;    // wells, group strips
  raised: string;     // popovers, modals, docks — lifted above the page
  inset: string;      // recessed: progress tracks
  inputBg: string;    // text inputs
  border: string;
  borderSoft: string;
  ink: string;        // titles, values
  inkSoft: string;    // strong secondary
  muted: string;      // labels, meta
  faint: string;      // hints, disabled, empty
  accent: string;     // THE action color
  good: string;       // accepted / pass
  warn: string;       // draft
  stale: string;      // stale dot/ring — distinct from the beat/draft hue on purpose
  bad: string;        // errors, destructive
  empty: string;      // the "empty" status dot / neutral swatch
  add: string;        // proposal additions / new-text diff ink
  addSoft: string;    // quieter add (notes, phantom field keys)
  remove: string;     // proposed-delete / old-text strike ink
  ctxA: string;       // #7 context: what the focus node is BUILT FROM (green)
  ctxB: string;       // #7 context: what DRAWS ON the focus node (blue)
  mark: string;       // search-match highlight bg
  markInk: string;    // search-match highlight text
  warmText: string;   // stale explanations / "what's left" gaps
  staleProse: string; // stale prose body text
  paper: string;      // ink over a filled kind-color chip
  hover: string;
  shadow: string;
  lines: string[];    // meter line palette (cycled), legible on this skin's canvas
}

// Console-on-Paper — every hue a 600–800-weight ink, ≥4:1 on #f6f3ec.
const PAPER: ConsolePalette = {
  bg: "#f6f3ec", surface: "#efeae0", raised: "#fcfaf5", inset: "#eae4d6", inputBg: "#ffffff",
  border: "#d9d3c5", borderSoft: "#e5dfd2",
  ink: "#1f1d18", inkSoft: "#45413a", muted: "#6f6a5e", faint: "#a39d8e",
  accent: "#7a2d20", good: "#25823f", warn: "#a16207", stale: "#d97706", bad: "#b3372b",
  empty: "#c5bca8", add: "#2f7d46", addSoft: "#517a5e", remove: "#a3564a",
  ctxA: "#2f7d46", ctxB: "#3b5bdb",
  mark: "#f2c94c55", markInk: "#6d5310", warmText: "#8a6116", staleProse: "#8a7a4a",
  paper: "#fdfcf7", hover: "rgba(31,29,24,0.05)", shadow: "0 8px 30px rgba(31,29,24,0.14)",
  lines: ["#b45309", "#0369a1", "#15803d", "#be185d", "#6d28d9", "#c2410c", "#0f766e", "#b3372b"],
};

// Terminal — the original dark mono console, preserved verbatim from the pre-redesign palette.
const TERMINAL: ConsolePalette = {
  bg: "#0a0a0a", surface: "#16161a", raised: "#111118", inset: "#16161c", inputBg: "#16161c",
  border: "#2a2a3a", borderSoft: "#1e1e28",
  ink: "#e6e6e6", inkSoft: "#cfcfcf", muted: "#888888", faint: "#555555",
  accent: "#8a8aff", good: "#4ade80", warn: "#fbbf24", stale: "#f59e0b", bad: "#f87171",
  empty: "#444444", add: "#60a070", addSoft: "#6a8a72", remove: "#9a7070",
  ctxA: "#60a070", ctxB: "#6a8aff",
  mark: "#f5c84233", markInk: "#f5c842", warmText: "#c8a060", staleProse: "#8a8060",
  paper: "#0a0a0a", hover: "rgba(255,255,255,0.05)", shadow: "0 8px 30px #000000aa",
  lines: ["#fbbf24", "#38bdf8", "#4ade80", "#f472b6", "#a78bfa", "#fb923c", "#2dd4bf", "#f87171"],
};

// ── Kind color map — groups: spine (seed→pillar), entities, structure, leaf ───
// One hue per kind in both skins; family relationships preserved (violet spine, cyan entities,
// orange/ochre structure, green leaf, magenta threads). Key ORDER is load-bearing (search group
// order) — keep both maps in the same order.
const KIND_COLOR_PAPER: Record<string, string> = {
  seed: "#6d28d9",       // violet — the origin
  premise: "#4f46e5",    // indigo
  pillar: "#3730a3",     // indigo darker
  character: "#0369a1",  // sky — entities
  relationship: "#0e7490",
  world_fact: "#475569",
  location: "#0f766e",   // teal — places (a sensory palette, not a rule)
  tentpole: "#52679a",
  game: "#2563eb",
  voice_profile: "#86198f",
  meter: "#4d7c0f",
  thread: "#be185d",     // magenta — cross-cutting promises
  act: "#c2410c",   // burnt orange — acts
  beat: "#a16207",       // ochre — causal units
  scene: "#15803d",      // green — the leaf scenes
};

const KIND_COLOR_TERMINAL: Record<string, string> = {
  seed: "#a78bfa",
  premise: "#818cf8",
  pillar: "#6366f1",
  character: "#38bdf8",
  relationship: "#7dd3fc",
  world_fact: "#bae6fd",
  location: "#5eead4",
  tentpole: "#e0f2fe",
  game: "#93c5fd",
  voice_profile: "#e879f9",
  meter: "#a3e635",
  thread: "#f9a8d4",
  act: "#fb923c",
  beat: "#fbbf24",
  scene: "#4ade80",
};

// Live token objects — stable identity, contents swapped by setConsoleTheme().
export const T: ConsolePalette = { ...PAPER };
export const KIND_COLOR: Record<string, string> = { ...KIND_COLOR_PAPER };
// Badge tint: an 8%-alpha wash of the kind hue — derived, so it can't drift from KIND_COLOR.
export const KIND_BG: Record<string, string> = {};

let activeConsoleTheme: ConsoleThemeName | null = null;

/** Swap the console skin in place. Idempotent; call before rendering the studio (StudioTreePage does). */
export function setConsoleTheme(mode: ConsoleThemeName) {
  if (activeConsoleTheme === mode) return;
  activeConsoleTheme = mode;
  Object.assign(T, mode === "terminal" ? TERMINAL : PAPER);
  Object.assign(KIND_COLOR, mode === "terminal" ? KIND_COLOR_TERMINAL : KIND_COLOR_PAPER);
  for (const k of Object.keys(KIND_COLOR)) KIND_BG[k] = `${KIND_COLOR[k]}14`;
  // Refresh the shared style atoms that bake token values in (module objects, stable identity).
  labelStyle.color = T.muted;
  Object.assign(inputStyle, { color: T.ink, background: T.raised, border: `1px solid ${T.border}` });
}

// ── Shared geometry + atoms for a detail field row ────────────────────────────
// spineX = x of the chevron's CENTER for a node at this depth. Row paddingLeft is depth*20+(depth>0?20:4)
// and the chevron is a 12px span at the start, so its center sits 6px in. Every vertical rail/connector
// hangs off this so the line drops dead-center through the chevron above it.
export const spineX = (depth: number) => depth * 20 + (depth > 0 ? 26 : 10);
export const detailRowStyle = (depth: number): React.CSSProperties => ({ position: "relative", display: "flex", alignItems: "baseline", gap: 8, paddingLeft: depth * 20 + 20, paddingRight: 12, paddingTop: 1, paddingBottom: 1 });
export const labelStyle: React.CSSProperties = { fontFamily: MONO, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: T.muted, width: 92, flexShrink: 0, textAlign: "right" };
// Tree connector lines removed — indentation alone carries the hierarchy. Kept as a no-op so the many
// detail-row call sites (fieldRowStart, OpDiffBlock, etc.) don't all need editing.
export const ConnectorTick = (_: { depth: number }) => null;
export const fieldRowStart = (depth: number) => (
  <>
    <ConnectorTick depth={depth} />
    <span style={{ width: 12, flexShrink: 0 }} />
  </>
);
export const inputStyle: React.CSSProperties = { fontFamily: SERIF, fontSize: 14, color: T.ink, background: T.raised, border: `1px solid ${T.border}`, borderRadius: 6, padding: "3px 8px", lineHeight: 1.5, outline: "none" };

// Initialize the derived maps (KIND_BG) for the default skin.
setConsoleTheme("paper");

// A view-toggle chip for the fixed quick bar — lit in its accent when active.

export function QuickToggle({ active, accent, label, icon, onClick, title }: { active: boolean; accent: string; label: string; icon: string; onClick: () => void; title?: string }) {
  return (
    <button onClick={onClick} title={title ?? label} style={{
      display: "flex", alignItems: "center", gap: 5, cursor: "pointer",
      background: active ? `${accent}14` : "transparent", border: `1px solid ${active ? `${accent}55` : "transparent"}`,
      borderRadius: 6, padding: "3px 9px", fontFamily: MONO, fontSize: 10.5,
      letterSpacing: "0.08em", textTransform: "uppercase", color: active ? accent : T.muted,
    }}>
      <span style={{ fontSize: 11, lineHeight: 1 }}>{icon}</span>
      <span>{label}</span>
    </button>
  );
}
