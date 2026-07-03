// DnaStageDiagram — DnaFullDiagram, the whole DNA tree as one connected pipeline (Overview's "the shape"
// panel). Reflects real counts/budgets where cheap (act widths from target_pct, beat ticks from beat
// counts), conceptual otherwise. Pure presentation; Paper-DS tokens via currentColor.
// (The per-stage schematics that used to live here — Premise/Foundations/Structure/Scenes/Draft — were
// pruned with the vanilla DnaStudio, their only caller; docs/plan-one-studio-consolidation.md Phase 4.)
import type { ReactNode } from "react";
import type { StageKey } from "@/features/dna/lib/dnaJourney";
import { beatsInOrder, scenesInOrder, topography, type BeatContent, type DnaNode, type GameContent, type ActContent, type SceneContent, type ThreadContent } from "@/features/dna/lib/novelDna";

const ACCENT = "text-[hsl(var(--pv-accent))]";
const FAINT = "text-[hsl(var(--pv-text-faint))]";
const MUTED = "text-[hsl(var(--pv-text-muted))]";

// ── Full view: the WHOLE DNA as one connected pipeline ──────────────────────────
// The five level-shapes stacked top→bottom on a single spine, each reflecting LIVE data (entity counts, act
// budgets, beat ticks, the value-polarity strip, the drafted fraction) — so the Overview reads the entire
// book's shape in one glance. Each band is clickable and jumps into the stage that owns it.
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

// ── Spanning lanes: threads (promises) + games (contests) drawn ACROSS the spine ─
// A thread/game isn't at one point — it ARCS across the book. We place each over the reading-order axis
// (scenes if drafted, else beats): a thread from its setup → payoff, a game from first-play → resolution.
// The lanes make the "spanning" nature literal, and flag the same faults the analysis panel does: a
// dangling promise (set up, never paid), an unresolved game (played, never decided), a half-open game
// (missing a win or lose condition — no real stakes). Defined-but-unwoven elements show as a dim dashed lane.
interface Span { id: string; name: string; a: number | null; b: number | null; outcome?: "won" | "lost"; flag?: "dangling" | "unresolved" | "halfopen" }

function computeSpans(nodes: DnaNode[]): { threads: Span[]; games: Span[]; turns: number } {
  const scenes = scenesInOrder(nodes);
  const turns = scenes.length ? scenes : beatsInOrder(nodes);
  const N = turns.length;
  const pos = (i: number) => (N ? (i + 0.5) / N : 0);

  const threads: Span[] = nodes.filter((n) => n.kind === "thread").map((t) => {
    const refs: number[] = []; let firstSetup = -1, lastPayoff = -1;
    turns.forEach((turn, i) => {
      for (const r of ((turn.content as SceneContent | BeatContent).threads ?? [])) {
        if (r.ref !== t.id) continue;
        refs.push(i);
        if (r.role === "setup" && firstSetup < 0) firstSetup = i;
        if (r.role === "payoff") lastPayoff = i;
      }
    });
    const name = (t.content as ThreadContent).name ?? "thread";
    if (!refs.length) return { id: t.id, name, a: null, b: null };
    const a = Math.min(...refs), b = Math.max(...refs);
    const flag = firstSetup >= 0 && lastPayoff < 0 ? "dangling" as const : undefined;
    return { id: t.id, name, a: pos(a), b: pos(b), flag };
  });

  const games: Span[] = nodes.filter((n) => n.kind === "game").map((g) => {
    const c = g.content as GameContent;
    const refs: number[] = []; let resolveIdx = -1; let outcome: "won" | "lost" | undefined;
    turns.forEach((turn, i) => {
      const tc = turn.content as SceneContent | BeatContent;
      if ((tc.plays ?? []).includes(g.id)) refs.push(i);
      for (const r of (tc.resolves ?? [])) if (r.ref === g.id) { refs.push(i); resolveIdx = i; outcome = r.outcome; }
    });
    const name = c.name ?? "game";
    const halfopen = !c.win_condition || !c.lose_condition;
    if (!refs.length) return { id: g.id, name, a: null, b: null, flag: halfopen ? "halfopen" : undefined };
    const a = Math.min(...refs), b = Math.max(...refs);
    const flag = halfopen ? "halfopen" as const : resolveIdx < 0 ? "unresolved" as const : undefined;
    return { id: g.id, name, a: pos(a), b: pos(b), outcome: resolveIdx >= 0 ? outcome : undefined, flag };
  });

  return { threads, games, turns: N };
}

