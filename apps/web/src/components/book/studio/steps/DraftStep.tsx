// DraftStep — the Draft step's Stage body: render prose from the approved beats. The prototype's
// pilot → continue → all rhythm, so the author never has to batch the whole book blind:
//   • write the first/next page → drop into that page's resolution ladder and write+read it in place
//   • write the N remaining at once → the durable generate-book run (same job as DraftProse), watched
//     live, resumable, cancel/restart on stall.
// The Stage owns the head + approve gate; this renders the body.
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Sparkles } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { invokeGenerateBook } from "@/lib/generateBook";
import { useLatestTaskRow, type TaskRow } from "@/hooks/useLatestTaskRow";
import { notify as fireNotification } from "@/lib/notify";
import { discardProse } from "@/lib/discardLadder";
import { NotifyWhenDone } from "../../NotifyWhenDone";
import { RunControls } from "../../RunControls";
import type { StudioModel } from "../studioModel";
import { ActionLink, DoneStrip, Hero, ProgressMeter, RunningCard } from "../studioUi";

interface BuildProgress { done: number; total: number; phase?: string }
interface BuildRow extends TaskRow { progress: BuildProgress | null; error: string | null }

export function DraftStep({ bookId, model, beforeGen, onChanged, onSelectPage }: { bookId: number; model: StudioModel; beforeGen: () => Promise<void>; onChanged: () => void; onSelectPage: (pageId: number) => void }) {
  const { toast } = useToast();
  const [notify, setNotify] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const notifyRef = useRef(false);
  const notifiedRef = useRef<number | null>(null);
  const watchedRef = useRef<number | null>(null);
  useEffect(() => { notifyRef.current = notify; }, [notify]);

  const { row, refetch, stale } = useLatestTaskRow<BuildRow>({
    table: "book_generations", bookId, match: { kind: "write_all" }, activeStatuses: ["pending", "running"], staleMs: 180_000,
  });
  const running = row?.status === "pending" || row?.status === "running";
  const progress = running ? row?.progress ?? null : null;
  const paused = row?.status === "ready" && row?.progress?.phase === "beats_done";

  useEffect(() => {
    if (running && row) watchedRef.current = row.id;
    if (!row || watchedRef.current !== row.id) return;
    if (row.status === "done") {
      if (notifyRef.current && notifiedRef.current !== row.id) {
        notifiedRef.current = row.id;
        fireNotification("Your book draft is written", { body: "The planned pages have been written. Open the book to review them.", url: window.location.href, tag: `draft-${bookId}` });
      }
      onChanged();
    } else if (row.status === "error" && notifiedRef.current !== row.id) {
      notifiedRef.current = row.id;
      toast({ title: "Couldn't finish the draft", description: row.error ?? "The run stopped.", variant: "destructive" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.id, row?.status]);

  const runAll = async () => {
    if (running) return;
    try {
      await beforeGen(); // persist the prose steer so generate-book's prose phase reads it
      const body = paused && row ? { generationId: row.id, resume: true } : { bookId, notify };
      const { data, error } = await invokeGenerateBook(body);
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      refetch(); onChanged();
    } catch (e) {
      toast({ title: "Couldn't start the draft", description: String((e as Error)?.message ?? e), variant: "destructive" });
    }
  };

  // Pages carrying prose — what a prose discard wipes (the beats are kept, to re-draft from).
  const discardIds = model.textPages.filter((p) => p.prose !== "gap").map((p) => p.id);

  const discardAll = async () => {
    if (running || discarding || discardIds.length === 0) return;
    if (!window.confirm(
      `Discard the prose on ${discardIds.length} page${discardIds.length === 1 ? "" : "s"}? ` +
      `The beats stay — you'll re-draft the prose from them. This can't be undone.`,
    )) return;
    setDiscarding(true);
    try {
      await discardProse(bookId, discardIds);
      toast({ title: "Prose discarded", description: "Every page is back to its beat. Write all to re-draft the prose." });
      onChanged();
    } catch (e) {
      toast({ title: "Couldn't discard the prose", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally {
      setDiscarding(false);
    }
  };

  const total = model.counts.objective + model.counts.written;
  const filled = model.counts.written;
  const remaining = model.proseRemaining;
  const allDone = remaining === 0 && model.hasWritten;
  const firstEmpty = model.textPages.find((p) => p.objective !== "gap" && p.prose === "gap");
  const lastWritten = [...model.textPages].reverse().find((p) => p.prose !== "gap");

  if (running) {
    return (
      <RunningCard
        label={progress?.phase ?? "Writing pages"} done={progress?.done} total={progress?.total} unit="page"
        controls={<RunControls table="book_generations" row={row} stale={stale} onRestart={runAll} refetch={refetch} />}
      />
    );
  }

  if (allDone) {
    return (
      <div>
        <DoneStrip icon={<Check className="h-5 w-5" />} title="Every page written">
          All {total} pages have prose. {lastWritten && <button type="button" onClick={() => onSelectPage(lastWritten.id)} className="italic text-[hsl(var(--pv-accent))] hover:opacity-75">open a page →</button>}
        </DoneStrip>
        <div className="mt-4">
          <ActionLink tone="faint" busy={discarding} onClick={() => void discardAll()}>
            discard the prose & re-draft →
          </ActionLink>
        </div>
      </div>
    );
  }

  return (
    <div>
      {filled > 0 && <ProgressMeter verb="written so far" filled={filled} total={total} noun="page" />}
      {firstEmpty && (
        <Hero
          icon={filled === 0 ? <Sparkles className="h-5 w-5" /> : <ArrowRight className="h-5 w-5" />}
          title={filled === 0 ? `Write the first page — ${firstEmpty.title || "page 1"}` : `Write the next page — ${firstEmpty.title || "next"}`}
          sub={paused ? "Beats are planned — continue into the prose. Open this page to write and read it in place." : "Open this page to write it from its beat and read it straight away — then keep going one at a time, or write the rest at once."}
          onClick={() => onSelectPage(firstEmpty.id)}
        />
      )}
      <div className="mt-4 flex flex-wrap items-center gap-5 text-[13.5px]">
        <ActionLink onClick={() => void runAll()}>
          {paused ? "continue — write all the prose" : `write the ${remaining} remaining at once`} →
        </ActionLink>
        {lastWritten && <button type="button" onClick={() => onSelectPage(lastWritten.id)} className="pv-serif italic text-[hsl(var(--pv-text-muted))] hover:text-foreground">review the last page →</button>}
        {discardIds.length > 0 && (
          <ActionLink tone="faint" busy={discarding} onClick={() => void discardAll()}>
            discard the prose & re-draft →
          </ActionLink>
        )}
      </div>
      <div className="mt-4"><NotifyWhenDone enabled={notify} onChange={setNotify} /></div>
    </div>
  );
}
