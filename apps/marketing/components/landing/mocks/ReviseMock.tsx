import { Check, Sparkles } from "lucide-react";
import { UIFrame } from "../UIFrame";

/**
 * Revise by conversation — the right-rail AI editor (ReviseChat.tsx). You talk
 * to it at any layer; it answers, then surfaces a reviewable proposal with a
 * before→after diff you Apply or Discard. Mirrors the ProposalReview + per-layer
 * diff in apps/web/src/components/book/studio/ReviseChat.tsx.
 *
 * Pure server component — no client JS.
 */
export function ReviseMock() {
  return (
    <UIFrame crumb="Salt & Lamplight · revise">
      <div className="flex items-center gap-1.5 pb-3">
        <Sparkles className="h-3 w-3 text-[hsl(var(--pv-accent))]" />
        <span className="pv-mono text-[9px] uppercase tracking-[0.16em] text-[hsl(var(--pv-text-muted))]">
          Spine editor
        </span>
      </div>

      {/* author turn */}
      <div className="flex justify-end">
        <p className="pv-serif max-w-[80%] rounded-2xl rounded-br-sm bg-[hsl(var(--pv-surface-2))] px-3.5 py-2 text-[13px] leading-snug text-foreground">
          The middle sags. Raise the cost of staying, and make the journal
          something she can&apos;t put down.
        </p>
      </div>

      {/* assistant turn */}
      <p className="pv-serif mt-3 text-[13px] leading-relaxed text-foreground">
        Agreed — right now staying is a mood, not a choice. I&apos;ve rewritten
        the spine so the journal binds her: each page she reads comes true.
      </p>

      {/* the proposal with a real before → after diff */}
      <div className="mt-3 rounded-xl border border-[hsl(var(--pv-accent))]/45 bg-[hsl(var(--pv-accent))]/[0.05] px-4 py-3">
        <div className="pv-mono pb-2 text-[9px] uppercase tracking-[0.14em] text-[hsl(var(--pv-accent))]">
          Proposed revision · spine
        </div>

        <p className="pv-serif text-[12.5px] leading-snug text-[hsl(var(--pv-text-faint))] line-through decoration-[hsl(var(--pv-text-faint))]/60">
          A lighthouse keeper finds an old journal and slowly decides whether to
          trust what it says about her past.
        </p>
        <p className="pv-serif mt-1.5 text-[12.5px] leading-snug text-foreground">
          A lighthouse keeper salvages a journal in her own hand whose pages keep
          coming true — and must burn it before the wreck it foretells reaches
          her shore.
        </p>

        <div className="mt-3 flex gap-2">
          <span className="pv-sans inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-[12px] font-medium text-[hsl(var(--pv-bg))]">
            <Check className="h-3.5 w-3.5" /> Apply revision
          </span>
          <span className="pv-sans inline-flex items-center rounded-md border border-border px-3 py-1.5 text-[12px] text-[hsl(var(--pv-text-muted))]">
            Discard
          </span>
        </div>
      </div>

      {/* composer */}
      <div className="mt-3 flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2">
        <span className="pv-serif flex-1 text-[12.5px] italic text-[hsl(var(--pv-text-faint))]">
          Ask or change the spine…
        </span>
      </div>
    </UIFrame>
  );
}