// One spanning lane: a short name, then a positioned bar over the 0→1 reading-order axis.
function Lane({ span, kind }: { span: Span; kind: "thread" | "game" }) {
  const flagged = !!span.flag;
  const barColor = flagged ? "bg-amber-500/70" : kind === "thread" ? "bg-[hsl(var(--pv-accent))]/70" : "bg-[hsl(var(--pv-text-muted))]";
  const unwoven = span.a === null;
  const left = `${(span.a ?? 0) * 100}%`;
  const width = `${Math.max(((span.b ?? 0) - (span.a ?? 0)) * 100, 1.5)}%`;
  const tip = [span.name, span.flag ? `⚠ ${span.flag}` : "", span.outcome ? `→ ${span.outcome}` : ""].filter(Boolean).join(" · ");
  return (
    <div className="flex items-center gap-2" title={tip}>
      <span className={`pv-mono w-14 shrink-0 truncate text-[8px] uppercase tracking-[0.06em] ${flagged ? "text-amber-500" : unwoven ? FAINT : MUTED}`}>{span.name}</span>
      <div className="relative h-2 flex-1">
        <span className={`absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 ${FAINT} bg-current opacity-25`} />
        {unwoven ? (
          <span className={`absolute left-0 top-1/2 h-px w-full -translate-y-1/2 border-t border-dashed ${FAINT} border-current opacity-40`} />
        ) : (
          <>
            <span className={`absolute top-1/2 h-[3px] -translate-y-1/2 rounded-full ${barColor}`} style={{ left, width }} />
            {/* setup/start endpoint */}
            <span className={`absolute top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full ${barColor}`} style={{ left }} />
            {/* payoff / resolution endpoint — games show the win/lose outcome as a colored square */}
            {kind === "game" && span.outcome ? (
              <span className={`absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-sm ${span.outcome === "won" ? "bg-emerald-500/80" : "bg-rose-500/70"}`} style={{ left: `${(span.b ?? 0) * 100}%` }} />
            ) : (
              <span className={`absolute top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full ${flagged ? "border border-amber-500/70 bg-transparent" : barColor}`} style={{ left: `${(span.b ?? 0) * 100}%` }} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

// The combined spanning view: thread lanes (promises ↗) over game lanes (contests · win/lose). Caps the
// rows so it stays a legend, not a wall; the full registry lives in the Structure stage + analysis panel.
function SpanLanes({ nodes, cap = 5 }: { nodes: DnaNode[]; cap?: number }) {
  const { threads, games } = computeSpans(nodes);
  if (!threads.length && !games.length) return null;
  const tShown = threads.slice(0, cap), gShown = games.slice(0, cap);
  return (
    <div className="space-y-2">
      {threads.length > 0 && (
        <div className="space-y-1">
          <p className={`pv-mono text-[8px] uppercase tracking-[0.1em] ${FAINT}`}>promises · setup → payoff ({threads.length})</p>
          {tShown.map((s) => <Lane key={s.id} span={s} kind="thread" />)}
          {threads.length > cap && <p className={`pv-mono pl-16 text-[8px] ${FAINT}`}>+{threads.length - cap} more</p>}
        </div>
      )}
      {games.length > 0 && (
        <div className="space-y-1">
          <p className={`pv-mono text-[8px] uppercase tracking-[0.1em] ${FAINT}`}>games · play → win / lose ({games.length})</p>
          {gShown.map((s) => <Lane key={s.id} span={s} kind="game" />)}
          {games.length > cap && <p className={`pv-mono pl-16 text-[8px] ${FAINT}`}>+{games.length - cap} more</p>}
        </div>
      )}
    </div>
  );
}

function CountChip({ n, label }: { n: number; label: string }) {
  return (
    <span className={`pv-mono text-[9px] uppercase tracking-[0.09em] ${n === 0 ? FAINT : MUTED}`}>
      <b className={`font-semibold ${n === 0 ? FAINT : "text-foreground"}`}>{n}</b> {label}
    </span>
  );
}

// One band on the spine: a node dot + connector line, a stage label, and the band's live mini-diagram.
function Band({ label, last, onOpen, children }: { label: string; last?: boolean; onOpen?: () => void; children: ReactNode }) {
  const inner = (
    <>
      <div className="relative flex w-5 shrink-0 justify-center">
        {!last && <span className="absolute left-1/2 top-3 bottom-[-14px] w-px -translate-x-1/2 bg-[hsl(var(--pv-border-soft))]" />}
        <span className={`mt-1 h-2 w-2 rounded-full bg-current ${ACCENT}`} />
      </div>
      <div className="min-w-0 flex-1 pb-3.5">
        <span className={`pv-mono text-[9px] uppercase tracking-[0.14em] ${MUTED}`}>{label}</span>
        <div className="mt-1.5">{children}</div>
      </div>
    </>
  );
  return onOpen ? (
    <button type="button" onClick={onOpen} className="group flex w-full gap-2.5 rounded-md px-1.5 py-0.5 text-left transition-colors hover:bg-[hsl(var(--pv-surface-2))]/50">{inner}</button>
  ) : (
    <div className="flex w-full gap-2.5 px-1.5 py-0.5">{inner}</div>
  );
}

export function DnaFullDiagram({ nodes, onOpen }: { nodes: DnaNode[]; onOpen?: (stage: StageKey) => void }) {
  const of = (k: DnaNode["kind"]) => nodes.filter((n) => n.kind === k);
  const premise = of("premise")[0], seed = of("seed")[0], pillar = of("pillar")[0];
  const acts = of("act");
  const beatsOf = (m: DnaNode) => nodes.filter((n) => n.kind === "beat" && n.parent_id === m.id).length;
  const scenes = of("scene");
  const drafted = scenes.filter((s) => str((s.content as { prose?: { text?: string } }).prose?.text)).length;
  const topo = topography(nodes);

  // act budget → widths + beat ticks (live; equal fallback if no target_pct set)
  const raw = acts.map((m) => (m.content as ActContent).target_pct ?? 0);
  const sum = raw.reduce((a, b) => a + b, 0);
  const widths = sum > 0 ? raw.map((p) => p / sum) : raw.map(() => 1 / Math.max(raw.length, 1));

  const headline = str((premise?.content as { dramatic_question?: string })?.dramatic_question)
    ?? str((seed?.content as { logline?: string })?.logline)
    ?? "—";

  return (
    <div className="flex flex-col">
      {/* PREMISE — the root line everything inherits */}
      <Band label="premise · root" onOpen={onOpen && (() => onOpen("premise"))}>
        <p className={`pv-serif truncate text-[12.5px] italic ${premise || seed ? "text-foreground" : FAINT}`}>“{headline}”</p>
      </Band>

      {/* FOUNDATIONS — the interlinked web, as live counts off the pillar */}
      <Band label="foundations · the web" onOpen={onOpen && (() => onOpen("foundations"))}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className={`pv-mono text-[9px] uppercase tracking-[0.09em] ${pillar ? ACCENT : FAINT}`}>{pillar ? "pillar ✓" : "pillar —"}</span>
          <span className={FAINT}>·</span>
          <CountChip n={of("character").length} label="cast" />
          <CountChip n={of("world_fact").length} label="world" />
          <CountChip n={of("relationship").length} label="rel" />
          <CountChip n={of("tentpole").length} label="tent-poles" />
        </div>
      </Band>

      {/* STRUCTURE — the serial, budgeted act track with nested beats; threads above, games below */}
      <Band label="structure · the spine" onOpen={onOpen && (() => onOpen("structure"))}>
        {acts.length === 0 ? (
          <p className={`pv-serif text-[12px] italic ${FAINT}`}>no acts yet</p>
        ) : (
          <div className="space-y-1.5">
            {/* the budgeted act track with nested beat ticks */}
            <div className="flex items-stretch gap-1">
              {widths.map((w, i) => (
                <div key={i} className={`flex flex-col justify-between rounded border ${MUTED} border-current/40 bg-current/[0.04] px-1.5 py-1`} style={{ flex: `${w} 1 0%` }}>
                  <span className={`pv-mono text-[8px] uppercase tracking-[0.07em] ${MUTED}`}>act {i + 1}{beatsOf(acts[i]) ? ` · ${beatsOf(acts[i])}` : ""}</span>
                  <div className="mt-1 flex items-center gap-[3px]">
                    {Array.from({ length: Math.max(1, Math.min(beatsOf(acts[i]) || 1, 6)) }).map((_, b) => (
                      <span key={b} className={`h-1 w-1 rounded-full bg-current ${ACCENT}`} />
                    ))}
                    {beatsOf(acts[i]) > 6 && <span className={`pv-mono text-[7px] leading-none ${MUTED}`}>+{beatsOf(acts[i]) - 6}</span>}
                  </div>
                </div>
              ))}
            </div>
            {/* the spanning layer — threads + games arced over the same reading-order axis as the acts */}
            <SpanLanes nodes={nodes} />
          </div>
        )}
      </Band>

      {/* SCENES — the live value-polarity strip (the emotional topography) */}
      <Band label="scenes · value turns" onOpen={onOpen && (() => onOpen("scenes"))}>
        {scenes.length === 0 ? (
          <p className={`pv-serif text-[12px] italic ${FAINT}`}>no scenes yet</p>
        ) : (
          <div className="flex items-center gap-2">
            <div className="flex flex-1 flex-wrap gap-0.5">
              {topo.map((t, i) => (
                <span key={i} className={`inline-block h-3 w-1.5 rounded-sm ${t.polarity === "up" ? "bg-emerald-500/70" : t.polarity === "down" ? "bg-rose-500/60" : "bg-[hsl(var(--pv-border-soft))]"}`} title={t.polarity ?? "flat"} />
              ))}
            </div>
            <span className={`pv-mono shrink-0 text-[8px] uppercase tracking-[0.08em] ${FAINT}`}>{scenes.length} scenes</span>
          </div>
        )}
      </Band>

      {/* DRAFT — the tree rendered to pages, with the live drafted fraction */}
      <Band label="draft · the pages" last onOpen={onOpen && (() => onOpen("draft"))}>
        <div className="flex items-center gap-2.5">
          <div className={`flex-1 space-y-1 rounded border ${FAINT} border-current/40 px-2 py-1.5`}>
            {[1, 0.94, 0.97, 0.6].map((w, i) => (
              <span key={i} className={`block h-1 rounded-full ${i === 0 ? `${ACCENT} bg-current opacity-100` : `${FAINT} bg-current opacity-50`}`} style={{ width: `${w * 100}%` }} />
            ))}
          </div>
          <span className={`pv-mono shrink-0 text-[8px] uppercase tracking-[0.08em] ${scenes.length && drafted === scenes.length ? ACCENT : FAINT}`}>
            {scenes.length ? `${drafted}/${scenes.length} drafted` : "—"}
          </span>
        </div>
      </Band>
    </div>
  );
}
