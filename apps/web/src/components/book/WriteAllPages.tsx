import { Sparkles } from "lucide-react";
import { AnimatedEllipsis } from "./AnimatedEllipsis";
import { AIActionRow } from "./AIActionRow";
import { NotifyWhenDone } from "./NotifyWhenDone";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useLatestTaskRow, type TaskRow } from "@/hooks/useLatestTaskRow";
import { notify as fireNotification } from "@/lib/notify";
import { BRIDGE, bridgeFetch } from "@/lib/bridge";
import { useEffect, useRef, useState } from "react";

interface WriteAllPagesProps {
  bookId: number;
  /** Number of pages ready to write (objective set, no prose) — folded into the row title. */
  plannedCount?: number;
}

interface WriteAllProgress {
  done: number;
  total: number;
  failures?: number;
  phase?: string;
}
interface WriteAllRow extends TaskRow {
  progress: WriteAllProgress | null;
  error: string | null;
}

/**
 * Book-level generation (cascade): fill every empty, objective-bearing text page with prose from
 * its objective. The work is now a DURABLE, self-chaining edge job (generate-book) backed by a
 * book_generations row (kind 'write_all') — it keeps writing pages even with the tab closed, and a
 * refresh resumes the live progress from the row. The client only kicks it off and watches.
 *
 * Note: the dev bridge has no 150s cap and isn't a server, so it can't self-chain. In dev (BRIDGE
 * set) the cascade still runs client-side via the /unit endpoint as before; in prod it's the edge
 * job. Either way the button reflects live progress.
 */
