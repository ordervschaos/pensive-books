// StudioEditorRail — the studio's RIGHT column: the editor for the current step, docked on the side so
// the content holds the center. Pulling the agent out of the center column makes the layout read as
// "content in the middle, the editor working from the side" — and clears the center so a pending diff
// can land there for accept/reject (Phase 2).
//
// Two kinds of editor live here:
//   • the planning layers (foundations / spine / beats) → the unified `ReviseChat` (one model call; the
//     whole layer fits in context).
//   • the Draft step → `ProseEditor` — prose is too big for one shot, so it's the durable revise-agent
//     (reads pages on demand, proposes a build-revision plan).
// BuildStudio gates *whether* the rail shows (an editor step with something settled); this just routes.
import { useSearchParams } from "react-router-dom";
import { ReviseChat } from "./ReviseChat";
import { ProseEditor } from "./ProseEditor";
import { SceneTab } from "./SceneTab";
import type { Foundations } from "@/lib/foundations";
import type { StepKey, StudioModel } from "./studioModel";

export function StudioEditorRail({ bookId, step, pageId, model, foundations, spineText, onChanged }: {
  bookId: number;
  /** The selected editor step (step mode). Omitted in page mode. */
  step?: StepKey;
  /** A selected page (page mode) → the per-page prose chat. Takes precedence over `step`. */
  pageId?: number;
  model: StudioModel;
  foundations: Foundations | null;
  spineText: string;
  onChanged: () => void;
}) {
  // Page mode gets a Prose | Scene tab switcher; `?tab` is the source of truth so the center "Edit
  // scene" button can flip the rail by navigating (no prop threading through BuildStudio).
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "scene" ? "scene" : "prose";
  const setTab = (t: "prose" | "scene") =>
    setParams((p) => { const n = new URLSearchParams(p); if (t === "prose") n.delete("tab"); else n.set("tab", t); return n; }, { replace: true });

  return (
    <aside className="flex h-full min-h-0 flex-col overflow-hidden border-l border-[hsl(var(--pv-border-soft))]/60 px-3 py-3">
      {pageId != null ? (
        <>
          <div className="mb-2.5 flex shrink-0 items-center gap-1 rounded-full border border-[hsl(var(--pv-border-soft))]/70 bg-[hsl(var(--pv-surface-2))]/40 p-0.5 text-center">
            {(["prose", "scene"] as const).map((t) => (
              <button key={t} type="button" onClick={() => setTab(t)}
                className={`flex-1 rounded-full px-3 py-1.5 pv-serif text-[13px] capitalize transition-colors ${
                  tab === t ? "bg-background text-foreground shadow-sm" : "text-[hsl(var(--pv-text-muted))] hover:text-foreground"
                }`}>
                {t}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1">
            {tab === "scene"
              ? <SceneTab bookId={bookId} pageId={pageId} />
              : <ProseEditor bookId={bookId} pageId={pageId} onChanged={onChanged} />}
          </div>
        </>
      ) : step === "draft" ? (
        <div className="min-h-0 flex-1"><ProseEditor bookId={bookId} proseRemaining={model.proseRemaining} onChanged={onChanged} /></div>
      ) : (step === "foundations" || step === "spine" || step === "beats" || step === "outline") ? (
        <div className="min-h-0 flex-1">
          <ReviseChat
            bookId={bookId}
            layer={step}
            model={model}
            currentFoundations={foundations}
            currentSpine={spineText}
            onChanged={onChanged}
          />
        </div>
      ) : null}
    </aside>
  );
}
