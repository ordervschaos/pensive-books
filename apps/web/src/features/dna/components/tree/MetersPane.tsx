// MetersPane — the meters dashboard body, extracted so it renders in two places on ONE implementation:
// the standalone /dna/meters route (DnaMetersPage wraps it in page chrome) and the studio's `meters` tab
// (DnaTreePage feeds it the already-subscribed nodes). Pure projection of the live tree — the read buttons
// invoke the edge reads, which write onto book_nodes; the dotted/verdict rows reappear via the subscription
// the host owns. The serial graph mirrors the landing "shape of your story" mock (MetersMock.tsx).
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  beatsInOrder, briefFitHash, buildBriefFitInput, buildLoglineFitInput, buildShapeReadInput, buildSynopsisReadInput, byId, childrenOf, isSerialMeter, loglineFitHash, meterSeries, meterShape, meterTarget, observedSeries, shapeReadHash, synopsisReadHash, validate,
  type DnaNode, type MeterContent, type DnaIssue, type MeterPoint, type PillarContent, type PremiseContent, type SeedContent,
} from "@/features/dna/lib/novelDna";
import { buildMeterReadInput, invokeMeterRead, observedFindingsMessage, sendFindingsToEditor, writeObserved } from "@/features/dna/lib/meterRead";
import { invokeShapeRead, sendShapeFindingsToEditor, shapeFindingsMessage, writeShapeFit } from "@/features/dna/lib/shapeRead";
import { craftFindingsMessage, invokeSynopsisRead, sendCraftFindingsToEditor, writeCraft } from "@/features/dna/lib/synopsisRead";
import { briefFitFindingsMessage, invokeBriefRead, sendBriefFitFindingsToEditor, writeBriefFit } from "@/features/dna/lib/loglineRead";
import { loglineFitFindingsMessage, invokePremiseRead, sendLoglineFitFindingsToEditor, writeLoglineFit } from "@/features/dna/lib/premiseRead";
import { buildConfusionReadInput, confusionFindingsMessage, invokeConfusionRead, judgedSceneIds, sendConfusionFindingsToEditor, writeConfusionFlags } from "@/features/dna/lib/confusionRead";
import { T } from "./treeChrome";

