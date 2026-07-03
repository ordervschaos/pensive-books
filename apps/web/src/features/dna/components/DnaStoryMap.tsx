// DnaStoryMap — the DETAILED map of the whole book on one screen: the emotional contour (the value line
// rising/falling across the book) over the full beat-by-beat spine, each beat showing its causal connector
// (∴ therefore · ↯ but) and polarity (↗ up · ↘ down), each scene a chip with its own turn. It's the "read
// the whole shape at a glance, then dig into any part" view — every row jumps to the exact node (onOpen
// carries a focusId). Pure projection of the tree + the engine's causality axis; nothing generates here.
import { ChevronRight } from "lucide-react";
import { Eyebrow } from "@/components/book/shared/studioUi";
import type { StageKey } from "@/features/dna/lib/dnaJourney";
import {
  beatsInOrder, causality, childrenOf, scenesInOrder,
  type BeatContent, type CausalityRow, type DnaNode, type ActContent, type SceneContent,
} from "@/features/dna/lib/novelDna";

const ACCENT = "text-[hsl(var(--pv-accent))]";
const FAINT = "text-[hsl(var(--pv-text-faint))]";
const MUTED = "text-[hsl(var(--pv-text-muted))]";

type Polarity = "up" | "down" | null | undefined;
const polarityOf = (n: DnaNode): Polarity =>
  n.kind === "scene" ? (n.content as SceneContent).value_shift?.polarity : (n.content as BeatContent).polarity;

