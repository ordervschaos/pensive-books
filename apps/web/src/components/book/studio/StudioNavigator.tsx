// StudioNavigator — the studio's left column. The 8-step build ladder (top) and the whole-book map
// (below), joined by one continuous thread so the sequence and the depth read as one surface. Click a
// step → the Stage becomes that step's tool; click a page → the Stage becomes that page's resolution
// ladder. Status comes entirely from the derived model.
import { ChevronRight, ChevronDown, Loader2 } from "lucide-react";
import { POST_STEPS, STEP_LABEL, type StepKey, type StudioModel } from "./studioModel";
import { Pip3, StepDot } from "@/components/book/shared/studioUi";
import type { Selection } from "./BuildStudio";

interface NavigatorProps {
  model: StudioModel;
  selection: Selection;
  collapsed: Record<string, boolean>;
  /** The step with a live AI run, marked "● running" so the surface follows server truth (no refresh). */
  runningStep?: StepKey | null;
  /** Page ids with an in-flight scene-image render — badged in the map. */
  generatingPages?: Set<number>;
  onSelectStep: (k: StepKey) => void;
  onSelectPage: (pageId: number) => void;
  onToggleMovement: (key: string) => void;
}

export function StudioNavigator({ model, selection, collapsed, runningStep, generatingPages, onSelectStep, onSelectPage, onToggleMovement }: NavigatorProps) {
  // "step N" points at the live focus: the active/awaiting step, else (everything done) the topmost
  // step that's drifted out of sync with an upstream change.
  const activeIdx = model.buildSteps.findIndex((k) => model.statusOf(k) === "active" || model.statusOf(k) === "awaiting");
  const staleIdx = model.firstStale ? model.buildSteps.indexOf(model.firstStale) : -1;
  const stepNo = activeIdx !== -1 ? activeIdx : staleIdx;
  const stepLabel = stepNo === -1 ? model.buildSteps.length : stepNo + 1;

  return (
    <div className="relative h-full min-h-0 overflow-y-auto border-b border-[hsl(var(--pv-border-soft))] bg-[hsl(var(--pv-surface-2))]/40 px-4 pb-12 pt-5 md:border-b-0 md:border-r">
      <section className="relative">
        <Head left="Build" right={`step ${stepLabel} / ${model.buildSteps.length + POST_STEPS.length}`} />
        {model.buildSteps.map((k, i) => (
          <StepItem key={k} k={k} n={i + 1} model={model} selection={selection} running={runningStep === k} onSelect={onSelectStep} />
        ))}
        <div className="mx-2.5 my-1.5 h-px bg-[hsl(var(--pv-border-soft))]" />
        {POST_STEPS.map((k, i) => (
          <StepItem key={k} k={k} n={i + 7} model={model} selection={selection} running={runningStep === k} onSelect={onSelectStep} />
        ))}
      </section>

      <section className="relative mt-5">
        <Head left="The book · map" right={`${model.sync.pct}% · ${model.sync.gaps} gaps`} />
        {model.movements.map((m) => {
          const isCollapsed = !!collapsed[m.key];
          return (
            <div key={m.key} className="mb-0.5">
              <button
                type="button"
                onClick={() => onToggleMovement(m.key)}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left hover:bg-[hsl(var(--pv-surface-2))]"
              >
                <ChevronDown className={`h-3.5 w-3.5 text-[hsl(var(--pv-text-faint))] transition-transform ${isCollapsed ? "-rotate-90" : ""}`} />
                <span className="pv-mono text-[9.5px] uppercase tracking-[0.14em] text-[hsl(var(--pv-text-muted))]">
                  {m.num ? `${m.num} · ` : ""}{m.title}
                </span>
                <span className="ml-auto pv-mono text-[11px] text-[hsl(var(--pv-text-faint))]">{m.pages.length}</span>
              </button>
              {!isCollapsed && m.pages.map((p) => {
                const active = selection.kind === "page" && selection.pageId === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onSelectPage(p.id)}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 pl-[18px] text-left transition-colors ${active ? "bg-[hsl(var(--pv-accent))]/[0.08]" : "hover:bg-[hsl(var(--pv-surface-2))]"}`}
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full border-[1.4px] transition-colors"
                      style={{
                        background: p.beat !== "gap" && p.prose !== "gap" ? "hsl(var(--pv-accent))" : "transparent",
                        borderColor: p.objective !== "gap" ? "hsl(var(--pv-accent))" : "hsl(var(--pv-text-faint))",
                      }}
                    />
                    <span className={`flex-1 truncate pv-serif text-[13.5px] ${active ? "font-semibold text-foreground" : "text-[hsl(var(--pv-text-muted))]"}`}>
                      {model.tentpolePageIds.has(p.id) && (
                        <span className="mr-1 text-[hsl(var(--pv-accent))]" title="A tentpole moment lands here" aria-hidden>◆</span>
                      )}
                      {p.title || "(untitled)"}
                    </span>
                    {generatingPages?.has(p.id) && (
                      <span className="flex shrink-0 items-center gap-1 pv-mono text-[8.5px] uppercase tracking-[0.1em] text-[hsl(var(--pv-accent))]" title="A scene image is generating on this page">
                        <Loader2 className="h-3 w-3 animate-spin" />
                      </span>
                    )}
                    <Pip3 objective={p.objective} beat={p.beat} prose={p.prose} />
                  </button>
                );
              })}
            </div>
          );
        })}
        <div className="mt-3.5 flex flex-wrap items-center gap-x-3.5 gap-y-1 px-2.5 pv-serif text-[12px] text-[hsl(var(--pv-text-muted))]">
          <span className="flex items-center gap-1.5"><span className="h-[7px] w-[7px] rounded-full bg-[hsl(var(--pv-accent))]" /> written</span>
          <span className="flex items-center gap-1.5"><span className="h-[7px] w-[7px] rounded-full border-[1.5px] border-[hsl(var(--pv-text-faint))]/60" /> planned</span>
          <span className="italic text-[hsl(var(--pv-text-faint))]">objective · beat · prose</span>
        </div>
      </section>
    </div>
  );
}

function Head({ left, right }: { left: string; right: string }) {
  return (
    <div className="flex items-center justify-between px-2 pb-2.5">
      <span className="pv-mono text-[10px] uppercase tracking-[0.18em] text-[hsl(var(--pv-text-muted))]">{left}</span>
      <span className="pv-serif text-[11px] italic text-[hsl(var(--pv-text-faint))]">{right}</span>
    </div>
  );
}

function StepItem({ k, n, model, selection, running, onSelect }: { k: StepKey; n: number; model: StudioModel; selection: Selection; running?: boolean; onSelect: (k: StepKey) => void }) {
  const status = model.statusOf(k);
  const dot = model.dotOf(k);
  const stale = model.staleOf(k);
  const locked = status === "locked";
  const selected = selection.kind === "step" && selection.step === k;
  return (
    <button
      type="button"
      disabled={locked}
      onClick={() => onSelect(k)}
      className={`relative flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
        selected ? "bg-[hsl(var(--pv-surface-2))]" : locked ? "cursor-default" : "hover:bg-[hsl(var(--pv-surface-2))]/70"
      }`}
    >
      {selected && <span aria-hidden className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-[hsl(var(--pv-accent))]" />}
      <StepDot state={dot} stale={stale} />
      <span className="pv-mono w-3 text-[9.5px] text-[hsl(var(--pv-text-faint))]">{n}</span>
      <span
        className={`pv-serif text-[15.5px] ${
          status === "active" ? "font-semibold text-[hsl(var(--pv-accent))]"
            : locked ? "text-[hsl(var(--pv-text-faint))]"
              : selected ? "font-semibold text-foreground" : "text-foreground"
        }`}
      >
        {STEP_LABEL[k]}
      </span>
      {/* A live run takes the right slot — it's the truest "where the work is" signal. */}
      {running ? (
        <span className="ml-auto flex items-center gap-1.5 pv-mono text-[9px] uppercase tracking-[0.12em] text-[hsl(var(--pv-accent))]">
          <span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--pv-accent))] animate-pulse" />running
        </span>
      ) : stale ? (
        // Done, but an upstream change has drifted it — flag where attention's needed next.
        <span className="ml-auto pv-mono text-[9px] uppercase tracking-[0.12em] text-amber-600 dark:text-amber-500">review</span>
      ) : (
        <>
          {status === "active" && <span className="ml-auto pv-mono text-[9px] uppercase tracking-[0.12em] text-[hsl(var(--pv-accent))]">now</span>}
          {status === "awaiting" && <span className="ml-auto pv-mono text-[9px] uppercase tracking-[0.12em] text-[hsl(var(--pv-text-muted))]">ready</span>}
          {status === "done" && <ChevronRight className="ml-auto h-3.5 w-3.5 text-[hsl(var(--pv-text-faint))]" />}
        </>
      )}
    </button>
  );
}