// Severity → dot color for a lint badge (reads the live console tokens).
const lintColor = (severity: string) => (severity === "error" ? T.bad : T.warn);

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
        <line key={g} x1={PAD_X} y1={y(g)} x2={W - PAD_X} y2={y(g)} stroke={T.border} strokeWidth={1} strokeDasharray={g === 0.5 ? "3 5" : undefined} vectorEffect="non-scaling-stroke" opacity={0.5} />
      ))}
      {/* act dividers */}
      {bounds.map((b, i) => (
        <line key={`b${i}`} x1={x(b - 0.5)} y1={0} x2={x(b - 0.5)} y2={H} stroke={T.empty} strokeWidth={1} vectorEffect="non-scaling-stroke" opacity={0.4} />
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
    <div style={{ borderBottom: `1px solid ${T.borderSoft}`, padding: "10px 0", display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 10, height: 10, borderRadius: 2, background: serial ? color : T.empty, flexShrink: 0 }} />
        <span style={{ fontWeight: 600, color: T.ink }}>{c.name ?? meter.id}</span>
        {c.kind && <span style={{ fontSize: 11, color: T.muted, border: `1px solid ${T.border}`, borderRadius: 4, padding: "0 5px" }}>{c.kind}</span>}
        {!serial && <span style={{ fontSize: 11, color: T.muted }}>· {reads === 0 ? "no readings yet" : "1 reading (need ≥2 to plot)"}</span>}
        {serial && <span style={{ fontSize: 11, color: T.muted }}>· last {shape.last} · range {shape.range} · {shape.oscillations} turns</span>}
      </div>
      {(c.poles?.low || c.poles?.high) && (
        <div style={{ fontSize: 11, color: T.muted, paddingLeft: 18 }}>
          {c.scale ? `[${c.scale.min ?? "?"}…${c.scale.max ?? "?"}] ` : ""}{c.poles?.low ? `low: ${c.poles.low}` : ""}{c.poles?.low && c.poles?.high ? "  ·  " : ""}{c.poles?.high ? `high: ${c.poles.high}` : ""}
        </div>
      )}
      {mine.map((i, k) => (
        <div key={k} style={{ fontSize: 11, color: T.inkSoft, paddingLeft: 18, display: "flex", gap: 6, alignItems: "baseline" }}>
          <span style={{ color: lintColor(i.severity) }}>●</span>
          <span style={{ color: lintColor(i.severity), fontWeight: 600 }}>{i.rule}</span>
          <span>{i.message}</span>
        </div>
      ))}
    </div>
  );
}

// The meters dashboard body. Host owns node loading/subscription; this pane just projects + triggers reads.
// bookSlug is only used to navigate to the tree/agent rail after a "send to editor" (works as a route change
// on the standalone page and as a tab switch inside the studio — /dna/tree is splat-matched, no remount).
export function MetersPane({ nodes, bookId, bookSlug }: { nodes: DnaNode[]; bookId: number; bookSlug: string }) {
  const navigate = useNavigate();
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

  // The shape read (doc_1783113903000): the paid SEMANTIC pass — do the acts deliver each movement the premise
  // promised? Writes the per-movement verdict onto the premise, sealed by the input hash; the movement_unfit lint
  // reads it. Plan-plane only (no prose), so it's cheap and independent of whether anything is drafted.
  const runShapeRead = async () => {
    if (!nodes || !bookId) return;
    const input = buildShapeReadInput(nodes);
    if (!input) { setNote("Add a premise shape (movements) and acts with beats first — nothing to read yet."); return; }
    setReading(true); setNote("Reading the acts against the promised shape…");
    try {
      const fits = await invokeShapeRead(bookId, input);
      await writeShapeFit(nodes, input, fits);
      setNote(`Read ${fits.length} movement(s). Rows below show how faithfully the acts deliver each.`);
    } catch (e) {
      setNote(`Shape read failed: ${String((e as Error)?.message ?? e)}`);
    } finally { setReading(false); }
  };

  const sendShapeToEditor = async () => {
    if (!nodes || !bookId) return;
    setReading(true);
    try {
      const sent = await sendShapeFindingsToEditor(bookId, nodes, {});
      if (sent) navigate(`/books/${bookSlug}/dna/tree`);
      else setNote("Every movement is delivered — no shape gaps to send.");
    } catch (e) {
      setNote(`Couldn't send to the editor: ${String((e as Error)?.message ?? e)}`);
    } finally { setReading(false); }
  };

  // The brief read (read-logline): does the LOGLINE still honor the BRIEF it was forged from? Writes the
  // verdict onto the seed, sealed by the input hash; the brief_fit_flag lint reads it. Distinct from the
  // deterministic logline_overlong/logline_static lints — those check prose mechanics, this checks fidelity
  // to the brief's idea/genre/tone/stakes.
  const runBriefRead = async () => {
    if (!nodes || !bookId) return;
    const input = buildBriefFitInput(nodes);
    if (!input) { setNote("Accept a logline first — nothing to read yet."); return; }
    setReading(true); setNote("Reading the logline against the brief…");
    try {
      const rows = await invokeBriefRead(bookId, input);
      await writeBriefFit(nodes, input, rows);
      setNote(`Scored ${rows.length} brief-fidelity axis(es).`);
    } catch (e) {
      setNote(`Brief read failed: ${String((e as Error)?.message ?? e)}`);
    } finally { setReading(false); }
  };

  const sendBriefFitToEditor = async () => {
    if (!nodes || !bookId) return;
    setReading(true);
    try {
      const sent = await sendBriefFitFindingsToEditor(bookId, nodes, {});
      if (sent) navigate(`/books/${bookSlug}/dna/tree`);
      else setNote("The logline clears every brief-fidelity axis — no flags to send.");
    } catch (e) {
      setNote(`Couldn't send to the editor: ${String((e as Error)?.message ?? e)}`);
    } finally { setReading(false); }
  };

  // The premise read (read-premise): does the PREMISE still honor the LOGLINE it was derived from? Writes
  // the verdict onto the premise, sealed by the input hash; the logline_fit_flag lint reads it. Distinct
  // from observed_shape_fit (the shape read — per-movement act-delivery, a different judge).
  const runPremiseRead = async () => {
    if (!nodes || !bookId) return;
    const input = buildLoglineFitInput(nodes);
    if (!input) { setNote("Derive a premise (dramatic question) from the logline first — nothing to read yet."); return; }
    setReading(true); setNote("Reading the premise against the logline…");
    try {
      const rows = await invokePremiseRead(bookId, input);
      await writeLoglineFit(nodes, input, rows);
      setNote(`Scored ${rows.length} logline-fidelity axis(es).`);
    } catch (e) {
      setNote(`Premise read failed: ${String((e as Error)?.message ?? e)}`);
    } finally { setReading(false); }
  };

  const sendLoglineFitToEditor = async () => {
    if (!nodes || !bookId) return;
    setReading(true);
    try {
      const sent = await sendLoglineFitFindingsToEditor(bookId, nodes, {});
      if (sent) navigate(`/books/${bookSlug}/dna/tree`);
      else setNote("The premise clears every logline-fidelity axis — no flags to send.");
    } catch (e) {
      setNote(`Couldn't send to the editor: ${String((e as Error)?.message ?? e)}`);
    } finally { setReading(false); }
  };

  // The synopsis read (W2): the shift-left editor's read of the PLAN — an acquisitions editor scores the whole
  // premise+pillar+acts+beats synopsis on fixed craft axes. Writes the verdict onto the pillar, sealed by the
  // input hash; the craft_flag lint reads it. Plan-plane only (no prose) — the cheapest place to catch a boring book.
  const runSynopsisRead = async () => {
    if (!nodes || !bookId) return;
    const input = buildSynopsisReadInput(nodes);
    if (!input) { setNote("Add a pillar and acts with beats first — nothing to read yet."); return; }
    setReading(true); setNote("Running the editor's read of the plan…");
    try {
      const rows = await invokeSynopsisRead(bookId, input);
      await writeCraft(nodes, input, rows);
      setNote(`Scored ${rows.length} craft axis(es). Rows below are the editor's verdict on the plan.`);
    } catch (e) {
      setNote(`Editor's read failed: ${String((e as Error)?.message ?? e)}`);
    } finally { setReading(false); }
  };

  const sendCraftToEditor = async () => {
    if (!nodes || !bookId) return;
    setReading(true);
    try {
      const sent = await sendCraftFindingsToEditor(bookId, nodes, {});
      if (sent) navigate(`/books/${bookSlug}/dna/tree`);
      else setNote("Every craft axis clears the floor — no flags to send.");
    } catch (e) {
      setNote(`Couldn't send to the editor: ${String((e as Error)?.message ?? e)}`);
    } finally { setReading(false); }
  };

  // The cold read (W5): a first-time reader — fed only the recap of prior pages + each chapter's prose, never
  // the plan — flags what it couldn't follow. Writes confusion_flags onto the judged scenes (clearing fixed
  // ones); the reader_confusion lint surfaces them below and in the handoff.
  const runConfusionRead = async () => {
    if (!nodes || !bookId) return;
    const input = buildConfusionReadInput(nodes);
    if (!input.chapters.length) { setNote("No chapters with prose to cold-read yet."); return; }
    setReading(true); setNote("Cold-reading the prose, chapter by chapter…");
    try {
      const res = await invokeConfusionRead(bookId, input);
      await writeConfusionFlags(nodes, res.flags, judgedSceneIds(input, res.chaptersRead));
      setNote(`Cold-read ${res.chaptersRead} chapter(s) — ${res.flags.length} confusion flag(s)${res.truncated ? " (long book: only the first chapters fit this pass — re-run to continue)" : ""}.`);
    } catch (e) {
      setNote(`Cold read failed: ${String((e as Error)?.message ?? e)}`);
    } finally { setReading(false); }
  };

  const sendConfusionToEditor = async () => {
    if (!nodes || !bookId) return;
    setReading(true);
    try {
      const sent = await sendConfusionFindingsToEditor(bookId, nodes, {});
      if (sent) navigate(`/books/${bookSlug}/dna/tree`);
      else setNote("A cold reader can follow everything — no confusion flags to send.");
    } catch (e) {
      setNote(`Couldn't send to the editor: ${String((e as Error)?.message ?? e)}`);
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

  const { meters, serialMeters, colorOf, issues } = useMemo(() => {
    const ns = nodes ?? [];
    const meters = ns.filter((n) => n.kind === "meter").sort((a, b) => a.position - b.position);
    const serialMeters = meters.filter((m) => isSerialMeter(ns, m.id));
    const colorMap = new Map(serialMeters.map((m, i) => [m.id, T.lines[i % T.lines.length]]));
    const colorOf = (id: string) => colorMap.get(id) ?? T.muted;
    const issues = validate(ns).filter((i) => ["flat_meter", "no_oscillation", "no_jeopardy", "target_drift", "read_gap"].includes(i.rule));
    return { meters, serialMeters, colorOf, issues };
  }, [nodes]);

  // Shape-read state (doc_1783113903000): the promised movements, the stored verdict, and whether the seal is
  // still FRESH (its input hash still matches the live tree). A stale verdict is silent in the lint — the panel
  // shows a "stale" chip instead of nagging (the read is paid; the author re-triggers it).
  const shape = useMemo(() => {
    const ns = nodes ?? [];
    const premise = ns.find((n) => n.kind === "premise");
    const pc = premise?.content as PremiseContent | undefined;
    const movements = (pc?.shape?.movements ?? []).filter((m): m is string => typeof m === "string" && !!m.trim());
    const verdict = pc?.observed_shape_fit ?? null;
    const input = buildShapeReadInput(ns);
    const fresh = !!verdict && !!input && pc?.observed_shape_hash === shapeReadHash(input);
    const findings = shapeFindingsMessage(ns); // null unless a FRESH verdict has a sub-floor movement
    return { movements, verdict, fresh, findings, readable: !!input };
  }, [nodes]);

  // Brief-read state (read-logline): the stored brief-fidelity verdict on the seed + whether its seal is
  // still FRESH — same fresh/stale discipline as the shape/synopsis reads.
  const briefFit = useMemo(() => {
    const ns = nodes ?? [];
    const seed = ns.find((n) => n.kind === "seed");
    const sc = seed?.content as SeedContent | undefined;
    const verdict = sc?.observed_brief_fit ?? null;
    const input = buildBriefFitInput(ns);
    const fresh = !!verdict && !!input && sc?.observed_brief_fit_hash === briefFitHash(input);
    const findings = briefFitFindingsMessage(ns); // null unless a FRESH verdict has a sub-floor axis
    return { verdict, fresh, findings, readable: !!input };
  }, [nodes]);

  // Premise-read state (read-premise): the stored logline-fidelity verdict on the premise + whether its
  // seal is still FRESH — same fresh/stale discipline as the shape/synopsis reads.
  const loglineFit = useMemo(() => {
    const ns = nodes ?? [];
    const premise = ns.find((n) => n.kind === "premise");
    const pc = premise?.content as PremiseContent | undefined;
    const verdict = pc?.observed_logline_fit ?? null;
    const input = buildLoglineFitInput(ns);
    const fresh = !!verdict && !!input && pc?.observed_logline_fit_hash === loglineFitHash(input);
    const findings = loglineFitFindingsMessage(ns); // null unless a FRESH verdict has a sub-floor axis
    return { verdict, fresh, findings, readable: !!input };
  }, [nodes]);

  // Synopsis-read state (W2): the stored craft verdict on the pillar + whether its seal is still FRESH — the
  // same fresh/stale discipline as the shape read (a stale verdict dims; the author re-triggers the paid read).
  const craft = useMemo(() => {
    const ns = nodes ?? [];
    const pillar = ns.find((n) => n.kind === "pillar");
    const plc = pillar?.content as PillarContent | undefined;
    const verdict = plc?.observed_craft ?? null;
    const input = buildSynopsisReadInput(ns);
    const fresh = !!verdict && !!input && plc?.observed_craft_hash === synopsisReadHash(input);
    const findings = craftFindingsMessage(ns); // null unless a FRESH verdict has a sub-floor axis
    return { verdict, fresh, findings, readable: !!input };
  }, [nodes]);

  // Cold-read state (W5): whether there's anything to read (chapters with prose) and the stored flags the
  // engine's reader_confusion lint surfaces — the rows below the trigger, and the send affordance's gate.
  const confusion = useMemo(() => {
    const ns = nodes ?? [];
    const readable = buildConfusionReadInput(ns).chapters.length > 0;
    const issues = validate(ns).filter((i) => i.rule === "reader_confusion");
    return { readable, issues, findings: confusionFindingsMessage(ns) };
  }, [nodes]);

  return (
    <>
      <p style={{ fontSize: 12, color: T.muted, marginTop: 0, marginBottom: 12 }}>
        The story's tracked axes (docs/novel-dna-meters.md). Serial meters — those with readings across ≥2 beats — plot below, each normalized to its own scale.
      </p>

      {/* THE BRIEF READ (read-logline): does the logline still honor the brief it was forged from? Fixed
          brief-fidelity axes scored 1–5; the verdict + stale seal live on the seed node. */}
      {(briefFit.readable || briefFit.verdict) && (
        <div style={{ border: `1px solid ${T.border}`, borderRadius: 8, padding: "12px 14px", marginBottom: 18, background: T.raised }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: briefFit.verdict ? 10 : 0 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: T.ink }}>Brief fit</span>
            <button type="button" onClick={() => void runBriefRead()} disabled={reading || !briefFit.readable}
              style={{ fontSize: 12, color: T.paper, background: T.accent, border: "none", borderRadius: 6, padding: "5px 11px", fontWeight: 600, cursor: reading || !briefFit.readable ? "default" : "pointer", opacity: reading || !briefFit.readable ? 0.5 : 1 }}>
              {reading ? "Reading…" : "Read logline vs. brief"}
            </button>
            <button type="button" onClick={() => void sendBriefFitToEditor()} disabled={reading || !briefFit.findings}
              style={{ fontSize: 12, color: T.inkSoft, background: "transparent", border: `1px solid ${T.border}`, borderRadius: 6, padding: "5px 11px", cursor: reading || !briefFit.findings ? "default" : "pointer", opacity: reading || !briefFit.findings ? 0.4 : 1 }}>
              Send brief-fit flags to editor →
            </button>
            {briefFit.verdict && !briefFit.fresh && (
              <span style={{ fontSize: 11, color: T.stale, border: `1px solid ${T.stale}44`, borderRadius: 5, padding: "2px 7px" }}>read is stale — logline changed since</span>
            )}
          </div>
          {briefFit.verdict?.map((row, i) => {
            const color = row.score <= 2 ? T.bad : row.score >= 4 ? T.good : T.warn;
            return (
              <div key={i} style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 12, padding: "2px 0", opacity: briefFit.fresh ? 1 : 0.5 }}>
                <span style={{ color, fontWeight: 700, minWidth: 26 }}>{row.score}/5</span>
                <span style={{ color: T.inkSoft }}>{row.axis}</span>
                {row.note && <span style={{ color: T.muted }}>— {row.note}</span>}
              </div>
            );
          })}
        </div>
      )}

      {/* THE SHAPE READ (doc_1783113903000): the paid semantic ceiling of vertical fit — do the acts deliver each
          movement the premise promised? Plan-plane only; the verdict + stale seal live on the premise node. */}
      {shape.movements.length > 0 && (
        <div style={{ border: `1px solid ${T.border}`, borderRadius: 8, padding: "12px 14px", marginBottom: 18, background: T.raised }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: shape.verdict ? 10 : 0 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: T.ink }}>Shape</span>
            <button type="button" onClick={() => void runShapeRead()} disabled={reading || !shape.readable}
              style={{ fontSize: 12, color: T.paper, background: T.accent, border: "none", borderRadius: 6, padding: "5px 11px", fontWeight: 600, cursor: reading || !shape.readable ? "default" : "pointer", opacity: reading || !shape.readable ? 0.5 : 1 }}>
              {reading ? "Reading…" : "Read the shape"}
            </button>
            <button type="button" onClick={() => void sendShapeToEditor()} disabled={reading || !shape.findings}
              style={{ fontSize: 12, color: T.inkSoft, background: "transparent", border: `1px solid ${T.border}`, borderRadius: 6, padding: "5px 11px", cursor: reading || !shape.findings ? "default" : "pointer", opacity: reading || !shape.findings ? 0.4 : 1 }}>
              Send shape gaps to editor →
            </button>
            {shape.verdict && !shape.fresh && (
              <span style={{ fontSize: 11, color: T.stale, border: `1px solid ${T.stale}44`, borderRadius: 5, padding: "2px 7px" }}>read is stale — plan changed since</span>
            )}
          </div>
          {shape.verdict && shape.movements.map((text, i) => {
            const row = shape.verdict!.find((v) => v.movement === i);
            const score = row ? (row.actIds.length ? row.fit : 0) : null; // empty mapping = uncarried = 0
            const color = score == null ? T.faint : score <= 2 ? T.bad : score >= 4 ? T.good : T.warn;
            return (
              <div key={i} style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 12, padding: "2px 0", opacity: shape.fresh ? 1 : 0.5 }}>
                <span style={{ color, fontWeight: 700, minWidth: 26 }}>{score == null ? "—" : `${score}/5`}</span>
                <span style={{ color: T.inkSoft }}>{i + 1}. {text}</span>
                {row?.note && <span style={{ color: T.muted }}>— {row.note}</span>}
              </div>
            );
          })}
        </div>
      )}

      {/* THE PREMISE READ (read-premise): does the premise still honor the logline it was derived from? Fixed
          logline-fidelity axes scored 1–5; the verdict + stale seal live on the premise node. */}
      {(loglineFit.readable || loglineFit.verdict) && (
        <div style={{ border: `1px solid ${T.border}`, borderRadius: 8, padding: "12px 14px", marginBottom: 18, background: T.raised }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: loglineFit.verdict ? 10 : 0 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: T.ink }}>Premise fit</span>
            <button type="button" onClick={() => void runPremiseRead()} disabled={reading || !loglineFit.readable}
              style={{ fontSize: 12, color: T.paper, background: T.accent, border: "none", borderRadius: 6, padding: "5px 11px", fontWeight: 600, cursor: reading || !loglineFit.readable ? "default" : "pointer", opacity: reading || !loglineFit.readable ? 0.5 : 1 }}>
              {reading ? "Reading…" : "Read premise vs. logline"}
            </button>
            <button type="button" onClick={() => void sendLoglineFitToEditor()} disabled={reading || !loglineFit.findings}
              style={{ fontSize: 12, color: T.inkSoft, background: "transparent", border: `1px solid ${T.border}`, borderRadius: 6, padding: "5px 11px", cursor: reading || !loglineFit.findings ? "default" : "pointer", opacity: reading || !loglineFit.findings ? 0.4 : 1 }}>
              Send premise-fit flags to editor →
            </button>
            {loglineFit.verdict && !loglineFit.fresh && (
              <span style={{ fontSize: 11, color: T.stale, border: `1px solid ${T.stale}44`, borderRadius: 5, padding: "2px 7px" }}>read is stale — logline or premise changed since</span>
            )}
          </div>
          {loglineFit.verdict?.map((row, i) => {
            const color = row.score <= 2 ? T.bad : row.score >= 4 ? T.good : T.warn;
            return (
              <div key={i} style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 12, padding: "2px 0", opacity: loglineFit.fresh ? 1 : 0.5 }}>
                <span style={{ color, fontWeight: 700, minWidth: 26 }}>{row.score}/5</span>
                <span style={{ color: T.inkSoft }}>{row.axis}</span>
                {row.note && <span style={{ color: T.muted }}>— {row.note}</span>}
              </div>
            );
          })}
        </div>
      )}

      {/* THE SYNOPSIS READ (W2): the shift-left editor's read of the PLAN — fixed craft axes scored 1–5 over
          premise+pillar+acts+beats, zero prose; the verdict + stale seal live on the pillar node. */}
      {(craft.readable || craft.verdict) && (
        <div style={{ border: `1px solid ${T.border}`, borderRadius: 8, padding: "12px 14px", marginBottom: 18, background: T.raised }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: craft.verdict ? 10 : 0 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: T.ink }}>Craft</span>
            <button type="button" onClick={() => void runSynopsisRead()} disabled={reading || !craft.readable}
              style={{ fontSize: 12, color: T.paper, background: T.accent, border: "none", borderRadius: 6, padding: "5px 11px", fontWeight: 600, cursor: reading || !craft.readable ? "default" : "pointer", opacity: reading || !craft.readable ? 0.5 : 1 }}>
              {reading ? "Reading…" : "Editor's read (plan)"}
            </button>
            <button type="button" onClick={() => void sendCraftToEditor()} disabled={reading || !craft.findings}
              style={{ fontSize: 12, color: T.inkSoft, background: "transparent", border: `1px solid ${T.border}`, borderRadius: 6, padding: "5px 11px", cursor: reading || !craft.findings ? "default" : "pointer", opacity: reading || !craft.findings ? 0.4 : 1 }}>
              Send craft flags to editor →
            </button>
            {craft.verdict && !craft.fresh && (
              <span style={{ fontSize: 11, color: T.stale, border: `1px solid ${T.stale}44`, borderRadius: 5, padding: "2px 7px" }}>read is stale — plan changed since</span>
            )}
          </div>
          {craft.verdict?.map((row, i) => {
            const color = row.score <= 2 ? T.bad : row.score >= 4 ? T.good : T.warn;
            return (
              <div key={i} style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 12, padding: "2px 0", opacity: craft.fresh ? 1 : 0.5 }}>
                <span style={{ color, fontWeight: 700, minWidth: 26 }}>{row.score}/5</span>
                <span style={{ color: T.inkSoft }}>{row.axis}</span>
                {row.note && <span style={{ color: T.muted }}>— {row.note}</span>}
              </div>
            );
          })}
        </div>
      )}

      {/* THE COLD READ (W5): a first-time reader judges each chapter knowing ONLY the recap of prior pages +
          the chapter's prose — never the plan. Flags land on scenes as confusion_flags; rows are the
          reader_confusion lints the engine derives from them. */}
      {(confusion.readable || confusion.issues.length > 0) && (
        <div style={{ border: `1px solid ${T.border}`, borderRadius: 8, padding: "12px 14px", marginBottom: 18, background: T.raised }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: confusion.issues.length ? 10 : 0 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: T.ink }}>Cold read</span>
            <button type="button" onClick={() => void runConfusionRead()} disabled={reading || !confusion.readable}
              style={{ fontSize: 12, color: T.paper, background: T.accent, border: "none", borderRadius: 6, padding: "5px 11px", fontWeight: 600, cursor: reading || !confusion.readable ? "default" : "pointer", opacity: reading || !confusion.readable ? 0.5 : 1 }}>
              {reading ? "Reading…" : "Cold read (prose)"}
            </button>
            <button type="button" onClick={() => void sendConfusionToEditor()} disabled={reading || !confusion.findings}
              style={{ fontSize: 12, color: T.inkSoft, background: "transparent", border: `1px solid ${T.border}`, borderRadius: 6, padding: "5px 11px", cursor: reading || !confusion.findings ? "default" : "pointer", opacity: reading || !confusion.findings ? 0.4 : 1 }}>
              Send confusion flags to editor →
            </button>
          </div>
          {confusion.issues.map((i, k) => (
            <div key={k} style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 12, padding: "2px 0" }}>
              <span style={{ color: lintColor(i.severity) }}>●</span>
              <span style={{ color: T.inkSoft }}>{i.message}</span>
            </div>
          ))}
        </div>
      )}

      {meters.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
          <button type="button" onClick={() => void runRead()} disabled={reading}
            style={{ fontSize: 12, color: T.paper, background: T.accent, border: "none", borderRadius: 6, padding: "6px 12px", fontWeight: 600, cursor: reading ? "default" : "pointer", opacity: reading ? 0.6 : 1 }}>
            {reading ? "Reading…" : "Read the emotional trace"}
          </button>
          <button type="button" onClick={() => void sendToEditor()} disabled={reading || !observedFindingsMessage(nodes)}
            style={{ fontSize: 12, color: T.inkSoft, background: "transparent", border: `1px solid ${T.border}`, borderRadius: 6, padding: "6px 12px", cursor: reading || !observedFindingsMessage(nodes) ? "default" : "pointer", opacity: reading || !observedFindingsMessage(nodes) ? 0.4 : 1 }}>
            Send gaps to editor →
          </button>
          {note && <span style={{ fontSize: 12, color: note.toLowerCase().includes("fail") || note.toLowerCase().includes("couldn't") ? T.bad : T.muted }}>{note}</span>}
        </div>
      )}

      {meters.length === 0 ? (
        <div style={{ fontSize: 13, color: T.muted, border: `1px dashed ${T.border}`, borderRadius: 8, padding: 20 }}>
          No meters yet. Add a <code style={{ color: T.warn }}>meter</code> node off the pillar (e.g. comedy, heat, a game-score), then give beats <code style={{ color: T.warn }}>readings</code> on it.
        </div>
      ) : (
        <>
          {serialMeters.length > 0 && (
            <div style={{ border: `1px solid ${T.border}`, borderRadius: 8, padding: "14px 12px 6px", marginBottom: 18, background: T.raised }}>
              <SerialGraph nodes={nodes} meters={serialMeters} colorOf={colorOf} />
              <div style={{ display: "flex", flexWrap: "wrap", gap: 14, padding: "8px 4px 2px" }}>
                {serialMeters.map((m) => {
                  const c = m.content as MeterContent;
                  return (
                    <span key={m.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: T.inkSoft }}>
                      <span style={{ width: 14, height: 3, borderRadius: 2, background: colorOf(m.id) }} />
                      {c.name ?? m.id}
                    </span>
                  );
                })}
                <span style={{ fontSize: 11, color: T.muted, marginLeft: "auto" }}>
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
    </>
  );
}
