// studioUi — the small shared primitives the Navigator and Stage both compose: resolution pips, the
// step dot, and the Stage's head / hero / gate chrome. Pure presentation, Paper-DS tokens only.
import { type ReactNode } from "react";
import { AlertTriangle, ArrowRight, Check, Loader2, Lock } from "lucide-react";
import type { CellState } from "@/lib/planGraph";
import type { DotState } from "./studioModel";

// A single resolution pip. The amber out-of-sync literal is the one DS-sanctioned hard colour.
export function Pip({ state, size = 8 }: { state: CellState; size?: number }) {
  const cls =
    state === "synced" ? "bg-[hsl(var(--pv-accent))]"
      : state === "drift" ? "bg-amber-500"
        : "border-[1.5px] border-[hsl(var(--pv-text-faint))]/60 bg-transparent";
  return <span className={`inline-block shrink-0 rounded-full transition-colors ${cls}`} style={{ width: size, height: size }} aria-hidden />;
}

// A page's freshness at a glance: objective · beat · prose.
export function Pip3({ objective, beat, prose, size = 7 }: { objective: CellState; beat: CellState; prose: CellState; size?: number }) {
  return (
    <span className="flex items-center gap-1.5">
      <Pip state={objective} size={size} />
      <Pip state={beat} size={size} />
      <Pip state={prose} size={size} />
    </span>
  );
}

// The Navigator's step glyph. done = filled accent check; active = accent ring + inner dot; ready =
// quiet ring; locked = padlock.
export function StepDot({ state }: { state: DotState }) {
  if (state === "done")
    return (
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[hsl(var(--pv-accent))] text-background">
        <Check className="h-3 w-3" strokeWidth={3.2} />
      </span>
    );
  if (state === "active")
    return (
      <span className="flex h-5 w-5 items-center justify-center rounded-full border-[1.5px] border-[hsl(var(--pv-accent))]">
        <span className="h-[7px] w-[7px] rounded-full bg-[hsl(var(--pv-accent))]" />
      </span>
    );
  if (state === "ready")
    return <span className="flex h-5 w-5 items-center justify-center"><span className="h-3 w-3 rounded-full border-[1.5px] border-[hsl(var(--pv-text-muted))]" /></span>;
  return <span className="flex h-5 w-5 items-center justify-center text-[hsl(var(--pv-text-faint))]"><Lock className="h-3 w-3" /></span>;
}

// The Stage's heading block: eyebrow → serif title → italic caption, with an optional right slot.
export function StageHead({ eyebrow, title, caption, right }: { eyebrow: string; title: string; caption?: string; right?: ReactNode }) {
  return (
    <div className="mb-6">
      <div className="flex items-center justify-between gap-4">
        <span className="pv-mono text-[10.5px] uppercase tracking-[0.18em] text-[hsl(var(--pv-accent))]">{eyebrow}</span>
        {right}
      </div>
      <h1 className="pv-serif mt-3 text-[40px] leading-[1.02] tracking-[-0.018em] text-foreground">{title}</h1>
      {caption && <p className="pv-serif mt-3 max-w-[580px] text-[17px] italic leading-[1.5] text-[hsl(var(--pv-text-muted))]">{caption}</p>}
    </div>
  );
}

// The dominant "next move" card — the brief's "obvious next move" made visually loud.
export function Hero({ icon, title, sub, onClick, disabled }: { icon: ReactNode; title: string; sub: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="group flex w-full items-center gap-5 rounded-2xl border border-[hsl(var(--pv-accent))]/35 bg-[hsl(var(--pv-surface-2))]/50 px-6 py-6 text-left shadow-[0_14px_36px_rgba(0,0,0,0.06)] transition-transform hover:-translate-y-px disabled:pointer-events-none disabled:opacity-60"
    >
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[hsl(var(--pv-accent))]/[0.08] text-[hsl(var(--pv-accent))]">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="pv-serif block text-[22px] font-semibold leading-tight tracking-[-0.01em] text-foreground">{title}</span>
        <span className="pv-serif mt-1 block text-[15px] leading-snug text-[hsl(var(--pv-text-muted))]">{sub}</span>
      </span>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform group-hover:translate-x-0.5">
        <ArrowRight className="h-4 w-4" />
      </span>
    </button>
  );
}

