// SteerField — the author's "steer" input for a Build-Studio step: a guidance prompt typed BEFORE
// generating that shapes that step's output, kept (sticky) for the step. Collapsed to a quiet link
// when empty; expands to a textarea that autosaves on blur. State lives in useSteer (the caller owns
// it so it can save() right before kicking a generation). See @/lib/steer.
import { useState } from "react";
import { Compass } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import type { UseSteer } from "@/lib/steer";

export function SteerField({ steer, placeholder, label = "Steer this step", className }: {
  steer: UseSteer;
  placeholder?: string;
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  if (!steer.loaded) return null;
  const expanded = open || steer.value.trim().length > 0;

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`pv-serif inline-flex items-center gap-1.5 text-[13px] italic text-[hsl(var(--pv-text-faint))] transition-colors hover:text-[hsl(var(--pv-accent))] ${className ?? ""}`}
      >
        <Compass className="h-3.5 w-3.5" /> {label} <span className="not-italic text-[hsl(var(--pv-text-faint))]/70">— optional</span>
      </button>
    );
  }

  return (
    <div className={`rounded-2xl border border-[hsl(var(--pv-border-soft))] bg-[hsl(var(--pv-surface-2))]/40 px-4 py-3 ${className ?? ""}`}>
      <div className="mb-1.5 flex items-center gap-1.5">
        <Compass className="h-3.5 w-3.5 text-[hsl(var(--pv-accent))]" />
        <span className="pv-mono text-[10px] uppercase tracking-[0.14em] text-[hsl(var(--pv-text-muted))]">{label}</span>
        <span className="pv-serif text-[12px] italic text-[hsl(var(--pv-text-faint))]">· shapes the next generation, kept for this step</span>
      </div>
      <Textarea
        value={steer.value}
        onChange={(e) => steer.setValue(e.target.value)}
        onBlur={() => void steer.save()}
        placeholder={placeholder ?? "e.g. keep it tense and understated; avoid flashbacks"}
        rows={2}
        autoFocus={open && !steer.value}
        className="pv-serif resize-none border-none bg-transparent px-0 text-[14px] leading-relaxed focus-visible:ring-0"
      />
    </div>
  );
}
