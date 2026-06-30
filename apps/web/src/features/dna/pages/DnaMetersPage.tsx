// DnaMetersPage — /books/:slug/dna/meters
// The meters dashboard (docs/novel-dna-meters.md): lists every `meter` node and plots the SERIAL ones (those
// carrying ≥2 readings across the beat spine) on one shared serial graph. Each meter is normalized to its own
// scale so axes with different ranges (comedy 0..100, affect −100..100, a game-score) coexist on one chart.
// Pure projection of the live tree — nothing generates here. Nav suppressed (a dev DNA route, like the tree).
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  beatsInOrder, byId, childrenOf, isSerialMeter, meterSeries, meterShape, meterTarget, observedSeries, validate,
  type DnaNode, type MeterContent, type DnaIssue, type MeterPoint,
} from "@/features/dna/lib/novelDna";
import { buildMeterReadInput, invokeMeterRead, observedFindingsMessage, sendFindingsToEditor, writeObserved } from "@/features/dna/lib/meterRead";

const getNumericId = (p: string | undefined) => { const m = p?.match(/^(\d+)/); return m ? parseInt(m[1]) : 0; };

// A distinct line color per meter (cycled). Kept legible on the dark canvas.
const LINE_COLORS = ["#fbbf24", "#38bdf8", "#4ade80", "#f472b6", "#a78bfa", "#fb923c", "#2dd4bf", "#f87171"];

// Severity → dot color for a lint badge.
const LINT_COLOR: Record<string, string> = { error: "#f87171", warn: "#fbbf24" };