// The deliberate gate: an "Approve & continue" sign-off with a one-line rationale beside it.
export function Gate({ label, enabled, onClick, hint, busy }: { label: string; enabled: boolean; onClick?: () => void; hint?: string; busy?: boolean }) {
  return (
    <div className="mt-6 flex flex-wrap items-center gap-4">
      <button
        type="button"
        onClick={enabled && !busy ? onClick : undefined}
        disabled={!enabled || busy}
        className="pv-serif inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-[15px] text-primary-foreground transition-transform active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Check className="h-4 w-4" /> {busy ? "Saving…" : label}
      </button>
      {hint && <span className="pv-serif text-[13.5px] italic text-[hsl(var(--pv-text-muted))]">{hint}</span>}
    </div>
  );
}

// A live durable-run card: the machine working, with optional progress and a stalled escalation. The
// recovery affordances (cancel / restart) are passed in as `controls` (the shared RunControls).
export function RunningCard({ label, sub, done, total, unit, stuck, controls }: {
  label: string; sub?: string; done?: number; total?: number; unit?: string; stuck?: boolean; controls?: ReactNode;
}) {
  const pct = total ? Math.round(((done ?? 0) / total) * 100) : null;
  return (
    <div className={`rounded-2xl border bg-[hsl(var(--pv-surface-2))]/60 px-6 py-5 ${stuck ? "border-amber-500/60" : "border-border"}`}>
      <div className="flex items-center gap-3.5">
        <span className={stuck ? "text-amber-500" : "text-[hsl(var(--pv-accent))]"}>
          {stuck ? <AlertTriangle className="h-5 w-5" /> : <Loader2 className="h-5 w-5 animate-spin" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="pv-serif flex items-center gap-2.5 text-[18px] font-semibold text-foreground">
            {stuck ? "Run stalled" : label}
            {!stuck && unit && total != null && <span className="pv-mono text-[11px] text-[hsl(var(--pv-text-muted))]">{done}/{total} {unit}s</span>}
          </div>
          <div className="pv-serif mt-0.5 text-[13.5px] italic text-[hsl(var(--pv-text-muted))]">
            {stuck ? "It hasn't progressed in a while. Restart picks up where it left off — your work so far is kept." : (sub ?? "Runs in the background — keep working, or leave and come back. It survives a refresh.")}
          </div>
        </div>
      </div>
      {pct != null && (
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-[hsl(var(--pv-border-soft))]">
          <div className={`h-full rounded-full transition-[width] duration-300 ${stuck ? "bg-amber-500" : "bg-[hsl(var(--pv-accent))]"}`} style={{ width: `${pct}%` }} />
        </div>
      )}
      {controls && <div className="mt-3">{controls}</div>}
    </div>
  );
}

// A thin labelled progress meter (e.g. "written so far · 7 / 19 pages").
export function ProgressMeter({ verb, filled, total, noun }: { verb: string; filled: number; total: number; noun: string }) {
  const pct = total ? Math.round((filled / total) * 100) : 0;
  return (
    <div className="mb-4 flex items-center gap-3.5 rounded-2xl border border-border bg-[hsl(var(--pv-surface-2))]/40 px-5 py-4">
      <span className="pv-mono text-[10px] uppercase tracking-[0.12em] text-[hsl(var(--pv-text-faint))]">{verb}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[hsl(var(--pv-border-soft))]">
        <div className="h-full rounded-full bg-[hsl(var(--pv-accent))] transition-[width] duration-500" style={{ width: `${pct}%` }} />
      </div>
      <span className="pv-mono text-[10px] text-[hsl(var(--pv-text-faint))]">{filled} / {total} {noun}s</span>
    </div>
  );
}

// A calm "level cleared" summary strip (every beat planned / every page written / published).
export function DoneStrip({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-border bg-[hsl(var(--pv-surface-2))]/60 px-6 py-5">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[hsl(var(--pv-accent))]/[0.08] text-[hsl(var(--pv-accent))]">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="pv-serif text-[18px] font-semibold text-foreground">{title}</div>
        {children && <div className="pv-serif mt-0.5 text-[14px] text-[hsl(var(--pv-text-muted))]">{children}</div>}
      </div>
    </div>
  );
}
