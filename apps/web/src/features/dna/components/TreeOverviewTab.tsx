// TreeOverviewTab — the tree studio's Overview tab body. DnaOverview re-themed to the tree's dark palette
// (mirrors the AgentRail's var override in DnaTreePage) so it doesn't render a light island in the dark
// tree chrome. The tree has no card component of its own (editing happens inline via EditableField), so
// `renderCard` here is a thin adapter: a thread row that jumps into the tree tab at that node instead of
// editing in place.
import type { CSSProperties } from "react";
import { ArrowRight } from "lucide-react";
import { DnaOverview } from "@/features/dna/components/DnaOverview";
import { Eyebrow } from "@/components/book/shared/studioUi";
import type { BookSettings, DnaNode, ThreadContent } from "@/features/dna/lib/novelDna";
import type { JourneyStage, StageKey } from "@/features/dna/lib/dnaJourney";

// Dark-mono palette override (mirrors the AgentRail's) — exported so any tree-mounted studio component
// can opt into the tree's chrome instead of the app's default light "paper" theme the --pv-* tokens
// resolve to otherwise.
export const TREE_DARK_VARS = {
  "--background": "240 11% 5%", "--foreground": "0 0% 80%",
  "--card": "240 11% 6%", "--popover": "240 11% 6%",
  "--primary": "240 100% 77%", "--primary-foreground": "240 30% 10%",
  "--muted-foreground": "0 0% 50%", "--destructive": "0 70% 60%",
  "--border": "240 16% 18%", "--input": "240 16% 20%", "--ring": "240 100% 77%",
  "--pv-accent": "240 100% 77%", "--pv-border-soft": "240 16% 22%",
  "--pv-surface-2": "240 14% 11%", "--pv-text-faint": "0 0% 40%",
  "--pv-text-muted": "0 0% 60%", "--pv-ink-soft": "0 0% 70%",
} as CSSProperties;

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
    <div style={TREE_DARK_VARS} className="min-h-full bg-background">
      <div className="mx-auto max-w-2xl space-y-5 px-6 py-6">
        <DnaOverview bookId={bookId} nodes={nodes} settings={settings} stages={stages} nowKey={nowKey}
          onOpen={onOpen} onChanged={onChanged}
          renderCard={(n) => <ThreadRow node={n} onOpen={(id) => onOpen("structure", id)} />} />
      </div>
    </div>
  );
}
