import { PenLine, Sparkles, ArrowRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

export type WriteMode = "manual" | "studio";

interface WriteModeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChoose: (mode: WriteMode) => void;
}

/**
 * Shown right after a book + brief are created — the fork in the road: write it yourself, or build it
 * with the AI Studio. Dismissing (Esc / overlay) is treated as "manual" by the caller, so the author
 * always lands somewhere.
 */
export function WriteModeDialog({ open, onOpenChange, onChoose }: WriteModeDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[620px]">
        <DialogHeader>
          <DialogTitle className="pv-display text-[26px] font-normal italic tracking-tight">
            How do you want to write this?
          </DialogTitle>
          <DialogDescription>
            Your brief is saved. Pick a way in — you can switch at any time from the book page.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ModeCard
            icon={<PenLine className="h-5 w-5" />}
            title="Write it yourself"
            body="A blank page and your words. Open the manuscript and start typing — no AI in the way."
            cta="Start writing"
            onClick={() => onChoose("manual")}
          />
          <ModeCard
            icon={<Sparkles className="h-5 w-5" />}
            title="Build with the Studio"
            body="A guided AI workbench. It turns your brief into a spine, outline, beats, and draft — one step you approve at a time. You stay the editor."
            cta="Open the Studio"
            highlight
            onClick={() => onChoose("studio")}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ModeCard({
  icon,
  title,
  body,
  cta,
  onClick,
  highlight = false,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  cta: string;
  onClick: () => void;
  highlight?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex h-full flex-col items-start rounded-2xl border p-5 text-left transition-colors ${
        highlight
          ? "border-foreground/30 bg-[hsl(var(--pv-surface-2))]/60 hover:border-foreground"
          : "border-border bg-transparent hover:border-foreground/40"
      }`}
    >
      <span className="text-foreground">{icon}</span>
      <h3 className="pv-serif mt-3 text-[18px] text-foreground">{title}</h3>
      <p className="pv-serif mt-1.5 flex-1 text-[14px] leading-snug text-[hsl(var(--pv-text-muted))]">
        {body}
      </p>
      <span className="pv-serif mt-4 inline-flex items-center gap-1.5 text-[13px] text-foreground">
        {cta}
        <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
      </span>
    </button>
  );
}
