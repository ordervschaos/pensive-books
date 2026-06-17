// studioUi — the small shared primitives the Navigator and Stage both compose: resolution pips, the
// step dot, and the Stage's head / hero / gate chrome. Pure presentation, Paper-DS tokens only.
import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { AlertTriangle, ArrowRight, Check, ChevronDown, ChevronUp, Loader2, Lock, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CellState } from "@/lib/planGraph";
import type { DotState } from "./studioModel";

// Propose button + optional nudge chips + freetext note, all coupled as one widget (C-Directions
// pattern). Chips accumulate on the button label ("Propose more · 2 notes"); the "+ note" chip
// reveals a textarea. onFire receives the assembled nudge string (chips joined with note).
export function GenRow({ label, descLabel, chips = [], onFire, busy, className }: {
  label: string;
  /** Short reassurance shown beside the button, e.g. "Adds fresh takes below — your chosen one stays selected." */
  descLabel?: string;
  /** Tappable preset chips for quick direction. Chip labels become the nudge text. */
  chips?: string[];
  /** Receives the assembled nudge note (empty string if none selected). */
  onFire: (note: string) => void;
  busy?: boolean;
  className?: string;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const noteRef = useRef<HTMLTextAreaElement>(null);

  const noteCount = selected.size + (noteOpen && noteText.trim() ? 1 : 0);
  const btnLabel = noteCount > 0 ? `${label} · ${noteCount} note${noteCount > 1 ? "s" : ""}` : label;

  const toggle = (chip: string) =>
    setSelected((prev) => { const n = new Set(prev); if (n.has(chip)) { n.delete(chip); } else { n.add(chip); } return n; });

  const fire = () => {
    const parts = [...selected, ...(noteOpen && noteText.trim() ? [noteText.trim()] : [])];
    onFire(parts.join(", "));
    setSelected(new Set());
    setNoteText("");
    setNoteOpen(false);
  };

  const hasChips = chips.length > 0;

  return (
    <div className={cn(className)}>
      <div className={cn(
        "rounded-[18px] border border-border bg-[hsl(var(--pv-surface-2))]/50",
        hasChips ? "px-5 py-4" : "px-4 py-3",
      )}>
        {/* Button row */}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={fire}
            disabled={busy}
            className="pv-serif inline-flex items-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-[15px] text-background transition-colors hover:bg-foreground/85 disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {btnLabel}
          </button>
          {descLabel && (
            <span className="pv-serif text-[13.5px] leading-snug text-[hsl(var(--pv-text-muted))]">
              <b className="font-medium not-italic">{descLabel.split(" — ")[0]}</b>
              {descLabel.includes(" — ") && (
                <span className="italic"> — {descLabel.split(" — ")[1]}</span>
              )}
            </span>
          )}
        </div>

        {/* Chips section */}
        {hasChips && (
          <div className="mt-3.5 border-t border-[hsl(var(--pv-border-soft))]/60 pt-3.5">
            <div className="pv-mono mb-2.5 text-[10px] uppercase tracking-[0.13em] text-[hsl(var(--pv-text-muted))]">
              Nudge them — tap any (optional)
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {chips.map((chip) => {
                const on = selected.has(chip);
                return (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => toggle(chip)}
                    className={cn(
                      "pv-serif rounded-full border px-3.5 py-1.5 text-[14px] leading-none transition-colors",
                      on
                        ? "border-[hsl(var(--pv-accent))] bg-[hsl(var(--pv-accent))] text-background"
                        : "border-border bg-[hsl(var(--pv-surface-2))]/80 text-[hsl(var(--pv-ink-soft,var(--pv-text-muted)))] hover:border-foreground/30",
                    )}
                  >
                    {chip}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => {
                  setNoteOpen((v) => !v);
                  if (!noteOpen) setTimeout(() => noteRef.current?.focus(), 60);
                }}
                className={cn(
                  "pv-serif rounded-full border px-3.5 py-1.5 text-[14px] italic leading-none transition-colors",
                  noteOpen
                    ? "border-[hsl(var(--pv-accent))] bg-[hsl(var(--pv-accent))] text-background"
                    : "border-dashed border-[hsl(var(--pv-accent))]/40 text-[hsl(var(--pv-accent))] hover:border-[hsl(var(--pv-accent))]/70",
                )}
              >
                + note
              </button>
            </div>
            {noteOpen && (
              <textarea
                ref={noteRef}
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="anything else the new takes should honor…"
                rows={2}
                className="pv-serif mt-3 w-full resize-none rounded-xl border border-border bg-[hsl(var(--pv-surface-2))] px-3.5 py-2.5 text-[14px] leading-relaxed placeholder:italic placeholder:text-[hsl(var(--pv-text-faint))] focus:border-[hsl(var(--pv-accent))]/40 focus:outline-none focus:ring-0"
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Full-screen image viewer. Shared by every studio surface that shows generated art. Click-outside or
// Esc closes; the image itself swallows clicks so it stays open.
export function ImageLightbox({ src, onClose }: { src: string | null; onClose: () => void }) {
  useEffect(() => {
    if (!src) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [src, onClose]);
  if (!src) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 p-6 backdrop-blur-sm" onClick={onClose} role="dialog" aria-modal="true">
      <img src={src} alt="" className="max-h-full max-w-full rounded-lg object-contain shadow-2xl" onClick={(e) => e.stopPropagation()} />
      <button type="button" onClick={onClose} className="absolute right-5 top-5 rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20" aria-label="Close">
        <X className="h-5 w-5" />
      </button>
    </div>
  );
}

// ── House primitives ─────────────────────────────────────────────────────────
// The three text/box/action atoms every step composes. Centralising them keeps the studio's eyebrow
// sizing, card shell, and accent-action affordances identical everywhere (and busy/disabled states
// impossible to get wrong per-call-site).

// A mono uppercase eyebrow/label. One canonical size & tracking; `tone` picks the colour. Pass
// `className` only for the rare deliberate outlier (a smaller meta tag, say).
export function Eyebrow({ tone = "faint", className, children }: { tone?: "faint" | "muted" | "accent"; className?: string; children: ReactNode }) {
  const color = tone === "accent" ? "text-[hsl(var(--pv-accent))]" : tone === "muted" ? "text-[hsl(var(--pv-text-muted))]" : "text-[hsl(var(--pv-text-faint))]";
  return <span className={cn("pv-mono text-[10px] uppercase tracking-[0.14em]", color, className)}>{children}</span>;
}

// The studio's card shell. Variants:
//   solid   — default bordered surface card
//   soft    — quieter border, lighter bg (secondary content)
//   dashed  — empty/placeholder slot
//   chosen  — accent border + accent-tinted bg (the selected/committed item)
// Padding defaults to px-6 py-5 — override via className (twMerge wins).
export function Panel({ variant = "solid", className, children, ...rest }: ComponentProps<"div"> & { variant?: "solid" | "soft" | "dashed" | "chosen" }) {
  const v = variant === "dashed" ? "border-dashed border-[hsl(var(--pv-border-soft))] bg-transparent"
    : variant === "soft" ? "border-[hsl(var(--pv-border-soft))] bg-[hsl(var(--pv-surface-2))]/40"
      : variant === "chosen" ? "border-[hsl(var(--pv-accent))]/45 bg-[hsl(var(--pv-surface-2))]/60"
        : "border-border bg-[hsl(var(--pv-surface-2))]/50";
  return <div className={cn("rounded-2xl border px-6 py-5", v, className)} {...rest}>{children}</div>;
}

// The "pick one" button used on option/proposal cards. When selected, it fills with primary colour
// and shows a check; when not selected, it's an outlined border button.
export function PickButton({ onClick, selected, children, className }: { onClick?: () => void; selected?: boolean; children: ReactNode; className?: string }) {
  return (
    <button type="button" onClick={onClick} disabled={selected}
      className={cn(
        "pv-serif inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[13.5px] transition-colors disabled:opacity-100",
        selected ? "bg-primary text-primary-foreground" : "border border-border text-foreground hover:border-foreground/40",
        className,
      )}>
      {selected && <Check className="h-3.5 w-3.5" />}
      {children}
    </button>
  );
}

// A proposal/option card: standard shell with a header row (label eyebrow + pick button + optional
// delete X). Used for route proposals, cast options, and any "pick one from many" pattern.
export function OptionCard({ label, onPick, pickLabel = "Choose this", onDelete, className, children }: {
  label?: string; onPick?: () => void; pickLabel?: string; onDelete?: () => void;
  className?: string; children: ReactNode;
}) {
  return (
    <Panel className={cn("bg-[hsl(var(--pv-surface-2))]/40", className)}>
      {(label || onPick || onDelete) && (
        <div className="mb-2.5 flex items-center justify-between gap-3">
          <Eyebrow>{label ?? ""}</Eyebrow>
          <div className="flex items-center gap-2">
            {onPick && <PickButton onClick={onPick}>{pickLabel}</PickButton>}
            {onDelete && (
              <button type="button" onClick={onDelete}
                className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground/50 transition-colors hover:bg-destructive/10 hover:text-destructive/70"
                aria-label="Remove">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      )}
      {children}
    </Panel>
  );
}

// A compact collapsed row for non-selected candidates (after a choice has been made). Shows a
// truncated label + text + switch link + remove X. Clicking the row previews the full text.
export function CollapsedRow({ label, text, onPick, onRemove }: { label: string; text: string; onPick: () => void; onRemove: () => void }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded-xl border border-[hsl(var(--pv-border-soft))]/80 bg-[hsl(var(--pv-surface-2))]/30 px-5 py-2.5">
      <div className="flex items-center gap-3">
        <span className="pv-mono shrink-0 text-[9.5px] uppercase tracking-[0.14em] text-[hsl(var(--pv-text-faint))]">{label}</span>
        <button type="button" onClick={() => setExpanded((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
          <p className={`pv-serif flex-1 text-[13.5px] italic leading-snug text-[hsl(var(--pv-text-faint))] ${expanded ? "" : "truncate"}`}>{text}</p>
          {expanded
            ? <ChevronUp className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--pv-text-faint))]" />
            : <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--pv-text-faint))]" />}
        </button>
        <button type="button" onClick={onPick}
          className="pv-serif shrink-0 text-[12.5px] italic text-[hsl(var(--pv-text-muted))] transition-colors hover:text-foreground">switch</button>
        <button type="button" onClick={onRemove}
          className="shrink-0 text-[hsl(var(--pv-text-faint))] transition-colors hover:text-foreground" aria-label="Remove">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

// A text "action link": the studio's house affordance for AI moves (regenerate, redraft, propose,
// revise →). A leading `icon` becomes a spinner while `busy`; `tone` picks accent / muted / faint.
export function ActionLink({ icon, busy, disabled, onClick, tone = "accent", className, children, title }: {
  icon?: ReactNode; busy?: boolean; disabled?: boolean; onClick?: () => void;
  tone?: "accent" | "muted" | "faint"; className?: string; children: ReactNode; title?: string;
}) {
  const color = tone === "muted" ? "text-[hsl(var(--pv-text-muted))] hover:text-foreground"
    : tone === "faint" ? "text-[hsl(var(--pv-text-faint))] hover:text-foreground"
      : "text-[hsl(var(--pv-accent))] hover:opacity-75";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      title={title}
      className={cn("pv-serif inline-flex items-center gap-1.5 text-[13.5px] italic transition-opacity disabled:opacity-50", color, className)}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon}
      {children}
    </button>
  );
}

// The standard failed-run line. One place to phrase and colour generation errors.
export function RunError({ msg }: { msg: string | null }) {
  return <p className="pv-serif mt-2 text-[13px] italic text-red-600 dark:text-red-400">{msg || "Generation failed."}</p>;
}

// The small "machine working" inline row: a spinning label with an optional cancel. The lightweight
// sibling of RunningCard — for the short synchronous-feeling waits each sub-step shows while a draft
// is in flight. Caller positions it (mt-_, py-_) via className.
export function RunningInline({ label, onCancel, className }: { label: string; onCancel?: () => void; className?: string }) {
  return (
    <div className={cn("flex items-center gap-4", className)}>
      <p className="pv-serif inline-flex items-center gap-2 text-[14px] italic text-[hsl(var(--pv-text-muted))]">
        <Loader2 className="h-4 w-4 animate-spin" /> {label}
      </p>
      {onCancel && (
        <button type="button" onClick={onCancel} className="pv-serif text-[13px] italic text-[hsl(var(--pv-text-faint))] hover:text-foreground">cancel</button>
      )}
    </div>
  );
}

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

// The Navigator's step glyph. done = filled accent check (amber when stale — approved, but drifted out
// of sync with an upstream change); active = accent ring + inner dot; ready = quiet ring; locked = padlock.
export function StepDot({ state, stale }: { state: DotState; stale?: boolean }) {
  if (state === "done")
    return (
      <span className={cn("flex h-5 w-5 items-center justify-center rounded-full text-background", stale ? "bg-amber-500" : "bg-[hsl(var(--pv-accent))]")}>
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

// Generic skeleton card — animate-pulse placeholder while AI proposes options. Renders a short
// title bar + three text lines.
export function SkeletonCard() {
  return (
    <div className="animate-pulse rounded-2xl border border-[hsl(var(--pv-border-soft))]/60 bg-[hsl(var(--pv-surface-2))]/30 px-6 py-5">
      <div className="mb-3 h-2 w-24 rounded-full bg-[hsl(var(--pv-border-soft))]" />
      <div className="space-y-2.5">
        <div className="h-3.5 w-full rounded-full bg-[hsl(var(--pv-border-soft))]" />
        <div className="h-3.5 rounded-full bg-[hsl(var(--pv-border-soft))]" style={{ width: "83%" }} />
        <div className="h-3.5 rounded-full bg-[hsl(var(--pv-border-soft))]" style={{ width: "67%" }} />
      </div>
    </div>
  );
}

// Skeleton for a multi-member proposal card (cast). Two character blocks with name + bio lines.
export function SkeletonProposalCard() {
  return (
    <div className="animate-pulse rounded-2xl border border-[hsl(var(--pv-border-soft))]/60 bg-[hsl(var(--pv-surface-2))]/30 px-6 py-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="h-2 w-16 rounded-full bg-[hsl(var(--pv-border-soft))]" />
        <div className="h-7 w-36 rounded-full bg-[hsl(var(--pv-border-soft))]" />
      </div>
      <div className="mb-4 space-y-1.5">
        <div className="mb-2 h-3.5 w-28 rounded-full bg-[hsl(var(--pv-border-soft))]" />
        <div className="h-3 w-full rounded-full bg-[hsl(var(--pv-border-soft))]/70" />
        <div className="h-3 rounded-full bg-[hsl(var(--pv-border-soft))]/70" style={{ width: "88%" }} />
        <div className="h-3 rounded-full bg-[hsl(var(--pv-border-soft))]/70" style={{ width: "75%" }} />
      </div>
      <div className="space-y-1.5">
        <div className="mb-2 h-3.5 w-24 rounded-full bg-[hsl(var(--pv-border-soft))]" />
        <div className="h-3 w-full rounded-full bg-[hsl(var(--pv-border-soft))]/70" />
        <div className="h-3 rounded-full bg-[hsl(var(--pv-border-soft))]/70" style={{ width: "80%" }} />
        <div className="h-3 rounded-full bg-[hsl(var(--pv-border-soft))]/70" style={{ width: "65%" }} />
      </div>
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
export function DoneStrip({ icon, title, children, onDismiss }: { icon: ReactNode; title: string; children?: ReactNode; onDismiss?: () => void }) {
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-border bg-[hsl(var(--pv-surface-2))]/60 px-6 py-5">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[hsl(var(--pv-accent))]/[0.08] text-[hsl(var(--pv-accent))]">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="pv-serif text-[18px] font-semibold text-foreground">{title}</div>
        {children && <div className="pv-serif mt-0.5 text-[14px] text-[hsl(var(--pv-text-muted))]">{children}</div>}
      </div>
      {onDismiss && (
        <button type="button" onClick={onDismiss} className="ml-2 shrink-0 text-[hsl(var(--pv-text-faint))] hover:text-foreground transition-colors" aria-label="Dismiss">
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
