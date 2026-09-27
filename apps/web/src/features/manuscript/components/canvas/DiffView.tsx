// DiffView — a page body with a staged edit painted over it: red is what the page says now, green is
// what the agent proposes. Three grains of control, each a set of Decisions handed to onDecide:
//   word hunk  → the ✓/✗ pair that appears on hover inside the paragraph
//   block      → the gutter ✓/✗ on a changed paragraph (all its hunks, or the whole added/removed block)
//   page       → the bar above (every unit) — owned by PageCanvas
// Pure rendering; the write happens in PageCanvas via resolve() + resolvePartial().
import { Check, X } from "lucide-react";
import type { BlockDiff, Decision } from "../../lib/manuscriptDiff";

const DEL = "rounded-[2px] bg-red-200/80 text-red-950 line-through decoration-red-700/60 dark:bg-red-900/50 dark:text-red-50";
const INS = "rounded-[2px] bg-green-200/80 text-green-950 dark:bg-green-900/50 dark:text-green-50";

function Verdicts({ onAccept, onReject, disabled, size = "sm", className = "" }: { onAccept: () => void; onReject: () => void; disabled?: boolean; size?: "sm" | "xs"; className?: string }) {
  const dim = size === "xs" ? "h-5 w-5" : "h-6 w-6";
  const ic = size === "xs" ? "h-3 w-3" : "h-3.5 w-3.5";
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full border border-[hsl(var(--pv-border-soft))] bg-background p-0.5 shadow-sm ${className}`}>
      <button type="button" disabled={disabled} onClick={onAccept} title="Accept" className={`flex ${dim} items-center justify-center rounded-full text-green-700 hover:bg-green-500/15 disabled:opacity-40`}><Check className={ic} /></button>
      <button type="button" disabled={disabled} onClick={onReject} title="Reject" className={`flex ${dim} items-center justify-center rounded-full text-red-600 hover:bg-red-500/15 disabled:opacity-40`}><X className={ic} /></button>
    </span>
  );
}

// Rendered text keeps the projection's markup (`**`, `## `) visible — the diff is over the text the
// agent wrote, and hiding markup here would misrepresent what a hunk changes.
const Text = ({ text }: { text: string }) => <span className="whitespace-pre-wrap">{text}</span>;

export function DiffView({ diff, busy, onDecide }: { diff: BlockDiff[]; busy: boolean; onDecide: (d: Decision[]) => void }) {
  let firstMarked = false;
  const markFirst = () => { if (firstMarked) return {}; firstMarked = true; return { "data-first-change": "1" }; };
  return (
    <div className="space-y-5 pv-serif text-[17px] leading-[1.7] text-foreground">
      {diff.map((b, i) => {
        if (b.type === "equal") return <p key={i} className="whitespace-pre-wrap text-[hsl(var(--pv-text-muted))]">{b.text}</p>;
        const gutter = (
          <Verdicts size="sm" disabled={busy} className="absolute -left-14 top-0.5 opacity-0 transition-opacity group-hover:opacity-100"
            onAccept={() => onDecide([{ block: i, verdict: "accept" }])} onReject={() => onDecide([{ block: i, verdict: "reject" }])} />
        );
        if (b.type === "deleted") {
          return <div key={i} {...markFirst()} className="group relative" data-change-block>{gutter}<p className={`whitespace-pre-wrap ${DEL} px-1`}>{b.text}</p></div>;
        }
        if (b.type === "inserted") {
          return <div key={i} {...markFirst()} className="group relative" data-change-block>{gutter}<p className={`whitespace-pre-wrap ${INS} px-1`}>{b.text}</p></div>;
        }
        return (
          <div key={i} {...markFirst()} className="group relative" data-change-block>
            {gutter}
            <p>
              {b.segments.map((s, k) => {
                if (s.type === "eq") return <Text key={k} text={s.text} />;
                return (
                  <span key={k} className="group/h relative inline">
                    {s.del && <span className={DEL}><Text text={s.del} /></span>}
                    {s.del && s.ins && " "}
                    {s.ins && <span className={INS}><Text text={s.ins} /></span>}
                    <Verdicts size="xs" disabled={busy} className="absolute -top-6 left-0 z-10 opacity-0 transition-opacity group-hover/h:opacity-100"
                      onAccept={() => onDecide([{ block: i, hunk: s.id, verdict: "accept" }])} onReject={() => onDecide([{ block: i, hunk: s.id, verdict: "reject" }])} />
                  </span>
                );
              })}
            </p>
          </div>
        );
      })}
    </div>
  );
}

export { Verdicts, DEL, INS };
