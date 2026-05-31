import type { ReactNode } from "react";
import { ArrowRight, Loader2 } from "lucide-react";

interface AIActionRowProps {
  /** Small glyph shown in the leading box (e.g. <Sparkles className="h-4 w-4" />). */
  icon: ReactNode;
  title: string;
  description: string;
  onClick: () => void;
  disabled?: boolean;
  /** Swaps the trailing arrow for a spinner; the caller usually folds progress into `title`. */
  loading?: boolean;
}

/**
 * The house-style action row shared by every "Build with AI" move (scaffold, write-all,
 * revise-structure). A flat, full-width clickable row — not a nested shadcn card — so the
 * AI tools section reads in one editorial voice instead of three.
 */
export function AIActionRow({ icon, title, description, onClick, disabled, loading }: AIActionRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      className="group flex w-full items-center gap-4 rounded-xl border border-border bg-transparent px-5 py-4 text-left transition-colors hover:bg-[hsl(var(--pv-surface-2))]/50 disabled:pointer-events-none disabled:opacity-60"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--pv-surface-2))] text-[hsl(var(--pv-accent))]">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="pv-serif block text-[16px] leading-snug text-foreground">{title}</span>
        <span className="pv-serif block text-[13px] italic leading-snug text-[hsl(var(--pv-text-faint))]">
          {description}
        </span>
      </span>
      <span className="shrink-0 text-[hsl(var(--pv-text-faint))] transition-transform group-hover:translate-x-0.5">
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
      </span>
    </button>
  );
}
