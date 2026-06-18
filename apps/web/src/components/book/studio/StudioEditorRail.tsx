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
import { ReviseChat } from "./ReviseChat";
import { ProseEditor } from "./ProseEditor";
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
  return (
    <aside className="h-full min-h-0 overflow-y-auto border-l border-[hsl(var(--pv-border-soft))]/60 px-3 py-3">
      {pageId != null ? (
        <ProseEditor bookId={bookId} pageId={pageId} onChanged={onChanged} />
      ) : step === "draft" ? (
        <ProseEditor bookId={bookId} proseRemaining={model.proseRemaining} onChanged={onChanged} />
      ) : (step === "foundations" || step === "spine" || step === "beats" || step === "outline") ? (
        <ReviseChat
          bookId={bookId}
          layer={step}
          model={model}
          currentFoundations={foundations}
          currentSpine={spineText}
          onChanged={onChanged}
        />
      ) : null}
    </aside>
  );
}
