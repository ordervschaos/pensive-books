// BeatDiff — renders a beats/outline RevisionPlan as a reviewable change list (add / delete /
// retarget / rewrite-beat / reorder), diffed against the current pages. Extracted from ReviseChat so
// both the per-layer chat and the omni-rail agent (docs/agent-rail.md) render proposals identically.
import { Check, Plus, Sparkles, Trash2, Wand2 } from "lucide-react";
import type { RevisionPlan } from "@/lib/beatSheet";
import type { StudioModel } from "./studioModel";

type Change = { kind: "add" | "delete" | "retarget" | "rebeat" | "move"; title: string; why?: string; detail?: string };

function diffPlan(plan: RevisionPlan, model: StudioModel): Change[] {
  const changes: Change[] = [];
  const curOrder = model.map.pages.map((p) => p.id);
  const newOrder = plan.pages.map((p) => p.ref).filter((r): r is number => r != null);
  for (const p of plan.pages) {
    if (p.op === "add") { changes.push({ kind: "add", title: p.title || "(untitled)", why: p.why, detail: p.beat || p.objective }); continue; }
    if (p.ref == null) continue;
    const cur = model.pageById(p.ref);
    if (!cur) continue;
    if (p.op === "retarget" && (p.objective ?? "").trim() !== cur.objectiveText.trim())
      changes.push({ kind: "retarget", title: p.title || cur.title || "(untitled)", why: p.why, detail: p.objective });
    if ((p.beat ?? "").trim() && (p.beat ?? "").trim() !== cur.beatText.trim())
      changes.push({ kind: "rebeat", title: p.title || cur.title || "(untitled)", why: p.why, detail: p.beat });
  }
  for (const d of plan.deletes) changes.push({ kind: "delete", title: model.pageById(d.ref)?.title || "(untitled)", why: d.why });
  const keptCur = curOrder.filter((id) => newOrder.includes(id));
  const keptNew = newOrder.filter((id) => keptCur.includes(id));
  if (keptCur.join(",") !== keptNew.join(",")) changes.push({ kind: "move", title: "Pages reordered", detail: "Reading order changes." });
  return changes;
}

const CHANGE_META: Record<Change["kind"], { icon: typeof Plus; label: string; tone: string }> = {
  add: { icon: Plus, label: "Add", tone: "text-emerald-600" },
  delete: { icon: Trash2, label: "Delete", tone: "text-red-600" },
  retarget: { icon: Wand2, label: "Retarget", tone: "text-amber-600" },
  rebeat: { icon: Sparkles, label: "Rewrite beat", tone: "text-[hsl(var(--pv-accent))]" },
  move: { icon: Check, label: "Reorder", tone: "text-[hsl(var(--pv-text-muted))]" },
};

export function BeatDiff({ plan, model }: { plan: RevisionPlan; model: StudioModel }) {
  const changes = diffPlan(plan, model);
  if (changes.length === 0) return <p className="pv-serif text-[13.5px] italic text-[hsl(var(--pv-text-faint))]">No structural changes proposed.</p>;
  return (
    <ul className="space-y-2.5">
      {changes.map((c, i) => {
        const m = CHANGE_META[c.kind];
        const Icon = m.icon;
        return (
          <li key={i} className="flex gap-2.5">
            <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${m.tone}`} />
            <div className="min-w-0">
              <span className="pv-mono text-[10px] uppercase tracking-[0.12em] text-[hsl(var(--pv-text-faint))]">{m.label}</span>
              <span className="pv-serif ml-2 text-[14px] text-foreground">{c.title}</span>
              {c.why && <p className="pv-serif text-[12.5px] italic leading-[1.5] text-[hsl(var(--pv-text-faint))]">{c.why}</p>}
              {c.detail && c.kind !== "move" && <p className="pv-serif mt-0.5 line-clamp-2 text-[12.5px] leading-[1.5] text-[hsl(var(--pv-text-muted))]">{c.detail}</p>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
