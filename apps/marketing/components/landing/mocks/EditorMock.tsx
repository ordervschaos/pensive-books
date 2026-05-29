import { ChevronDown, Target } from "lucide-react";
import { UIFrame } from "../UIFrame";

/**
 * Write & edit — reproduces the real TipTap editor chrome: the fixed toolbar
 * with a block-type chip, an Insert chip, the author-only objective (Target),
 * and the Read/Edit segmented pill, over a centered reading column.
 * Mirrors apps/web/src/components/editor/EditorToolbar.tsx.
 */
export function EditorMock() {
  return (
    <UIFrame crumb="Salt & Lamplight · Salvage" bodyClassName="p-0">
      {/* Editor toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-4 py-2">
        <div className="flex items-center gap-1">
          <span className="pv-serif flex h-7 items-center gap-1 rounded-md px-2 text-[13px] italic text-foreground">
            Heading 1 <ChevronDown className="h-3 w-3 opacity-60" />
          </span>
          <span className="pv-serif flex h-7 items-center gap-1 rounded-md px-2 text-[13px] italic text-foreground">
            Insert <ChevronDown className="h-3 w-3 opacity-60" />
          </span>
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[hsl(var(--pv-surface-2))] text-foreground">
            <Target className="h-3.5 w-3.5" />
          </span>
        </div>
        <div
          className="inline-flex items-center rounded-full border border-border p-[3px]"
          style={{ background: "hsl(var(--pv-surface-2))" }}
        >
          <span className="pv-serif h-7 rounded-full px-3.5 text-[13px] leading-7 text-[hsl(var(--pv-text-muted))]">
            Read
          </span>
          <span className="pv-serif h-7 rounded-full bg-foreground px-3.5 text-[13px] italic leading-7 text-background">
            Edit
          </span>
        </div>
      </div>

      {/* Reading column */}
      <div className="mx-auto max-w-[34rem] px-4 py-6 sm:px-6">
        <h3 className="pv-display text-[26px] italic leading-tight text-foreground">
          Salvage
        </h3>
        <p className="pv-serif mt-3.5 text-[15px] leading-relaxed text-foreground">
          The tide had taken everything but the timber, and the timber had taken
          on the colour of the sky — that flat, drowned grey Mara had stopped
          naming years ago.
        </p>
        <p className="pv-serif mt-3 text-[15px] leading-relaxed text-foreground">
          She found the journal wedged beneath the third strake, its pages
          swollen but legible, and the first line was her own name.
          <span className="ml-0.5 inline-block h-[1.1em] w-[2px] translate-y-[2px] animate-pulse bg-[hsl(var(--pv-accent))]" />
        </p>
      </div>
    </UIFrame>
  );
}
