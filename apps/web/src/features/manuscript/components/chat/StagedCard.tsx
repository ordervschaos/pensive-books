// StagedCard — the agent's pending changes, resolvable from the chat itself (accept / reject / jump to
// the canvas for the word-level view). Same writes as the canvas (lib/manuscriptAgent).
import { Check, ExternalLink, Loader2, X } from "lucide-react";
import { changeLabel, type ManuscriptChange, type ManuscriptPage } from "../../lib/manuscriptAgent";
import { Eyebrow } from "@/components/book/shared/studioUi";

export function StagedCard({ changes, pages, busyId, onAccept, onReject, onJump }: {
  changes: ManuscriptChange[]; pages: ManuscriptPage[]; busyId: string | null;
  onAccept: (c: ManuscriptChange) => void; onReject: (c: ManuscriptChange) => void; onJump: (c: ManuscriptChange) => void;
}) {
  if (!changes.length) return null;
  return (
    <div className="rounded-2xl border border-[hsl(var(--pv-accent))]/35 bg-[hsl(var(--pv-surface-2))]/50 px-3.5 py-3">
      <div className="mb-2 flex items-center justify-between">
        <Eyebrow tone="accent">{changes.length} staged change{changes.length === 1 ? "" : "s"}</Eyebrow>
        <span className="pv-serif text-[11.5px] italic text-[hsl(var(--pv-text-faint))]">review on the canvas, or here</span>
      </div>
      <ul className="flex flex-col gap-1.5">
        {changes.map((c) => {
          const busy = busyId === c.id;
          return (
            <li key={c.id} className="flex items-start gap-2 rounded-xl border border-[hsl(var(--pv-border-soft))] bg-background px-2.5 py-2">
              <button type="button" onClick={() => onJump(c)} className="group min-w-0 flex-1 text-left" title="Show on the canvas">
                <span className="pv-serif block truncate text-[13px] text-foreground">
                  {changeLabel(c, pages)} <ExternalLink className="ml-0.5 inline h-3 w-3 text-[hsl(var(--pv-text-faint))] opacity-0 transition-opacity group-hover:opacity-100" />
                </span>
                {c.note && <span className="pv-serif block truncate text-[11.5px] italic text-[hsl(var(--pv-text-faint))]">{c.note}</span>}
              </button>
              <div className="flex shrink-0 items-center gap-1">
                <button type="button" disabled={!!busyId} onClick={() => onAccept(c)} title="Accept"
                  className="flex h-6 w-6 items-center justify-center rounded-full text-green-700 transition-colors hover:bg-green-500/15 disabled:opacity-40">
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                </button>
                <button type="button" disabled={!!busyId} onClick={() => onReject(c)} title="Reject"
                  className="flex h-6 w-6 items-center justify-center rounded-full text-red-600 transition-colors hover:bg-red-500/15 disabled:opacity-40">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
