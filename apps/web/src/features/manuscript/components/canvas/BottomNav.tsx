// BottomNav — the small fixed bar under the canvas: previous / next stop, and where you are.
import { ChevronLeft, ChevronRight } from "lucide-react";

export function BottomNav({ index, total, label, sectionLabel, onPrev, onNext, saving }: {
  index: number; total: number; label: string; sectionLabel?: string | null; onPrev: () => void; onNext: () => void; saving?: boolean;
}) {
  const btn = "inline-flex items-center gap-1 rounded-full border border-[hsl(var(--pv-border-soft))] px-3 py-1 pv-serif text-[12.5px] text-[hsl(var(--pv-text-muted))] transition-colors hover:text-foreground disabled:opacity-30";
  return (
    <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-t border-[hsl(var(--pv-border-soft))] bg-background/95 px-4 backdrop-blur-sm">
      <button type="button" onClick={onPrev} disabled={index <= 0} className={btn}><ChevronLeft className="h-3.5 w-3.5" /> prev</button>
      <div className="min-w-0 flex-1 truncate text-center pv-mono text-[10px] uppercase tracking-[0.14em] text-[hsl(var(--pv-text-faint))]">
        {sectionLabel && <span className="text-[hsl(var(--pv-text-muted))]">{sectionLabel} · </span>}{label}{total > 0 && <span> · {index + 1} / {total}</span>}
        {saving && <span className="ml-2 italic normal-case tracking-normal">saving…</span>}
      </div>
      <button type="button" onClick={onNext} disabled={index >= total - 1} className={btn}>next <ChevronRight className="h-3.5 w-3.5" /></button>
    </div>
  );
}
