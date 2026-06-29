// BeatsStep — beats for every objective-bearing page.
//
// Chat-first redesign: the center is a near-manual editor (BeatSheet accordion).
// ALL generation lives in the right-rail ReviseChat (layer="beats") — "Plan all the beats" chip there.
// When no beats exist yet, a calm pointer + GenerateInChat CTA appear above the (empty) sheet.
// Whole-draft prose generation is the Draft step's concern, not this one.
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { discardBeatsAndProse } from "@/lib/discardLadder";
import { BeatSheet } from "../BeatSheet";
import type { StudioModel } from "../studioModel";
import { GenerateInChat } from "@/components/book/shared/studioUi";

export function BeatsStep({ bookId, model, onChanged, onSelectPage }: { bookId: number; model: StudioModel; onChanged: () => void; onSelectPage?: (pageId: number) => void }) {
  const { toast } = useToast();
  const beatPages = model.textPages.filter((p) => p.objectiveText.trim());
  const doneCount = beatPages.filter((p) => p.beat !== "gap").length;
  const total = beatPages.length;

  const [discarding, setDiscarding] = useState(false);

  // Discard beats AND prose back to objectives-only so the flow can re-plan from scratch.
  // Cascades to prose: a beat can't be discarded while prose written from it survives.
  const discardIds = beatPages.filter((p) => p.beat !== "gap" || p.prose !== "gap").map((p) => p.id);
  const discardAllBeats = async () => {
    if (discarding || discardIds.length === 0) return;
    if (!window.confirm(
      `Discard the beats and prose on ${discardIds.length} page${discardIds.length === 1 ? "" : "s"}? ` +
      `The objectives stay — you'll re-plan beats and re-draft from them. This can't be undone.`,
    )) return;
    setDiscarding(true);
    try {
      await discardBeatsAndProse(bookId, discardIds);
      toast({ title: "Beats and prose discarded", description: "Every page is back to its objective. Plan all the beats in the editor on the right." });
      onChanged();
    } catch (e) {
      toast({ title: "Couldn't discard", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally {
      setDiscarding(false);
    }
  };

  if (total === 0) {
    return <p className="pv-serif text-[14px] italic text-[hsl(var(--pv-text-faint))]">No pages with an objective yet — generate the outline first.</p>;
  }

  const hasBeats = doneCount > 0;

  return (
    <div className="space-y-6">
      {/* ── Empty / cold-start state: objectives exist but no beats yet ── */}
      {!hasBeats && (
        <div className="space-y-4">
          <p className="pv-serif text-[15px] italic leading-relaxed text-[hsl(var(--pv-text-faint))]">
            No beats planned yet.
          </p>
          <GenerateInChat bookId={bookId} layer="beats" label="Plan all the beats" />
        </div>
      )}

      {/* ── Beat sheet: always the manual editor surface ── */}
      <div className={!hasBeats ? "border-t border-[hsl(var(--pv-border-soft))]/60 pt-6" : ""}>
        <BeatSheet
          bookId={bookId} model={model} onChanged={onChanged} onSelectPage={onSelectPage}
          onDiscardAll={discardIds.length > 0 ? () => void discardAllBeats() : undefined}
          discarding={discarding}
        />
      </div>
    </div>
  );
}
