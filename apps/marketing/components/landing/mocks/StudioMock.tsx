import { Check, Plus, Sparkles } from "lucide-react";
import { UIFrame } from "../UIFrame";

/**
 * The Studio — the chat-first, three-pane build workbench.
 * Mirrors apps/web/src/components/book/studio/BuildStudio.tsx: a Navigator
 * (the build ladder + the whole-book map) on the left, a Stage (the open
 * step's editor) in the middle, and an always-on AI chat Rail
 * (ReviseChat.tsx) on the right that generates and revises the open layer.
 *
 * Pure server component — full-bleed panes (p-0 + dividers) so it reads as the
 * real workbench rather than stacked cards.
 */

type Step = { label: string; state: "done" | "active" | "ready" | "locked" };
const STEPS: Step[] = [
  { label: "Brief", state: "done" },
  { label: "Foundations", state: "done" },
  { label: "Spine", state: "done" },
  { label: "Outline", state: "active" },
  { label: "Beats", state: "ready" },
  { label: "Draft", state: "locked" },
];
const POST: Step[] = [
  { label: "Read", state: "locked" },
  { label: "Publish", state: "locked" },
];

// A map page: filled dot = drafted; ring = planned objective.
const MAP: Array<{ title: string; planned: boolean; written: boolean; tentpole?: boolean }> = [
  { title: "The Lighthouse Keeper", planned: true, written: true },
  { title: "Salvage", planned: true, written: true },
  { title: "Across the Water", planned: true, written: false, tentpole: true },
];

function StepDot({ state }: { state: Step["state"] }) {
  if (state === "done")
    return (
      <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[hsl(var(--pv-accent))]">
        <Check className="h-2.5 w-2.5 text-[hsl(var(--pv-bg))]" />
      </span>
    );
  if (state === "active")
    return <span className="h-3.5 w-3.5 rounded-full border-[2px] border-[hsl(var(--pv-accent))]" />;
  if (state === "ready")
    return <span className="h-3.5 w-3.5 rounded-full border-[1.5px] border-[hsl(var(--pv-text-faint))]" />;
  return <span className="h-3.5 w-3.5 rounded-full border-[1.5px] border-dashed border-[hsl(var(--pv-text-faint))]/50" />;
}

function StepRow({ step, n }: { step: Step; n: number }) {
  const active = step.state === "active";
  return (
    <div
      className={`relative flex items-center gap-2.5 rounded-md px-2 py-1.5 ${active ? "bg-[hsl(var(--pv-surface-2))]" : ""}`}
    >
      {active && (
        <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-[hsl(var(--pv-accent))]" />
      )}
      <StepDot state={step.state} />
      <span className="pv-mono w-3 text-[9px] text-[hsl(var(--pv-text-faint))]">{n}</span>
      <span
        className={`pv-serif text-[13px] ${
          active
            ? "font-semibold text-[hsl(var(--pv-accent))]"
            : step.state === "locked"
              ? "text-[hsl(var(--pv-text-faint))]"
              : "text-foreground"
        }`}
      >
        {step.label}
      </span>
    </div>
  );
}

