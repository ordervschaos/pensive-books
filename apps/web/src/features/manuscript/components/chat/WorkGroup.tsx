// WorkGroup — the agent's legwork as one quiet, expandable row. While the turn is live and this is the
// newest group, it shows what the agent is doing right now (the latest step) instead of a bare spinner.
import { useState } from "react";
import { ChevronRight, Loader2 } from "lucide-react";
import type { ManuscriptStep } from "../../lib/manuscriptAgent";
import { workSummary } from "../../lib/chatGroups";
import { ChatStep } from "./ChatStep";

export function WorkGroup({ steps, live }: { steps: ManuscriptStep[]; live: boolean }) {
  const [open, setOpen] = useState(false);
  const latest = [...steps].reverse().find((s) => s.t === "read")?.label;
  return (
    <div>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className="group inline-flex max-w-full items-center gap-1.5 rounded-md py-0.5 pv-serif text-[12.5px] text-[hsl(var(--pv-text-faint))] transition-colors hover:text-[hsl(var(--pv-text-muted))]">
        <ChevronRight className={`h-3 w-3 shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
        {live ? <Loader2 className="h-3 w-3 shrink-0 animate-spin text-[hsl(var(--pv-accent))]" /> : null}
        <span className="truncate">
          {live && latest ? <span className="italic">{latest[0].toUpperCase() + latest.slice(1)}…</span> : <>Worked · {workSummary(steps)}</>}
        </span>
      </button>
      {open && (
        <div className="mt-1.5 flex flex-col gap-1.5 border-l border-[hsl(var(--pv-border))] pl-3">
          {steps.map((s, i) => <ChatStep key={i} step={s} />)}
        </div>
      )}
    </div>
  );
}
