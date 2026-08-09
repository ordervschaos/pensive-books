// RelationGraph — the reader's model as a picture: who/what exists and how it is tied together.
//
// Deterministic radial layout, not force-directed. A force simulation would re-arrange itself every
// time the scrubber moves, so the same character would sit somewhere new at every unit and the eye
// would lose them. Position here is a pure function of the entity's id, so a node NEVER moves for
// the life of the run — the only things that change as you scrub are size (importance), opacity
// (activation — how live it is in mind right now), and which edges are drawn.
import { useMemo } from "react";
import { importance, type BrainState, type Entity } from "../lib/brain";

// Valence is a DIVERGING scale (hostile ↔ warm), so it gets two opposed poles and a neutral middle,
// never a rainbow and never a hue at the midpoint — the blue↔red diverging pair from the validated
// palette, with gray for "merely connected".
const edgeColor = (v: number): string =>
  v <= -1 ? "var(--rel-hostile)" : v >= 1 ? "var(--rel-warm)" : "var(--edge-neutral)";

// KIND IS ENCODED BY RING, not by hue. Five entity kinds would need five categorical slots, and only
// three clear the all-pairs CVD floor — and a graph is read all-pairs. Position carries kind here
// (people at the centre, places on the rim, the rest between), so colour is free to stay inside the
// validated set: two hues for the kinds that dominate, neutral for the rest, plus direct labels.
const KIND_RING: Record<Entity["kind"], number> = {
  character: 0.50,   // people at the centre — the story is about them
  object: 0.66,
  faction: 0.78,
  place: 0.90,       // places on the rim; they contain everything else
  concept: 1.0,
};

/** Stable angle from an id — same hash, same seat, forever. */
function seat(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return (h % 3600) / 3600;
}

export function RelationGraph({ state, size = 380, onPick, selected }: {
  state: BrainState;
  size?: number;
  onPick?: (id: string) => void;
  selected?: string | null;
}) {
  const nodes = useMemo(() => {
    const all = Object.values(state.entities);
    const maxImp = Math.max(1, ...all.map((e) => importance(state, e.id)));
    const r = size / 2;
    return all.map((e) => {
      const a = seat(e.id) * Math.PI * 2;
      const ring = KIND_RING[e.kind] ?? 0.7;
      const imp = importance(state, e.id) / maxImp;
      return {
        e,
        x: r + Math.cos(a) * r * ring * 0.82,
        y: r + Math.sin(a) * r * ring * 0.82,
        // Importance sets the radius; activation sets the opacity. Two different questions —
        // "does this matter to the book" vs "is it in mind right now" — never collapsed into one.
        rad: 3 + imp * 9,
        alpha: 0.22 + Math.min(1, e.activation / 2) * 0.78,
      };
    });
  }, [state, size]);

  const pos = useMemo(() => Object.fromEntries(nodes.map((n) => [n.e.id, n])), [nodes]);

  if (!nodes.length) {
    return <p className="py-8 text-center text-xs" style={{ color: "var(--ink-3)" }}>nothing in mind yet</p>;
  }

  return (
    <svg width="100%" viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Reader's entity graph">
      {state.relations.map((rel, i) => {
        const a = pos[rel.from], b = pos[rel.to];
        if (!a || !b) return null;
        const live = Math.min(1, (a.e.activation + b.e.activation) / 3);
        const on = selected && (rel.from === selected || rel.to === selected);
        return (
          <line
            key={`${rel.from}-${rel.to}-${rel.kind}-${i}`}
            x1={a.x} y1={a.y} x2={b.x} y2={b.y}
            stroke={edgeColor(rel.valence)}
            strokeWidth={on ? 2.5 : 1.5}
            strokeOpacity={selected ? (on ? 0.95 : 0.08) : 0.2 + live * 0.55}
          >
            <title>{`${a.e.name} → ${b.e.name}: ${rel.kind}`}</title>
          </line>
        );
      })}
      {nodes.map((n) => (
        <g key={n.e.id} onClick={() => onPick?.(n.e.id)} style={{ cursor: onPick ? "pointer" : "default" }}>
          <circle
            cx={n.x} cy={n.y} r={n.rad}
            fill={`var(--kind-${n.e.kind})`}
            fillOpacity={selected && selected !== n.e.id ? n.alpha * 0.25 : n.alpha}
            stroke="var(--surface-1)" strokeWidth={2}
          />
          {/* Direct labels on whatever is currently live — identity is never colour alone. */}
          {(n.e.activation > 0.5 || n.e.id === selected) && (
            <text
              x={n.x} y={n.y - n.rad - 4} textAnchor="middle"
              style={{ fontSize: 9, fill: "var(--ink-2)", pointerEvents: "none" }}
            >
              {n.e.name.length > 16 ? `${n.e.name.slice(0, 15)}…` : n.e.name}
            </text>
          )}
          <title>{`${n.e.name} · ${n.e.kind} · ${n.e.mentions} mentions`}</title>
        </g>
      ))}
    </svg>
  );
}