export function StudioMock() {
  return (
    <UIFrame crumb="Salt & Lamplight · build studio" bodyClassName="p-0">
      <div className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        {/* ── Navigator: the build ladder + the whole-book map ── */}
        <div className="border-r border-border bg-[hsl(var(--pv-surface-2))]/40 px-3 py-3.5">
          <div className="flex items-center justify-between px-1 pb-1.5">
            <span className="pv-mono text-[9px] uppercase tracking-[0.16em] text-[hsl(var(--pv-text-muted))]">
              Build
            </span>
            <span className="pv-serif text-[10px] italic text-[hsl(var(--pv-text-faint))]">
              step 4 / 8
            </span>
          </div>
          {STEPS.map((s, i) => (
            <StepRow key={s.label} step={s} n={i + 1} />
          ))}
          <div className="mx-2 my-1.5 h-px bg-[hsl(var(--pv-border-soft))]" />
          {POST.map((s, i) => (
            <StepRow key={s.label} step={s} n={i + 7} />
          ))}

          <div className="mt-4 flex items-center justify-between px-1 pb-1.5">
            <span className="pv-mono text-[9px] uppercase tracking-[0.16em] text-[hsl(var(--pv-text-muted))]">
              The book · map
            </span>
            <span className="pv-serif text-[10px] italic text-[hsl(var(--pv-text-faint))]">
              62% · 1 gap
            </span>
          </div>
          <div className="pv-mono px-2 pb-1 text-[8.5px] uppercase tracking-[0.14em] text-[hsl(var(--pv-text-muted))]">
            I · The Strait
          </div>
          {MAP.map((p) => (
            <div key={p.title} className="flex items-center gap-2 rounded-md px-2 py-1 pl-3">
              <span
                className="h-2 w-2 shrink-0 rounded-full border-[1.4px]"
                style={{
                  background: p.written ? "hsl(var(--pv-accent))" : "transparent",
                  borderColor: p.planned ? "hsl(var(--pv-accent))" : "hsl(var(--pv-text-faint))",
                }}
              />
              <span className="truncate pv-serif text-[12px] text-[hsl(var(--pv-text-muted))]">
                {p.tentpole && <span className="mr-1 text-[hsl(var(--pv-accent))]">◆</span>}
                {p.title}
              </span>
            </div>
          ))}
        </div>

        {/* ── Rail: the always-on AI chat that builds the open layer ── */}
        <div className="flex flex-col px-3.5 py-3.5">
          <div className="flex items-center gap-1.5 pb-2">
            <Sparkles className="h-3 w-3 text-[hsl(var(--pv-accent))]" />
            <span className="pv-mono text-[9px] uppercase tracking-[0.16em] text-[hsl(var(--pv-text-muted))]">
              Outline editor
            </span>
          </div>

          {/* assistant turn */}
          <p className="pv-serif text-[12.5px] leading-snug text-foreground">
            Here&apos;s a tighter Act II — I split the salvage into two pages and
            pulled the rival keeper&apos;s reveal earlier so the middle stops
            sagging.
          </p>

          {/* the proposal it surfaces inline */}
          <div className="mt-2.5 rounded-lg border border-[hsl(var(--pv-accent))]/45 bg-[hsl(var(--pv-accent))]/[0.05] px-3 py-2.5">
            <div className="pv-mono pb-1.5 text-[9px] uppercase tracking-[0.14em] text-[hsl(var(--pv-accent))]">
              Proposed · 2 changes
            </div>
            <div className="space-y-1">
              <p className="pv-serif text-[12px] leading-snug text-foreground">
                <span className="pv-mono text-[10px] text-[hsl(var(--pv-accent))]">+ add</span>{" "}
                “The Wreck Remembered” — the journal&apos;s first secret
              </p>
              <p className="pv-serif text-[12px] leading-snug text-foreground">
                <span className="pv-mono text-[10px] text-[hsl(var(--pv-text-muted))]">↪ move</span>{" "}
                “Across the Water” before the salvage
              </p>
            </div>
            <div className="mt-2.5 flex gap-2">
              <span className="pv-sans inline-flex items-center gap-1 rounded-md bg-foreground px-2.5 py-1 text-[11px] font-medium text-[hsl(var(--pv-bg))]">
                <Check className="h-3 w-3" /> Apply
              </span>
              <span className="pv-sans inline-flex items-center rounded-md border border-border px-2.5 py-1 text-[11px] text-[hsl(var(--pv-text-muted))]">
                Discard
              </span>
            </div>
          </div>

          {/* the composer */}
          <div className="mt-auto flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5">
            <span className="pv-serif flex-1 text-[12px] italic text-[hsl(var(--pv-text-faint))]">
              Ask or change the outline…
            </span>
            <Plus className="h-3.5 w-3.5 text-[hsl(var(--pv-text-faint))]" />
          </div>
        </div>
      </div>
    </UIFrame>
  );
}
