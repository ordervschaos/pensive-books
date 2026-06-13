import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { AnimatedEllipsis } from "./AnimatedEllipsis";
import { AIActionRow } from "./AIActionRow";
import { NotifyWhenDone } from "./NotifyWhenDone";
import { useToast } from "@/hooks/use-toast";
import { invokeGenerateBook } from "@/lib/generateBook";
import { useLatestTaskRow, type TaskRow } from "@/hooks/useLatestTaskRow";
import { RunControls } from "./RunControls";
import { notify as fireNotification } from "@/lib/notify";

interface BuildProgress { done: number; total: number; phase?: string }
interface BuildRow extends TaskRow { progress: BuildProgress | null; error: string | null }

interface DraftProseProps {
  bookId: number;
  /** Empty, objective-bearing pages still to write. */
  remaining: number;
  onChanged?: () => void;
}

/**
 * Draft step of the guided build: render prose for every empty page. If a paused (beats-reviewed) run
 * is waiting, this RESUMES it on the same row; otherwise it kicks a fresh build. Live progress + an
 * optional "notify when done". The work is the durable self-chaining generate-book job.
 */
export function DraftProse({ bookId, remaining, onChanged }: DraftProseProps) {
  const { toast } = useToast();
  // True from click until the kick-off request settles — the row only flips `running` once the
  // server's row lands over Realtime, and that round trip must not leave the button clickable.
  const [busy, setBusy] = useState(false);
  const [notify, setNotify] = useState(false);
  const notifyRef = useRef(false);
  const notifiedRef = useRef<number | null>(null);
  const watchedRef = useRef<number | null>(null);
  useEffect(() => { notifyRef.current = notify; }, [notify]);

  const { row, refetch, stale } = useLatestTaskRow<BuildRow>({
    table: "book_generations",
    bookId,
    match: { kind: "write_all" },
    activeStatuses: ["pending", "running"],
    staleMs: 180_000,
  });

  const running = row?.status === "pending" || row?.status === "running";
  const progress = running ? row?.progress ?? null : null;
  const paused = row?.status === "ready" && row?.progress?.phase === "beats_done";

  useEffect(() => {
    if (running && row) { watchedRef.current = row.id; }
    if (!row || watchedRef.current !== row.id) return;
    if (row.status === "done") {
      if (notifyRef.current && notifiedRef.current !== row.id) {
        notifiedRef.current = row.id;
        fireNotification("Your book draft is written", { body: "The planned pages have been written. Open the book to review them.", url: window.location.href, tag: `draft-${bookId}` });
      }
      onChanged?.();
    } else if (row.status === "error" && notifiedRef.current !== row.id) {
      notifiedRef.current = row.id;
      toast({ title: "Couldn't finish the draft", description: row.error ?? "The run stopped.", variant: "destructive" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.id, row?.status]);

  const run = async () => {
    if (busy || running) return;
    setBusy(true);
    try {
      const body = paused && row ? { generationId: row.id, resume: true } : { bookId, notify };
      const { data, error } = await invokeGenerateBook(body);
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      refetch();
      onChanged?.();
    } catch (e) {
      toast({ title: "Couldn't start the draft", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const title = running
    ? <span>{progress?.phase ?? `Writing ${progress?.done ?? 0}/${progress?.total ?? 0}`}<AnimatedEllipsis /></span>
    : busy
      ? <span>Starting<AnimatedEllipsis /></span>
      : paused
        ? "Continue — write the prose"
        : remaining === 0
          ? "Every planned page has prose"
          : `Write ${remaining} page${remaining === 1 ? "" : "s"}`;

  return (
    <div>
      <AIActionRow
        icon={<Sparkles className="h-4 w-4" />}
        title={title}
        description="Render prose from each beat, in the book's voice — carrying character state and open loops forward page to page."
        onClick={run}
        loading={running || busy}
        disabled={!running && !paused && remaining === 0}
      />
      <RunControls table="book_generations" row={row} stale={stale} onRestart={run} refetch={refetch} />
      {!running && remaining > 0 && (
        <div className="px-5 pt-2">
          <NotifyWhenDone enabled={notify} onChange={setNotify} />
        </div>
      )}
    </div>
  );
}
