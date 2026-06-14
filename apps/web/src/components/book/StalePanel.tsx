import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { AnimatedEllipsis } from "./AnimatedEllipsis";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useLatestTaskRow, type TaskRow } from "@/hooks/useLatestTaskRow";
import { isProseStale, type PageMeta } from "@/lib/planProvenance";
import { invokeGenerateBook } from "@/lib/generateBook";

interface StalePanelProps {
  bookId: number;
  /** Refresh the host's page counts after a re-render run completes. */
  onRerendered?: () => void;
}

interface RerenderProgress { done: number; total: number; failures?: number; phase?: string }
interface RerenderRow extends TaskRow { progress: RerenderProgress | null; error: string | null }

interface StalePage { id: number; title: string | null }

/**
 * Book-level "out of sync" panel (plan↔prose dirty-graph). Lists pages whose prose was generated
 * from an objective that has since changed (e.g. after an outline-only revision), and offers to
 * re-render them from their updated objectives in one durable run.
 *
 * Re-render reuses the generate-book cascade in its pageIds "re-render" mode (it overwrites the
 * named pages and re-stamps prose_src_hash, clearing the stale flag). Renders nothing when nothing
 * is stale, so it's invisible until an outline change leaves prose behind.
 */
export function StalePanel({ bookId, onRerendered }: StalePanelProps) {
  const { toast } = useToast();
  const [stalePages, setStalePages] = useState<StalePage[] | null>(null); // null = still loading

  const { row, refetch } = useLatestTaskRow<RerenderRow>({
    table: "book_generations",
    bookId,
    match: { kind: "rerender_stale" },
    activeStatuses: ["pending", "running"],
  });
  const running = row?.status === "pending" || row?.status === "running";
  const progress = running ? row?.progress ?? null : null;

  const loadStale = useCallback(async () => {
    const { data } = await supabase
      .from("pages")
      .select("id, title, content, metadata")
      .eq("book_id", bookId)
      .eq("page_type", "text")
      .eq("archived", false)
      .order("page_index", { ascending: true });
    const stale = ((data as Array<{ id: number; title: string | null; content: unknown; metadata: PageMeta | null }>) ?? [])
      .filter((p) => isProseStale(p.metadata, !!bodyText(p.content)))
      .map((p) => ({ id: p.id, title: p.title }));
    setStalePages(stale);
  }, [bookId]);

  useEffect(() => { void loadStale(); }, [loadStale]);
  // A finished run re-syncs pages — recompute the stale list when the run leaves the running state.
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !running) { void loadStale(); onRerendered?.(); }
    wasRunning.current = running;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  const rerender = async () => {
    if (running || !stalePages?.length) return;
    const ids = stalePages.map((p) => p.id);
    if (!window.confirm(`Re-render ${ids.length} out-of-sync page${ids.length === 1 ? "" : "s"} from the updated objective${ids.length === 1 ? "" : "s"}? This overwrites their current prose (a version is kept).`)) return;
    try {
      const { data, error } = await invokeGenerateBook({ bookId, pageIds: ids });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      refetch();
    } catch (e) {
      toast({ title: "Couldn't start the re-render", description: String((e as Error)?.message ?? e), variant: "destructive" });
    }
  };

  if (stalePages === null) return null; // initial load — say nothing
  if (stalePages.length === 0 && !running) return null; // nothing out of sync

  const count = stalePages.length;
  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 px-5 py-4">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
        <div className="min-w-0 flex-1">
          <p className="pv-serif text-sm text-foreground">
            {running ? (
              <span>
                Re-rendering {progress ? `${progress.done}/${progress.total}` : ""}<AnimatedEllipsis />
              </span>
            ) : (
              <>
                <b className="font-semibold tabular-nums">{count}</b> page{count === 1 ? "" : "s"} out of sync with the plan — the objective changed after the prose was written.
              </>
            )}
          </p>
          {!running && (
            <ul className="mt-1.5 space-y-0.5">
              {stalePages.slice(0, 6).map((p) => (
                <li key={p.id} className="pv-serif text-[13px] text-[hsl(var(--pv-text-muted))]">· {p.title || "Untitled"}</li>
              ))}
              {count > 6 && (
                <li className="pv-serif text-[13px] italic text-[hsl(var(--pv-text-faint))]">…and {count - 6} more</li>
              )}
            </ul>
          )}
        </div>
      </div>
      {!running && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => void rerender()}>Re-render {count === 1 ? "the page" : "all"} from the plan</Button>
          <span className="pv-serif text-[12px] italic text-[hsl(var(--pv-text-faint))]">
            Or open a page and revise it by hand.
          </span>
        </div>
      )}
    </div>
  );
}

// Body text excluding the leading title heading — decides if a page has real prose.
function bodyText(content: unknown): string {
  if (!content || typeof content !== "object") return typeof content === "string" ? content : "";
  const doc = content as { content?: Array<Record<string, unknown>> };
  if (!Array.isArray(doc.content)) return "";
  const nodes = doc.content[0]?.type === "heading" ? doc.content.slice(1) : doc.content;
  const walk = (n: Record<string, unknown>): string =>
    n.type === "text" ? String(n.text ?? "") : ((n.content as Array<Record<string, unknown>>) ?? []).map(walk).join("");
  return nodes.map(walk).join("").trim();
}
