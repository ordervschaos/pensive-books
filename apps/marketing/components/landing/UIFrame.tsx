import type { ReactNode } from "react";
import { Palette, User } from "lucide-react";

/**
 * Mini-UI frame for landing-page mocks. Reproduces the real Pensive app chrome
 * — the compact top nav from `@pensive/shared/ui/top-nav` (wordmark + crumb on
 * the left, appearance + account on the right) — so each mock reads as a real
 * screenshot of the product rather than a generic browser window.
 *
 * Pure server-rendered HTML/CSS — no client JS — so the page stays static.
 */
export function UIFrame({
  crumb,
  children,
  bodyClassName = "p-5",
  className = "",
}: {
  /** Breadcrumb shown next to the wordmark, e.g. "Chapter 3 · Salvage". */
  crumb?: string;
  children: ReactNode;
  /** Override the body padding/layout. */
  bodyClassName?: string;
  className?: string;
}) {
  return (
    <div
      className={`overflow-hidden rounded-xl border border-border bg-[hsl(var(--pv-surface))] shadow-[0_28px_70px_-30px_rgba(0,0,0,0.45)] ${className}`}
    >
      {/* Real compact top-nav: wordmark + crumb · appearance + account */}
      <div className="flex items-center gap-4 border-b border-border bg-background px-4 py-2.5">
        <span className="pv-display text-[17px] italic leading-none text-foreground">
          Pensive
        </span>
        {crumb ? (
          <>
            <span className="h-4 w-px bg-border" />
            <span className="pv-mono truncate text-[10px] uppercase tracking-[0.15em] text-[hsl(var(--pv-text-faint))]">
              {crumb}
            </span>
          </>
        ) : null}
        <span className="ml-auto flex items-center gap-2.5 text-[hsl(var(--pv-text-faint))]">
          <Palette className="h-4 w-4" />
          <span className="flex h-6 w-6 items-center justify-center rounded-full border border-border bg-[hsl(var(--pv-surface-2))]">
            <User className="h-3.5 w-3.5" />
          </span>
        </span>
      </div>
      <div className={bodyClassName}>{children}</div>
    </div>
  );
}
