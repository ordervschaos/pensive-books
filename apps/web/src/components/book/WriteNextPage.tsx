import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BookOpen, Sparkles } from "lucide-react";
import { AnimatedEllipsis } from "./AnimatedEllipsis";
import { AIActionRow } from "./AIActionRow";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { BRIDGE, bridgeFetch } from "@/lib/bridge";
import { stampProse } from "@/lib/planProvenance";

interface WriteNextPageProps {
  bookId: number;
  /** How many pages already have prose (from the host's page list). Used to label the first CTA. */
  writtenCount?: number;
  /** Called after a page is written, so the host can refresh its page counts. */
  onWritten?: () => void;
}

interface Target {
  id: number;
  title: string | null;
  objective: string;
}

/**
 * Incremental, in-the-loop alternative to the book-wide cascade (WriteAllPages, admin-only): write
 * ONE page from its objective, then offer to read/verify it before writing the next. The author
 * stays in control and reviews as they go, so nothing ever "runs away" -- the small, attended commit
 * the bulk run isn't.
 *
 * Engine: a synchronous generate-unit call (returns prose; we write the page client-side, like the
 * dev cascade). No durable task row -- this is an attended action, so resume-on-refresh isn't worth
 * the machinery; a refresh mid-write just leaves the page empty to click again.
 */
export function WriteNextPage({ bookId, writtenCount = 0, onWritten }: WriteNextPageProps) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [next, setNext] = useState<Target | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null); // null = still loading
  const [working, setWorking] = useState(false);
  const [lastWritten, setLastWritten] = useState<{ id: number; title: string | null } | null>(null);
  const [lastWrittenFromDb, setLastWrittenFromDb] = useState<{ id: number; title: string | null } | null>(null);

  const loadNext = useCallback(async () => {
    const { data: pages } = await supabase
      .from("pages")
      .select("id, title, content, metadata")
      .eq("book_id", bookId)
      .eq("page_type", "text")
      .eq("archived", false)
      .order("page_index", { ascending: true });
    const allPages = (pages as Array<{ id: number; title: string | null; content: unknown; metadata: { objective?: string } | null }>) ?? [];
    const targets = allPages
      .filter((p) => p.metadata?.objective && !bodyText(p.content))
      .map((p) => ({ id: p.id, title: p.title, objective: p.metadata!.objective! }));
    setRemaining(targets.length);
    setNext(targets[0] ?? null);
    // Track the last page that already has prose (for the "Review last written page" link).
    const writtenPages = allPages.filter((p) => bodyText(p.content));
    const dbLast = writtenPages[writtenPages.length - 1] ?? null;
    setLastWrittenFromDb(dbLast ? { id: dbLast.id, title: dbLast.title } : null);
  }, [bookId]);

  useEffect(() => { void loadNext(); }, [loadNext]);

  const writeNext = async () => {
    if (!next || working) return;
    const target = next;
    setWorking(true);
    try {
      const text = await generateOnePage(bookId, target.id, target.objective);
      if (text) {
        const { buildDoc } = await import("@/lib/inlineMarkdown");
        const { error } = await supabase.from("pages").update({ content: buildDoc(target.title, text) }).eq("id", target.id);
        if (error) throw error;
        // Record which layer (beat or objective) this prose came from (plan↔prose dirty-graph).
        await stampProse(target.id, target.objective, text);
      }
      setLastWritten({ id: target.id, title: target.title });
      await loadNext();
      onWritten?.();
    } catch (e) {
      toast({ title: "Couldn't write the page", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally {
      setWorking(false);
    }
  };

  const readLast = () => {
    if (lastWritten) navigate(`/books/${bookId}/pages/${lastWritten.id}`);
  };

  if (remaining === null) return null; // initial load -- say nothing

  // Nothing left and nothing written this session (e.g. arriving at a finished book).
  if (remaining === 0 && !lastWritten) {
    return (
      <p className="pv-serif flex items-center gap-2 text-[13px] italic text-[hsl(var(--pv-text-faint))]">
        <BookOpen className="h-3.5 w-3.5" /> Every planned page has prose.
      </p>
    );
  }

  // After a write: offer to read it (verify / revise on the page) before writing the next.
  if (lastWritten) {
    return (
      <div className="rounded-xl border border-border px-5 py-4">
        <p className="pv-serif text-sm text-foreground">
          Wrote <span className="italic">"{lastWritten.title || "Untitled"}"</span>.
          {remaining === 0
            ? " Every planned page now has prose."
            : " Read it to verify or revise -- or write the next page."}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={readLast}>
            <BookOpen className="mr-2 h-4 w-4" /> Read this page
          </Button>
          {remaining > 0 && (
            <Button size="sm" onClick={() => void writeNext()} disabled={working}>
              <Sparkles className="mr-2 h-4 w-4" />
              {working ? <span>Writing<AnimatedEllipsis /></span> : "Write the next page"}
            </Button>
          )}
        </div>
      </div>
    );
  }

  // Fresh start: a single action that writes the next empty page.
  const firstTimeLabel = writtenCount === 0 ? 'Write the first page' : 'Write the next page';
  return (
    <div className="space-y-3">
      {lastWrittenFromDb && (
        <div className="rounded-xl border border-border px-5 py-4">
          <p className="pv-serif text-sm text-foreground">
            Last written: <span className="italic">"{lastWrittenFromDb.title || "Untitled"}"</span>. Read it to verify or revise before continuing.
          </p>
          <div className="mt-3">
            <Button variant="outline" size="sm" onClick={() => navigate(`/books/${bookId}/pages/${lastWrittenFromDb.id}`)}>
              <BookOpen className="mr-2 h-4 w-4" /> Read this page
            </Button>
          </div>
        </div>
      )}
      <AIActionRow
        icon={<Sparkles className="h-4 w-4" />}
        title={working ? <span>Writing<AnimatedEllipsis /></span> : firstTimeLabel}
        description={next ? `Next: "${next.title || "Untitled"}" -- review it after, then continue.` : "Render one page from its objective."}
        onClick={() => void writeNext()}
        loading={working}
      />
    </div>
  );
}

// Body text excluding the leading title heading -- decides if a page is still "empty".
function bodyText(content: unknown): string {
  if (!content || typeof content !== "object") return typeof content === "string" ? content : "";
  const doc = content as { content?: Array<Record<string, unknown>> };
  if (!Array.isArray(doc.content)) return "";
  const nodes = doc.content[0]?.type === "heading" ? doc.content.slice(1) : doc.content;
  const walk = (n: Record<string, unknown>): string =>
    n.type === "text" ? String(n.text ?? "") : ((n.content as Array<Record<string, unknown>>) ?? []).map(walk).join("");
  return nodes.map(walk).join("").trim();
}

// Generate one page's prose from its objective. Returns the text; the caller writes the page.
// Mirrors the dev cascade: bridge in dev, the generate-unit edge function in prod. Both return { text }.
async function generateOnePage(bookId: number, pageId: number, objective: string): Promise<string> {
  if (BRIDGE) {
    const r = await bridgeFetch(`/unit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bookId, pageId, level: "page", objective }),
    });
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    return String(d.text ?? "").trim();
  }
  const { data, error } = await supabase.functions.invoke("generate-unit", { body: { bookId, pageId, level: "page", objective } });
  if (error) throw error;
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
  return String((data as { text?: string })?.text ?? "").trim();
}