export function WriteAllPages({ bookId, plannedCount }: WriteAllPagesProps) {
  const { toast } = useToast();
  const [notify, setNotify] = useState(false);
  const notifyRef = useRef(false);
  const notifiedRef = useRef<number | null>(null);
  // The id of a run we've watched actually working this session. We only announce a terminal
  // outcome (done/error) for a run we saw run — never for a row that was already terminal when the
  // book opened, which would re-toast an old failure ("credits exhausted") on every visit.
  const watchedRef = useRef<number | null>(null);
  useEffect(() => { notifyRef.current = notify; }, [notify]);

  const { row, refetch } = useLatestTaskRow<WriteAllRow>({
    table: "book_generations",
    bookId,
    match: { kind: "write_all" },
    activeStatuses: ["pending", "running"],
  });

  const running = row?.status === "pending" || row?.status === "running";
  const progress = running ? row?.progress ?? null : null;

  // Browser notification when this tab observes the run finish (email half is server-side).
  useEffect(() => {
    if (!row || !notifyRef.current) return;
    if (row.status !== "done" && row.status !== "error") return;
    if (notifiedRef.current === row.id) return;
    notifiedRef.current = row.id;
    fireNotification(
      row.status === "error" ? "The AI writing didn't finish" : "Your book draft is written",
      {
        body: row.status === "error"
          ? "It ran into a problem — reopen the book to resume."
          : "The planned pages have been written. Open the book to review them.",
        url: window.location.href,
        tag: `write-all-${bookId}`,
      }
    );
  }, [row?.id, row?.status, bookId]);

  // Surface a finished run's outcome once (toast), then it falls back to the idle row. Gated on
  // having seen the run active first, so a terminal row loaded at mount doesn't re-announce.
  useEffect(() => {
    if (running && row) { watchedRef.current = row.id; return; }
    if (!row || watchedRef.current !== row.id) return;
    if (row.status === "done") {
      const failures = row.progress?.failures ?? 0;
      const total = row.progress?.total ?? 0;
      toast({
        title: "Book draft written",
        description: `${total - failures} of ${total} pages filled${failures ? ` (${failures} failed)` : ""}.`,
        variant: failures ? "destructive" : undefined,
      });
    } else if (row?.status === "error") {
      toast({ title: "Couldn't finish writing", description: row.error ?? "The run stopped.", variant: "destructive" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.id, row?.status]);

  const run = async () => {
    if (running) return;
    if (!window.confirm("Generate prose for every empty page that has an objective?")) return;
    try {
      if (BRIDGE) {
        // Dev: no self-chaining server. Run the cascade client-side via the bridge, writing the
        // same book_generations row so the UI shows progress. (Kept minimal — dev convenience.)
        await runViaBridge(bookId, notify, refetch);
      } else {
        const { data, error } = await supabase.functions.invoke("generate-book", { body: { bookId, notify } });
        if (error) throw error;
        if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      }
      refetch();
    } catch (e) {
      toast({ title: "Couldn't start writing", description: String((e as Error)?.message ?? e), variant: "destructive" });
    }
  };

  const title = progress
    ? <span>Writing {progress.done}/{progress.total}<AnimatedEllipsis /></span>
    : running
      ? <span>Working<AnimatedEllipsis /></span>
      : plannedCount && plannedCount > 0
        ? `Write ${plannedCount} planned page${plannedCount === 1 ? "" : "s"}`
        : "Write all pages from objectives";

  return (
    <div>
      <AIActionRow
        icon={<Sparkles className="h-4 w-4" />}
        title={title}
        description="Render prose from each objective — pages you've already written are left untouched."
        onClick={run}
        loading={running}
      />
      {!running && (
        <div className="px-5 pt-2">
          <NotifyWhenDone enabled={notify} onChange={setNotify} />
        </div>
      )}
    </div>
  );
}

// Dev-only client cascade via the bridge (no self-chaining server locally). Writes a write_all
// book_generations row and advances its progress so the UI behaves like prod.
async function runViaBridge(bookId: number, notify: boolean, refetch: () => void) {
  const { buildDoc } = await import("@/lib/inlineMarkdown");
  const { data: pages } = await supabase
    .from("pages")
    .select("id, title, content, metadata")
    .eq("book_id", bookId)
    .eq("page_type", "text")
    .eq("archived", false)
    .order("page_index", { ascending: true });

  const bodyOf = (content: unknown): string => {
    if (!content || typeof content !== "object") return "";
    const doc = content as { content?: Array<Record<string, unknown>> };
    if (!Array.isArray(doc.content)) return "";
    const nodes = doc.content[0]?.type === "heading" ? doc.content.slice(1) : doc.content;
    const walk = (n: Record<string, unknown>): string =>
      n.type === "text" ? String(n.text ?? "") : ((n.content as Array<Record<string, unknown>>) ?? []).map(walk).join("");
    return nodes.map(walk).join("").trim();
  };

  const targets = ((pages as Array<{ id: number; title: string | null; content: unknown; metadata: { objective?: string } | null }>) ?? [])
    .filter((p) => p.metadata?.objective && !bodyOf(p.content));
  if (targets.length === 0) throw new Error("No empty pages with an objective were found.");

  const progress = { done: 0, total: targets.length, failures: 0, phase: `Writing 0/${targets.length}` };
  const { data: gen } = await supabase
    .from("book_generations")
    .insert({ book_id: bookId, kind: "write_all", scope: "book", status: "running", input: {}, progress, notify_email: notify })
    .select("id")
    .single();
  const genId = (gen as { id: number }).id;
  refetch();

  let failures = 0;
  for (let i = 0; i < targets.length; i++) {
    const page = targets[i];
    try {
      const r = await bridgeFetch(`/unit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bookId, pageId: page.id, level: "page", objective: page.metadata!.objective }),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      const text = String(d.text ?? "").trim();
      if (text) await supabase.from("pages").update({ content: buildDoc(page.title, text) }).eq("id", page.id);
    } catch {
      failures++;
    }
    await supabase.from("book_generations").update({ progress: { done: i + 1, total: targets.length, failures, phase: `Writing ${i + 1}/${targets.length}` } }).eq("id", genId);
  }
  await supabase.from("book_generations").update({ status: "done" }).eq("id", genId);
}
