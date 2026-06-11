// OutlineStep — the Outline step's Stage body. Before a scaffold exists, the ScaffoldGenerator.
// Once pages exist: each page is a card showing its objective with inline revise + options actions,
// so the author can rework any slot without navigating away. Clicking "open →" goes to PageReview.
import { useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { ScaffoldGenerator } from "../../ScaffoldGenerator";
import { NodeReviser } from "../../ladder-ui";
import { DurableOptions } from "../../DurableOptions";
import { saveObjective, transforms } from "@/lib/ladder";
import type { MapPage } from "@/lib/planGraph";
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
          <div className="space-y-2">
            {m.pages.map((p) => (
              <PageCard key={p.id} bookId={bookId} page={p} onSelectPage={onSelectPage} onChanged={onChanged} />
            ))}
          </div>
        </div>
      ))}
      <p className="pv-serif px-1 text-[13px] italic text-[hsl(var(--pv-text-faint))]">Revise or generate options inline · open any page for the full ladder.</p>
    </div>
  );
}

function PageCard({ bookId, page, onSelectPage, onChanged }: {
  bookId: number;
  page: MapPage;
  onSelectPage: (id: number) => void;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [objectiveText, setObjectiveText] = useState(page.objectiveText);

  useEffect(() => { setObjectiveText(page.objectiveText); }, [page.objectiveText]);

  const accept = async (proposed: string) => {
    try {
      await saveObjective(bookId, page.id, proposed);
      setObjectiveText(proposed);
      onChanged();
    } catch (e) {
      toast({ title: "Couldn't save objective", description: String((e as Error)?.message ?? e), variant: "destructive" });
      throw e;
    }
  };

  return (
    <div className="rounded-lg border border-[hsl(var(--pv-border-soft))] bg-[hsl(var(--pv-surface-2))]/30 px-3.5 py-3">
      <div className="flex items-start justify-between gap-2">
        <span className="pv-serif text-[15.5px] leading-snug text-foreground">{page.title || "(untitled)"}</span>
        <button
          type="button"
          onClick={() => onSelectPage(page.id)}
          className="pv-serif shrink-0 text-[12px] italic text-[hsl(var(--pv-text-faint))] hover:text-[hsl(var(--pv-accent))] transition-colors"
        >
          open →
        </button>
      </div>

      {objectiveText && (
        <p className="pv-serif mt-1.5 text-[13px] italic leading-snug text-[hsl(var(--pv-text-muted))]">{objectiveText}</p>
      )}

      <div className="mt-2.5 flex items-center gap-4 border-t border-[hsl(var(--pv-border-soft))]/60 pt-2.5">
        <NodeReviser
          current={objectiveText}
          busy={false}
          buttonLabel="revise"
          onRevise={(instr) => transforms.reviseNode(bookId, "objective", objectiveText, instr, page.id)}
          onAccept={accept}
        />
        <DurableOptions
          bookId={bookId}
          kind="objective_options"
          targetPageId={page.id}
          getParams={() => ({ pageId: page.id })}
          onApply={accept}
        />
      </div>
    </div>
  );
}
