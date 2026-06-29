// DnaMetersPage — /books/:slug/dna/meters
// The meters dashboard (docs/novel-dna-meters.md): lists every `meter` node and plots the SERIAL ones (those
// carrying ≥2 readings across the beat spine) on one shared serial graph. Each meter is normalized to its own
// scale so axes with different ranges (comedy 0..100, affect −100..100, a game-score) coexist on one chart.
// Pure projection of the live tree — nothing generates here. Nav suppressed (a dev DNA route, like the tree).
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  beatsInOrder, byId, childrenOf, isSerialMeter, meterSeries, meterShape, validate,
  type DnaNode, type MeterContent, type DnaIssue,
} from "@/lib/novelDna";

const getNumericId = (p: string | undefined) => { const m = p?.match(/^(\d+)/); return m ? parseInt(m[1]) : 0; };

// A distinct line color per meter (cycled). Kept legible on the dark canvas.
const LINE_COLORS = ["#fbbf24", "#38bdf8", "#4ade80", "#f472b6", "#a78bfa", "#fb923c", "#2dd4bf", "#f87171"];

// Severity → dot color for a lint badge.
const LINT_COLOR: Record<string, string> = { error: "#f87171", warn: "#fbbf24" };

// ── The serial graph: one normalized line per serial meter over the beat spine ──────────────────────────
// x = beat index (the PLAN layer meterSeries walks). Each meter maps its own [min,max] → [0,1] so unlike-scaled
// meters share the canvas; the legend carries the real values. Faint act dividers mark movement boundaries.
function SerialGraph({ nodes, meters, colorOf }: { nodes: DnaNode[]; meters: DnaNode[]; colorOf: (id: string) => string }) {
  const beats = beatsInOrder(nodes);
  const n = beats.length;
  if (n < 2 || !meters.length) return null;
  const W = 1000, H = 240, PAD_X = 12, PAD_Y = 14;
  const x = (i: number) => PAD_X + (i / (n - 1)) * (W - 2 * PAD_X);
  // y maps a normalized 0..1 to canvas (1 at top).
  const y = (norm: number) => PAD_Y + (1 - norm) * (H - 2 * PAD_Y);

  // act boundaries: count beats per movement in order → cumulative x positions
  const index = byId(nodes);
  const movements = nodes.filter((nn) => nn.kind === "movement").sort((a, b) => a.position - b.position);
  const bounds: number[] = []; let acc = 0;
  for (const m of movements) {
    const c = childrenOf(nodes, m.id).filter((b) => b.kind === "beat").length;
    acc += c; if (acc > 0 && acc < n) bounds.push(acc);
  }

  const normOf = (m: DnaNode) => {
    const c = m.content as MeterContent;
    const series = meterSeries(nodes, m.id);
    const ys = series.map((p) => p.value).filter((v): v is number => v != null);
    const lo = c.scale?.min ?? Math.min(...ys);
    const hi = c.scale?.max ?? Math.max(...ys);
    const span = hi - lo || 1;
    return series.map((p) => (p.value == null ? null : (p.value - lo) / span));
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height: H, display: "block" }}>
      {/* frame baseline + midline */}
      {[0, 0.5, 1].map((g) => (
        <line key={g} x1={PAD_X} y1={y(g)} x2={W - PAD_X} y2={y(g)} stroke="#333" strokeWidth={1} strokeDasharray={g === 0.5 ? "3 5" : undefined} vectorEffect="non-scaling-stroke" opacity={0.5} />
      ))}
      {/* act dividers */}
      {bounds.map((b, i) => (
        <line key={`b${i}`} x1={x(b - 0.5)} y1={0} x2={x(b - 0.5)} y2={H} stroke="#555" strokeWidth={1} vectorEffect="non-scaling-stroke" opacity={0.4} />
      ))}
      {/* one polyline per meter; null gaps split the line into segments (don't bridge a never-read stretch) */}
      {meters.map((m) => {
        const norms = normOf(m);
        const color = colorOf(m.id);
        const segments: string[][] = [[]];
        norms.forEach((v, i) => {
          if (v == null) { if (segments[segments.length - 1].length) segments.push([]); return; }
          segments[segments.length - 1].push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`);
        });
        return (
          <g key={m.id}>
            {segments.filter((s) => s.length).map((pts, si) => (
              <polyline key={si} points={pts.join(" ")} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" opacity={0.92} />
            ))}
            {/* end dot at the last real value */}
            {(() => { const li = norms.map((v, i) => (v == null ? -1 : i)).reduce((a, b) => Math.max(a, b), -1); return li >= 0 ? <circle cx={x(li)} cy={y(norms[li]!)} r={3} fill={color} /> : null; })()}
          </g>
        );
      })}
    </svg>
  );
}

// ── One meter's summary row (its identity + shape stats + lints) ────────────────────────────────────────
function MeterRow({ nodes, meter, color, serial, issues }: { nodes: DnaNode[]; meter: DnaNode; color: string; serial: boolean; issues: DnaIssue[] }) {
  const c = meter.content as MeterContent;
  const series = meterSeries(nodes, meter.id);
  const shape = meterShape(series);
  const reads = series.filter((p) => p.value != null).length;
  const mine = issues.filter((i) => i.nodeId === meter.id);
  return (
    <div style={{ borderBottom: "1px solid #1c1c1c", padding: "10px 0", display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 10, height: 10, borderRadius: 2, background: serial ? color : "#444", flexShrink: 0 }} />
        <span style={{ fontWeight: 600, color: "#e5e5e5" }}>{c.name ?? meter.id}</span>
        {c.kind && <span style={{ fontSize: 11, color: "#888", border: "1px solid #333", borderRadius: 4, padding: "0 5px" }}>{c.kind}</span>}
        {!serial && <span style={{ fontSize: 11, color: "#666" }}>· {reads === 0 ? "no readings yet" : "1 reading (need ≥2 to plot)"}</span>}
        {serial && <span style={{ fontSize: 11, color: "#888" }}>· last {shape.last} · range {shape.range} · {shape.oscillations} turns</span>}
      </div>
      {(c.poles?.low || c.poles?.high) && (
        <div style={{ fontSize: 11, color: "#777", paddingLeft: 18 }}>
          {c.scale ? `[${c.scale.min ?? "?"}…${c.scale.max ?? "?"}] ` : ""}{c.poles?.low ? `low: ${c.poles.low}` : ""}{c.poles?.low && c.poles?.high ? "  ·  " : ""}{c.poles?.high ? `high: ${c.poles.high}` : ""}
        </div>
      )}
      {mine.map((i, k) => (
        <div key={k} style={{ fontSize: 11, color: "#aaa", paddingLeft: 18, display: "flex", gap: 6, alignItems: "baseline" }}>
          <span style={{ color: LINT_COLOR[i.severity] ?? "#fbbf24" }}>●</span>
          <span style={{ color: LINT_COLOR[i.severity] ?? "#fbbf24", fontWeight: 600 }}>{i.rule}</span>
          <span>{i.message}</span>
        </div>
      ))}
    </div>
  );
}

export default function DnaMetersPage() {
  const { bookSlug } = useParams<{ bookSlug: string }>();
  const bookId = getNumericId(bookSlug);
  const [nodes, setNodes] = useState<DnaNode[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // initial load
  useEffect(() => {
    if (!bookId) { setError("no book id"); return; }
    void supabase.from("book_nodes").select("*").eq("book_id", bookId).order("position")
      .then(({ data, error: err }) => { if (err) setError(err.message); else setNodes((data ?? []) as DnaNode[]); });
  }, [bookId]);

  // live subscription (refresh = no-op: the page is a projection of server state)
  useEffect(() => {
    if (!bookId) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const soon = () => { if (t) clearTimeout(t); t = setTimeout(() => void supabase.from("book_nodes").select("*").eq("book_id", bookId).order("position").then(({ data }) => { if (data) setNodes(data as DnaNode[]); }), 400); };
    const ch = supabase.channel(`meters_${bookId}_${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "book_nodes", filter: `book_id=eq.${bookId}` }, soon)
      .subscribe();
    return () => { if (t) clearTimeout(t); void supabase.removeChannel(ch); };
  }, [bookId]);

  const { meters, serialMeters, colorOf, issues } = useMemo(() => {
    const ns = nodes ?? [];
    const meters = ns.filter((n) => n.kind === "meter").sort((a, b) => a.position - b.position);
    const serialMeters = meters.filter((m) => isSerialMeter(ns, m.id));
    const colorMap = new Map(serialMeters.map((m, i) => [m.id, LINE_COLORS[i % LINE_COLORS.length]]));
    const colorOf = (id: string) => colorMap.get(id) ?? "#888";
    const issues = validate(ns).filter((i) => ["flat_meter", "no_oscillation", "no_jeopardy"].includes(i.rule));
    return { meters, serialMeters, colorOf, issues };
  }, [nodes]);

  if (error) return <div style={{ padding: 24, color: "#f87171", fontFamily: "monospace" }}>error: {error}</div>;
  if (!nodes) return <div style={{ padding: 24, color: "#888", fontFamily: "monospace" }}>loading…</div>;

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0a", color: "#ddd", padding: "24px 28px", fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      <div style={{ maxWidth: 1080, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, letterSpacing: -0.2 }}>Meters</h1>
          <a href={`/books/${bookSlug}/dna/tree`} style={{ fontSize: 12, color: "#7dd3fc", textDecoration: "none" }}>← tree</a>
        </div>
        <p style={{ fontSize: 12, color: "#777", marginTop: 0, marginBottom: 18 }}>
          The story's tracked axes (docs/novel-dna-meters.md). Serial meters — those with readings across ≥2 beats — plot below, each normalized to its own scale.
        </p>

        {meters.length === 0 ? (
          <div style={{ fontSize: 13, color: "#777", border: "1px dashed #2a2a2a", borderRadius: 8, padding: 20 }}>
            No meters yet. Add a <code style={{ color: "#fbbf24" }}>meter</code> node off the pillar (e.g. comedy, heat, a game-score), then give beats <code style={{ color: "#fbbf24" }}>readings</code> on it.
          </div>
        ) : (
          <>
            {serialMeters.length > 0 && (
              <div style={{ border: "1px solid #1c1c1c", borderRadius: 8, padding: "14px 12px 6px", marginBottom: 18, background: "#0e0e0e" }}>
                <SerialGraph nodes={nodes} meters={serialMeters} colorOf={colorOf} />
                <div style={{ display: "flex", flexWrap: "wrap", gap: 14, padding: "8px 4px 2px" }}>
                  {serialMeters.map((m) => {
                    const c = m.content as MeterContent;
                    return (
                      <span key={m.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#bbb" }}>
                        <span style={{ width: 14, height: 3, borderRadius: 2, background: colorOf(m.id) }} />
                        {c.name ?? m.id}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}
            <div>
              {meters.map((m) => (
                <MeterRow key={m.id} nodes={nodes} meter={m} color={colorOf(m.id)} serial={serialMeters.includes(m)} issues={issues} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
