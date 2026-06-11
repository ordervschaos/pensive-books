// OutlineStep — the Outline step's Stage body. Before a scaffold exists, the ScaffoldGenerator (its
// review-and-create dialog is its own well-worn flow, kept as-is). Once pages exist, the prototype's
// calm reading view: movements with their pages as objectives, read from the derived model. Editing a
// single page's objective happens in that page's resolution ladder (open it from the map).
import { ScaffoldGenerator } from "../../ScaffoldGenerator";
import type { StudioModel } from "../studioModel";

export function OutlineStep({ bookId, model, onChanged, onSelectPage }: { bookId: number; model: StudioModel; onChanged: () => void; onSelectPage: (pageId: number) => void }) {
  if (!model.hasScaffold) {
    return <ScaffoldGenerator bookId={bookId} onCreated={onChanged} />;
  }
  return (
    <div className="space-y-3">
      {model.movements.map((m) => (
        <div key={m.key} className="rounded-2xl border border-border bg-[hsl(var(--pv-surface-2))]/40 px-5 py-4">
          <div className="pv-mono mb-2.5 text-[10px] uppercase tracking-[0.14em] text-[hsl(var(--pv-accent))]">{m.num ? `${m.num} · ` : ""}{m.title}</div>
          <div className="space-y-1.5">
            {m.pages.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onSelectPage(p.id)}
                className="group flex w-full items-start gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-[hsl(var(--pv-surface-2))]/70"
              >
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: p.objective !== "gap" ? "hsl(var(--pv-accent))" : "hsl(var(--pv-text-faint))" }} />
                <span className="min-w-0 flex-1">
                  <span className="pv-serif block text-[15.5px] leading-snug text-foreground">{p.title || "(untitled)"}</span>
                  {p.objectiveText && <span className="pv-serif block text-[13px] italic leading-snug text-[hsl(var(--pv-text-muted))]">{p.objectiveText}</span>}
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}
      <p className="pv-serif px-1 text-[13px] italic text-[hsl(var(--pv-text-faint))]">Open any page to read or edit its objective · re-plan the structure from the Revise step.</p>
    </div>
  );
}
