// TreeOverviewTab — the tree studio's Overview tab body. Renders in the studio's Console-on-Paper light
// skin: DnaTreePage mounts the whole studio inside a `theme-paper` wrapper, so the studioUi components
// here resolve the Paper-DS tokens directly — no palette override. The tree has no card component of its
// own (editing happens inline via EditableField), so `renderCard` here is a thin adapter: a thread row
// that jumps into the tree tab at that node instead of editing in place.
import { ArrowRight } from "lucide-react";
import { DnaOverview } from "@/features/dna/components/DnaOverview";
import { Eyebrow } from "@/components/book/shared/studioUi";
import type { BookSettings, DnaNode, ThreadContent } from "@/features/dna/lib/novelDna";
import type { JourneyStage, StageKey } from "@/features/dna/lib/dnaJourney";

function ThreadRow({ node, onOpen }: { node: DnaNode; onOpen: (id: string) => void }) {
  const c = node.content as ThreadContent;
  return (
    <button type="button" onClick={() => onOpen(node.id)}
      className="group flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-[hsl(var(--pv-surface-2))]/60">
      <Eyebrow tone="accent" className="mt-0.5 shrink-0">{c.kind ?? "thread"}</Eyebrow>
      <span className="pv-serif min-w-0 flex-1 truncate text-[13px] text-foreground">{c.name || c.promise || "untitled thread"}</span>
      <ArrowRight className="mt-0.5 h-3 w-3 shrink-0 text-[hsl(var(--pv-text-faint))] opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}

export function TreeOverviewTab({ bookId, nodes, settings, stages, nowKey, onOpen, onChanged }: {
  bookId: number; nodes: DnaNode[]; settings: BookSettings; stages: JourneyStage[]; nowKey: StageKey;
  onOpen: (key: StageKey, focusId?: string) => void; onChanged: () => void;
}) {
  return (
    <div className="min-h-full bg-background">
      <div className="mx-auto max-w-2xl space-y-5 px-6 py-6">
        <DnaOverview bookId={bookId} nodes={nodes} settings={settings} stages={stages} nowKey={nowKey}
          onOpen={onOpen} onChanged={onChanged}
          renderCard={(n) => <ThreadRow node={n} onOpen={(id) => onOpen("structure", id)} />} />
      </div>
    </div>
  );
}