// A small ↗ / ↘ / → glyph for a value turn.
function Turn({ p, className = "" }: { p: Polarity; className?: string }) {
  const cls = p === "up" ? "text-emerald-500" : p === "down" ? "text-rose-500" : FAINT;
  return <span className={`pv-serif ${cls} ${className}`}>{p === "up" ? "↗" : p === "down" ? "↘" : "→"}</span>;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

// ── The emotional contour — the running value level (up +1 / down −1) as a rising/falling line across the
// whole book, with faint act dividers. The classic "story shape" curve, computed live from polarity.
function Contour({ units, unitsByAct }: { units: DnaNode[]; unitsByAct: number[] }) {
  const n = units.length;
  if (n < 2) return null;
  const W = 1000, H = 60, PAD = 8;
  // running cumulative level
  let lvl = 0; const levels = units.map((u) => { const p = polarityOf(u); lvl += p === "up" ? 1 : p === "down" ? -1 : 0; return lvl; });
  const lo = Math.min(0, ...levels), hi = Math.max(0, ...levels), span = hi - lo;
  const x = (i: number) => (n === 1 ? W / 2 : (i / (n - 1)) * W);
  const y = (v: number) => span === 0 ? H / 2 : PAD + (1 - (v - lo) / span) * (H - 2 * PAD);
  const pts = levels.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const zeroY = y(0);
  // act boundary x positions (cumulative unit counts)
  const bounds: number[] = []; let acc = 0;
  for (let a = 0; a < unitsByAct.length - 1; a++) { acc += unitsByAct[a]; if (acc > 0 && acc < n) bounds.push(acc); }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-[60px] w-full">
      {/* zero baseline */}
      <line x1={0} y1={zeroY} x2={W} y2={zeroY} stroke="currentColor" className={FAINT} strokeWidth={1} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" opacity={0.4} />
      {/* act dividers */}
      {bounds.map((b, i) => (
        <line key={i} x1={x(b - 0.5)} y1={0} x2={x(b - 0.5)} y2={H} stroke="currentColor" className={FAINT} strokeWidth={1} vectorEffect="non-scaling-stroke" opacity={0.25} />
      ))}
      {/* the value line */}
      <polyline points={pts} fill="none" stroke="currentColor" className={ACCENT} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// One scene chip under a beat: polarity glyph + short label; click drills to the exact scene. Filled dot
// = drafted.
function SceneChip({ scene, onOpen }: { scene: DnaNode; onOpen: () => void }) {
  const c = scene.content as SceneContent;
  const done = !!str(c.prose?.text);
  const label = str(c.chapter_start?.title) ?? str(c.goal) ?? str(c.outcome) ?? "scene";
  return (
    <button type="button" onClick={onOpen} title={label}
      className="group inline-flex max-w-[180px] items-center gap-1 rounded-full border border-[hsl(var(--pv-border-soft))]/70 bg-background/40 px-2 py-0.5 transition-colors hover:border-[hsl(var(--pv-accent))]/50">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${done ? "bg-[hsl(var(--pv-accent))]" : "border border-[hsl(var(--pv-text-faint))]/60"}`} />
      <Turn p={c.value_shift?.polarity} className="shrink-0 text-[10px]" />
      <span className={`pv-serif truncate text-[11px] ${MUTED}`}>{label}</span>
    </button>
  );
}

// One beat row: connector glyph (∴/↯) + summary + polarity, amber when the causal link is hollow; its
// scenes nested below. Whole row drills to the beat.
function BeatRow({ beat, scenes, causal, onOpen }: {
  beat: DnaNode; scenes: DnaNode[]; causal?: CausalityRow; onOpen: (id: string, stage: StageKey) => void;
}) {
  const c = beat.content as BeatContent;
  const glyph = c.connector === "therefore" ? "∴" : c.connector === "but" ? "↯" : "·";
  // the same hollow-link test the analysis panel uses
  const hollow = (c.connector === "therefore" && (causal?.unmet.length ?? 0) > 0) || (c.connector === "but" && !causal?.reversed && !(causal?.needs.length));
  return (
    <div className="space-y-1">
      <button type="button" onClick={() => onOpen(beat.id, "structure")}
        className="group flex w-full items-start gap-2 rounded-md py-0.5 pr-2 text-left transition-colors hover:bg-[hsl(var(--pv-surface-2))]/50">
        <span className={`pv-mono mt-px w-3 shrink-0 text-center text-[12px] ${hollow ? "text-amber-500" : c.connector ? ACCENT : FAINT}`} title={hollow ? "hollow causal link" : c.connector ?? "no connector"}>{glyph}</span>
        <span className={`pv-serif min-w-0 flex-1 truncate text-[12.5px] ${str(c.summary) ? "text-foreground" : FAINT}`}>{str(c.summary) ?? "empty beat"}</span>
        <Turn p={c.polarity} className="mt-px shrink-0 text-[12px]" />
        <ChevronRight className={`mt-0.5 h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 ${FAINT}`} />
      </button>
      {scenes.length > 0 && (
        <div className="flex flex-wrap gap-1 pl-5">
          {scenes.map((s) => <SceneChip key={s.id} scene={s} onOpen={() => onOpen(s.id, "scenes")} />)}
        </div>
      )}
    </div>
  );
}

export function DnaStoryMap({ nodes, onOpen }: {
  nodes: DnaNode[]; onOpen: (stage: StageKey, focusId?: string) => void;
}) {
  const acts = nodes.filter((n) => n.kind === "act").sort((a, b) => a.position - b.position);
  if (!acts.length) return null;

  const scenes = scenesInOrder(nodes);
  const beats = beatsInOrder(nodes);
  const units = scenes.length ? scenes : beats; // finest reading-order grain available
  const causalBy = new Map(causality(nodes).map((r) => [r.beatId, r]));

  // units per act for the contour's dividers
  const beatsOf = (m: DnaNode) => childrenOf(nodes, m.id).filter((b) => b.kind === "beat");
  const unitsByAct = acts.map((m) =>
    scenes.length ? beatsOf(m).reduce((a, b) => a + childrenOf(nodes, b.id).filter((s) => s.kind === "scene").length, 0) : beatsOf(m).length);

  const open = (id: string, stage: StageKey) => onOpen(stage, id);

  return (
    <div className="space-y-3">
      {/* the emotional shape — value rising/falling across the whole book */}
      {units.length >= 2 && (
        <div className="rounded-lg border border-[hsl(var(--pv-border-soft))]/60 bg-background/30 px-3 py-2">
          <div className="mb-1 flex items-center justify-between">
            <span className={`pv-mono text-[8px] uppercase tracking-[0.12em] ${FAINT}`}>emotional contour · value over reading order</span>
            <span className="pv-mono flex items-center gap-2 text-[8px] text-[hsl(var(--pv-text-faint))]">
              <span className="flex items-center gap-0.5 text-emerald-500">↗ up</span>
              <span className="flex items-center gap-0.5 text-rose-500">↘ down</span>
            </span>
          </div>
          <Contour units={units} unitsByAct={unitsByAct} />
        </div>
      )}

      {/* the beat-by-beat spine, grouped by act */}
      <div className="space-y-3">
        {acts.map((m, i) => {
          const mc = m.content as ActContent;
          const actBeats = beatsOf(m);
          const v = mc.value;
          return (
            <section key={m.id} className="space-y-1.5">
              <button type="button" onClick={() => open(m.id, "structure")}
                className="group flex w-full items-baseline gap-2.5 border-b border-[hsl(var(--pv-border-soft))]/60 pb-1 text-left">
                <Eyebrow tone="accent" className="shrink-0">act {i + 1}</Eyebrow>
                <span className={`pv-serif min-w-0 flex-1 truncate text-[13px] ${str(mc.title) ? "text-foreground" : FAINT}`}>{str(mc.title) ?? str(mc.goal) ?? "untitled act"}</span>
                {v?.from && v?.to && (
                  <span className={`pv-mono hidden shrink-0 text-[9px] ${MUTED} sm:inline`}>{v.from} <Turn p={v.polarity} /> {v.to}</span>
                )}
                {typeof mc.target_pct === "number" && <span className={`pv-mono shrink-0 text-[9px] ${FAINT}`}>{Math.round(mc.target_pct * 100)}%</span>}
              </button>
              {actBeats.length === 0
                ? <p className={`pv-serif pl-5 text-[11.5px] italic ${FAINT}`}>no beats yet</p>
                : actBeats.map((b) => (
                  <BeatRow key={b.id} beat={b} scenes={childrenOf(nodes, b.id).filter((s) => s.kind === "scene")}
                    causal={causalBy.get(b.id)} onOpen={open} />
                ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}
