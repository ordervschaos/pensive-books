import { Sparkles } from "lucide-react";
import { AnimatedEllipsis } from "./AnimatedEllipsis";
import { AIActionRow } from "./AIActionRow";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useLatestTaskRow, type TaskRow } from "@/hooks/useLatestTaskRow";
import { RunControls } from "./RunControls";

interface BuildProgress { done: number; total: number; phase?: string; beatsTotal?: number; beatsDone?: number }
interface BuildRow extends TaskRow { progress: BuildProgress | null; error: string | null }

interface PlanBeatsProps {
  bookId: number;
  /** Pages that still need a beat. The action is disabled at 0 (so it can't fall through to prose). */
  remaining: number;
  onChanged?: () => void;
}

/**
 * Beats step of the guided build: plan a beat for every objective-bearing page, then PAUSE before any
 * prose (generate-book with pause_after_beats). The author reviews the beats and approves — only then
 * does the Draft step unlock. This is the "see the plan before you spend on prose" gate.
 */
export function PlanBeats({ bookId, remaining, onChanged }: PlanBeatsProps) {
  const { toast } = useToast();
  const { row, refetch, stale } = useLatestTaskRow<BuildRow>({
    table: "book_generations",
    bookId,
    match: { kind: "write_all" },
    activeStatuses: ["pending", "running"],
    staleMs: 180_000,
  });

  const running = row?.status === "pending" || row?.status === "running";
  const progress = running ? row?.progress ?? null : null;

  const run = async () => {
    if (running || remaining === 0) return;
    try {
      const { data, error } = await supabase.functions.invoke("generate-book", { body: { bookId, pauseAfterBeats: true } });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      refetch();
      onChanged?.();
    } catch (e) {
      toast({ title: "Couldn't plan the beats", description: String((e as Error)?.message ?? e), variant: "destructive" });
    }
  };

  return (
    <div>
      <AIActionRow
        icon={<Sparkles className="h-4 w-4" />}
        title={running ? <span>{progress?.phase ?? "Planning beats"}<AnimatedEllipsis /></span> : remaining === 0 ? "All beats planned" : `Plan ${remaining} beat${remaining === 1 ? "" : "s"}`}
        description="Plan what each page does — in causal order, with a value flip and a concrete image — before any prose is written. Best-of-3 per page."
        onClick={run}
        loading={running}
        disabled={remaining === 0}
      />
      <RunControls table="book_generations" row={row} stale={stale} onRestart={run} refetch={refetch} />
    </div>
  );
}
