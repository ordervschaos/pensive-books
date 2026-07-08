import { UIFrame } from "../UIFrame";

/**
 * Meters — the shape of your story as plottable axes. Each meter (comedy, heat,
 * tension, a game-score…) carries a reading on every beat, so the whole book's
 * emotional shape draws as a line over the spine. The solid line is the plan;
 * the dotted line is what an editor's read finds the *prose* actually delivers —
 * so plan-vs-delivery gaps are visible at a glance.
 *
 * Mirrors the SerialGraph + meter rows in
 * apps/web/src/features/dna/pages/DnaMetersPage.tsx (each series normalized to
 * its own scale; faint act dividers; solid = plan, dotted = read).
 *
 * Pure server component — the chart is inline SVG, no client JS.
 */

// x for 9 beats, evenly spaced across the 300-wide canvas.
const XS = [10, 45, 80, 115, 150, 185, 220, 255, 290];
const pts = (ys: number[]) => XS.map((x, i) => `${x},${ys[i]}`).join(" ");

// Hand-authored normalized traces (y: smaller = higher on the chart).
const TENSION = [82, 75, 69, 60, 56, 46, 32, 16, 51];
const HEAT = [72, 68, 72, 64, 51, 46, 36, 25, 46];
const COMEDY = [29, 36, 46, 51, 64, 68, 77, 85, 72];
// The editor's read of the prose so far — tension, first five beats, a touch flat.
const TENSION_READ = [83, 78, 72, 65, 60];

// Distinct, theme-legible line colours (the real page cycles a palette).
const C_TENSION = "hsl(var(--pv-accent))";
const C_HEAT = "#d0824a";
const C_COMEDY = "#5f93c2";

const LEGEND: Array<{ name: string; color: string }> = [
  { name: "Tension", color: C_TENSION },
  { name: "Heat", color: C_HEAT },
  { name: "Comedy", color: C_COMEDY },
];

export function MetersMock() {
  return (
    <UIFrame crumb="Salt & Lamplight · meters" bodyClassName="p-4">
      <div className="pv-eyebrow">The shape of your story</div>

      {/* The serial graph: one normalized line per meter over the beat spine. */}
      <div className="mt-3 rounded-xl border border-[hsl(var(--pv-border-soft))] bg-background px-3 py-3">
        <svg
          viewBox="0 0 300 100"
          preserveAspectRatio="none"
          className="block h-[130px] w-full"
        >
          {/* baseline · midline */}
          {[12, 55, 98].map((y) => (
            <line
              key={y}
              x1={10}
              y1={y}
              x2={290}
              y2={y}
              stroke="hsl(var(--pv-border-soft))"
              strokeWidth={1}
              strokeDasharray={y === 55 ? "3 5" : undefined}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {/* act dividers */}
          {[97, 202].map((x) => (
            <line
              key={x}
              x1={x}
              y1={4}
              x2={x}
              y2={100}
              stroke="hsl(var(--pv-text-faint))"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
              opacity={0.35}
            />
          ))}
          {/* comedy + heat (plan) */}
          <polyline
            points={pts(COMEDY)}
            fill="none"
            stroke={C_COMEDY}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            opacity={0.85}
          />
          <polyline
            points={pts(HEAT)}
            fill="none"
            stroke={C_HEAT}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            opacity={0.85}
          />
          {/* tension: the read (dotted) under the plan (solid) */}
          <polyline
            points={pts(TENSION_READ)}
            fill="none"
            stroke={C_TENSION}
            strokeWidth={2}
            strokeDasharray="1 4"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            opacity={0.9}
          />
          <polyline
            points={pts(TENSION)}
            fill="none"
            stroke={C_TENSION}
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
          <circle cx={290} cy={51} r={3} fill={C_TENSION} />
        </svg>

        {/* legend + line key */}
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {LEGEND.map((l) => (
            <span
              key={l.name}
              className="pv-serif flex items-center gap-1.5 text-[12px] text-[hsl(var(--pv-text-muted))]"
            >
              <span
                className="h-[3px] w-3.5 rounded-full"
                style={{ background: l.color }}
              />
              {l.name}
            </span>
          ))}
          <span className="pv-mono ml-auto text-[9px] uppercase tracking-[0.12em] text-[hsl(var(--pv-text-faint))]">
            solid = plan · dotted = read
          </span>
        </div>
      </div>

      {/* One meter's summary row — its identity, shape stats, and a lint. */}
      <div className="mt-3 space-y-2">
        <div className="flex items-center justify-between rounded-lg border border-[hsl(var(--pv-border-soft))] px-3 py-2">
          <span className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 rounded-[2px]"
              style={{ background: C_TENSION }}
            />
            <span className="pv-serif text-[13px] font-medium text-foreground">
              Tension
            </span>
          </span>
          <span className="pv-mono text-[10px] tracking-wide text-[hsl(var(--pv-text-faint))]">
            peaks act III · 6 turns
          </span>
        </div>
        <p className="pv-serif flex gap-2 px-1 text-[12px] leading-snug text-[hsl(var(--pv-text-muted))]">
          <span className="text-amber-600 dark:text-amber-500">●</span>
          <span>
            <span className="font-medium text-foreground">read_gap</span> — the
            prose runs cooler than the plan through Act I. Send it to the editor?
          </span>
        </p>
      </div>
    </UIFrame>
  );
}