// ── The serial graph: one normalized line per serial meter over the beat spine ──────────────────────────
// x = beat index (the PLAN layer meterSeries walks). Each meter maps its own [min,max] → [0,1] so unlike-scaled
// meters share the canvas; the legend carries the real values. Faint act dividers mark act boundaries.
// The PLAN line (solid) is the beat readings; when a meter declares a target curve, its INTENT (dashed, same
// color) is overlaid so the plan-vs-intent gap is visible (the target_drift lint reads the same diff).
function SerialGraph({ nodes, meters, colorOf }: { nodes: DnaNode[]; meters: DnaNode[]; colorOf: (id: string) => string }) {
  const beats = beatsInOrder(nodes);
  const n = beats.length;
  if (n < 2 || !meters.length) return null;
  const W = 1000, H = 240, PAD_X = 12, PAD_Y = 14;
  const x = (i: number) => PAD_X + (i / (n - 1)) * (W - 2 * PAD_X);
  // y maps a normalized 0..1 to canvas (1 at top).
  const y = (norm: number) => PAD_Y + (1 - norm) * (H - 2 * PAD_Y);

  // act boundaries: count beats per act in order → cumulative x positions
  const index = byId(nodes);
  const acts = nodes.filter((nn) => nn.kind === "act").sort((a, b) => a.position - b.position);
  const bounds: number[] = []; let acc = 0;
  for (const m of acts) {
    const c = childrenOf(nodes, m.id).filter((b) => b.kind === "beat").length;
    acc += c; if (acc > 0 && acc < n) bounds.push(acc);
  }

  // Normalize the PLAN (readings), the INTENT (target curve), and the OBSERVED read onto the SAME [lo,hi] so
  // they're comparable. Without an explicit scale, the bounds span all three so no line clips off-canvas.
  const normsOf = (m: DnaNode) => {
    const c = m.content as MeterContent;
    const plan = meterSeries(nodes, m.id);
    const target = meterTarget(nodes, m.id);
    const observed = observedSeries(nodes, m.id);
    const ys = [...plan, ...target, ...observed].map((p) => p.value).filter((v): v is number => v != null);
    const lo = c.scale?.min ?? Math.min(...ys);
    const hi = c.scale?.max ?? Math.max(...ys);
    const span = hi - lo || 1;
    const norm = (s: MeterPoint[]) => s.map((p) => (p.value == null ? null : (p.value - lo) / span));
    return { plan: norm(plan), target: norm(target), observed: norm(observed) };
  };
  // A normalized series → SVG point segments (null gaps split the line so a never-read stretch isn't bridged).
  const segmentsOf = (norms: (number | null)[]): string[][] => {
    const segments: string[][] = [[]];
    norms.forEach((v, i) => {
      if (v == null) { if (segments[segments.length - 1].length) segments.push([]); return; }
      segments[segments.length - 1].push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    });
    return segments.filter((s) => s.length);
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
      {/* per meter: PLAN (solid) + target INTENT (dashed) + OBSERVED read (dotted). null gaps split each. */}
      {meters.map((m) => {
        const { plan, target, observed } = normsOf(m);
        const color = colorOf(m.id);
        const hasTarget = target.some((v) => v != null);
        const hasObserved = observed.some((v) => v != null);
        return (
          <g key={m.id}>
            {hasTarget && segmentsOf(target).map((pts, si) => (
              <polyline key={`t${si}`} points={pts.join(" ")} fill="none" stroke={color} strokeWidth={1.5} strokeDasharray="4 4" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" opacity={0.5} />
            ))}
            {hasObserved && segmentsOf(observed).map((pts, si) => (
              <polyline key={`o${si}`} points={pts.join(" ")} fill="none" stroke={color} strokeWidth={1.5} strokeDasharray="1 4" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" opacity={0.8} />
            ))}
            {segmentsOf(plan).map((pts, si) => (
              <polyline key={si} points={pts.join(" ")} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" opacity={0.92} />
            ))}
            {/* end dot at the last real PLAN value */}
            {(() => { const li = plan.map((v, i) => (v == null ? -1 : i)).reduce((a, b) => Math.max(a, b), -1); return li >= 0 ? <circle cx={x(li)} cy={y(plan[li]!)} r={3} fill={color} /> : null; })()}
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
  const navigate = useNavigate();
  const bookId = getNumericId(bookSlug);
  const [nodes, setNodes] = useState<DnaNode[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false); // the read / send is in flight
  const [note, setNote] = useState<string | null>(null);

  // The editor's read: rate the prose against the meters, write the OBSERVED trace onto the beats (the
  // dotted line appears via the book_nodes subscription). The author then reviews the gaps before sending.
  const runRead = async () => {
    if (!nodes || !bookId) return;
    setReading(true); setNote("Reading the prose against the meters…");
    try {
      const input = buildMeterReadInput(nodes);
      if (!input.meters.length) { setNote("No meters defined yet — add a meter node first."); return; }
      if (!input.beats.length) { setNote("No beats with prose to read yet."); return; }
      const readings = await invokeMeterRead(bookId, input);
      await writeObserved(nodes, readings);
      setNote(`Read ${readings.length} reading(s) across ${input.beats.length} beat(s). The dotted line is what the prose delivers.`);
    } catch (e) {
      setNote(`Read failed: ${String((e as Error)?.message ?? e)}`);
    } finally { setReading(false); }
  };

  // Hand the read's gaps to the editor agent (the manual taste gate), then jump to the tree's agent rail.
  const sendToEditor = async () => {
    if (!nodes || !bookId) return;
    setReading(true);
    try {
      const sent = await sendFindingsToEditor(bookId, nodes, {});
      if (sent) navigate(`/books/${bookSlug}/dna/tree`);
      else setNote("The prose is on-plan — no gaps to send.");
    } catch (e) {
      setNote(`Couldn't send to the editor: ${String((e as Error)?.message ?? e)}`);
    } finally { setReading(false); }
  };

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
    const issues = validate(ns).filter((i) => ["flat_meter", "no_oscillation", "no_jeopardy", "target_drift", "read_gap"].includes(i.rule));
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
        <p style={{ fontSize: 12, color: "#777", marginTop: 0, marginBottom: 12 }}>
          The story's tracked axes (docs/novel-dna-meters.md). Serial meters — those with readings across ≥2 beats — plot below, each normalized to its own scale.
        </p>
        {meters.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
            <button type="button" onClick={() => void runRead()} disabled={reading}
              style={{ fontSize: 12, color: "#0a0a0a", background: "#7dd3fc", border: "none", borderRadius: 6, padding: "6px 12px", fontWeight: 600, cursor: reading ? "default" : "pointer", opacity: reading ? 0.6 : 1 }}>
              {reading ? "Reading…" : "Read the emotional trace"}
            </button>
            <button type="button" onClick={() => void sendToEditor()} disabled={reading || !observedFindingsMessage(nodes)}
              style={{ fontSize: 12, color: "#ddd", background: "transparent", border: "1px solid #333", borderRadius: 6, padding: "6px 12px", cursor: reading || !observedFindingsMessage(nodes) ? "default" : "pointer", opacity: reading || !observedFindingsMessage(nodes) ? 0.4 : 1 }}>
              Send gaps to editor →
            </button>
            {note && <span style={{ fontSize: 12, color: note.toLowerCase().includes("fail") || note.toLowerCase().includes("couldn't") ? "#f87171" : "#888" }}>{note}</span>}
          </div>
        )}

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
                  <span style={{ fontSize: 11, color: "#777", marginLeft: "auto" }}>
                    solid = plan{serialMeters.some((m) => (m.content as MeterContent).target?.length) ? " · dashed = target" : ""}{serialMeters.some((m) => observedSeries(nodes, m.id).some((p) => p.value != null)) ? " · dotted = read" : ""}
                  </span>
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
