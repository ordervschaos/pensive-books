import { useEffect, useRef, useState } from "react";
import { Wand2 } from "lucide-react";
import { AnimatedEllipsis } from "./AnimatedEllipsis";
import { AIActionRow } from "./AIActionRow";
import { NotifyWhenDone } from "./NotifyWhenDone";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useLatestTaskRow, type TaskRow } from "@/hooks/useLatestTaskRow";
import { RunControls } from "./RunControls";
import { notify as fireNotification } from "@/lib/notify";
import { BRIDGE, bridgeFetch } from "@/lib/bridge";

interface AutoReviseProgress {
  phase?: "eval" | "revise" | "reeval" | "done";
  label?: string;
  total?: number;
  revised?: number;
  failures?: number;
}
interface AutoReviseRow extends TaskRow {
  progress: AutoReviseProgress | null;
  error: string | null;
}

interface AutoReviseProps {
  bookId: number;
  /** Refresh the host after pages are revised. */
  onRevised?: () => void;
}

/**
 * The closed eval→revise→re-eval loop as one action. Runs the editor's read, automatically reworks
 * every page that drew a CRITICAL or MAJOR note, then re-reads the draft — one round. Minor notes are
 * deliberately left for the human read so the reviser doesn't sand off voice chasing nits.
 *
 * Durable: a book_generations row (kind 'auto_revise'), self-chaining server-side. The client only
 * kicks it and watches progress; closing the tab doesn't stop it.
 */
export function AutoRevise({ bookId, onRevised }: AutoReviseProps) {
  const { toast } = useToast();
  // True from click until the kick-off request settles — the row only flips `running` once the
  // server's row lands over Realtime, and that round trip must not leave the button clickable.
  const [busy, setBusy] = useState(false);
  const [notify, setNotify] = useState(false);
  const notifyRef = useRef(false);
  const notifiedRef = useRef<number | null>(null);
  const watchedRef = useRef<number | null>(null);
  useEffect(() => { notifyRef.current = notify; }, [notify]);

  const { row, refetch, stale } = useLatestTaskRow<AutoReviseRow>({
    table: "book_generations",
    bookId,
    match: { kind: "auto_revise" },
    activeStatuses: ["pending", "running"],
    staleMs: 180_000,
  });

  const running = row?.status === "pending" || row?.status === "running";
  const progress = running ? row?.progress ?? null : null;

  // Browser notification + a one-time toast when a watched run finishes.
  useEffect(() => {
    if (running && row) { watchedRef.current = row.id; }
    if (!row || watchedRef.current !== row.id) return;
    if (row.status === "done") {
      const n = row.progress?.revised ?? 0;
      if (notifyRef.current && notifiedRef.current !== row.id) {
        notifiedRef.current = row.id;
        fireNotification("Auto-revise finished", { body: `Reworked ${n} page${n === 1 ? "" : "s"}. Open the book to read the result.`, url: window.location.href, tag: `auto-revise-${bookId}` });
      }
      onRevised?.();
    } else if (row.status === "error") {
      if (notifiedRef.current !== row.id) {
        notifiedRef.current = row.id;
        toast({ title: "Auto-revise didn't finish", description: row.error ?? "It stopped.", variant: "destructive" });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.id, row?.status]);

  const run = async () => {
    if (busy || running) return;
    if (!window.confirm("Run an editor's read, auto-fix every critical & major page issue, then re-read? This makes one revision pass.")) return;
    setBusy(true);
    try {
      if (BRIDGE) {
        // Dev: run the whole loop on the local bridge (free local Claude); it writes the same row.
        const r = await bridgeFetch(`/auto-revise/${bookId}`, { method: "POST" });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || d.error) throw new Error(d.error || `bridge ${r.status}`);
      } else {
        const { data, error } = await supabase.functions.invoke("auto-revise", { body: { bookId, notify } });
        if (error) throw error;
        if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      }
      refetch();
    } catch (e) {
      toast({ title: "Couldn't start auto-revise", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  // Show the last run's outcome line when idle (and it was a real run we watched).
  const lastDone = !running && row?.status === "done" && watchedRef.current === row.id ? row.progress : null;

  return (
    <div>
      <AIActionRow
        icon={<Wand2 className="h-4 w-4" />}
        title={running ? <span>{progress?.label ?? "Working"}<AnimatedEllipsis /></span> : busy ? <span>Starting<AnimatedEllipsis /></span> : "Auto-fix critical & major issues"}
        description="Evaluate the draft, rework every page with a critical or major note, then re-read — one automated pass."
        onClick={run}
        loading={running || busy}
      />
      <RunControls table="book_generations" row={row} stale={stale} onRestart={run} refetch={refetch} />
      {lastDone && (
        <p className="px-5 pt-1 pv-serif text-[13px] italic text-[hsl(var(--pv-text-faint))]">
          {lastDone.label ?? `Revised ${lastDone.revised ?? 0} page${(lastDone.revised ?? 0) === 1 ? "" : "s"}.`} Read the draft to see the result.
        </p>
      )}
      {!running && (
        <div className="px-5 pt-2">
          <NotifyWhenDone enabled={notify} onChange={setNotify} />
        </div>
      )}
    </div>
  );
}
