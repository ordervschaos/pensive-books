import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { RotateCcw, FileText, Columns2, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ArchivedPage {
  id: number;
  title: string | null;
  page_index: number;
  updated_at: string | null;
  page_type: "text" | "section";
}

interface Props {
  bookId: number;
  onRestore: () => void;
}

export function ArchivedPagesSection({ bookId, onRestore }: Props) {
  const [archivedPages, setArchivedPages] = useState<ArchivedPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState<number | null>(null);
  const { toast } = useToast();

  const fetchArchivedPages = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("pages")
        .select("id, title, page_index, updated_at, page_type")
        .eq("book_id", bookId)
        .eq("archived", true)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      setArchivedPages((data ?? []) as ArchivedPage[]);
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "Error loading archived pages",
        description: e instanceof Error ? e.message : "Unknown error",
      });
    } finally {
      setLoading(false);
    }
  }, [bookId, toast]);

  useEffect(() => {
    fetchArchivedPages();
  }, [fetchArchivedPages]);

  const handleRestore = async (page: ArchivedPage) => {
    setRestoring(page.id);
    try {
      const { data: activePages, error: fetchError } = await supabase
        .from("pages")
        .select("page_index")
        .eq("book_id", bookId)
        .eq("archived", false);
      if (fetchError) throw fetchError;

      const maxIndex =
        activePages && activePages.length > 0
          ? Math.max(...activePages.map((p) => p.page_index))
          : -1;

      const { error } = await supabase
        .from("pages")
        .update({
          archived: false,
          page_index: maxIndex + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("id", page.id);
      if (error) throw error;

      setArchivedPages((prev) => prev.filter((p) => p.id !== page.id));
      toast({
        title: "Page restored",
        description: `"${page.title || "Untitled"}" has been restored`,
      });
      onRestore();
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "Error restoring page",
        description: e instanceof Error ? e.message : "Unknown error",
      });
    } finally {
      setRestoring(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center px-5 py-8 text-[hsl(var(--pv-text-faint))]">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        <span className="pv-mono text-[11px] uppercase tracking-[0.15em]">
          Loading archived pages…
        </span>
      </div>
    );
  }

  if (archivedPages.length === 0) {
    return (
      <div className="px-5 py-8 text-center">
        <p className="pv-serif text-[14px] italic text-[hsl(var(--pv-text-muted))]">
          No archived pages
        </p>
      </div>
    );
  }

  return (
    <div>
      {archivedPages.map((page) => (
        <div
          key={page.id}
          className="flex items-center justify-between border-b border-[hsl(var(--pv-border-soft))] px-5 py-3"
        >
          <div className="flex min-w-0 items-center gap-3">
            {page.page_type === "section" ? (
              <Columns2 className="h-4 w-4 flex-shrink-0 text-[hsl(var(--pv-text-faint))]" />
            ) : (
              <FileText className="h-4 w-4 flex-shrink-0 text-[hsl(var(--pv-text-faint))]" />
            )}
            <span className="pv-serif truncate text-[14px] italic text-[hsl(var(--pv-text-muted))]">
              {page.title || "Untitled page"}
            </span>
          </div>
          <Button
            size="sm"
            variant="ghost"
            disabled={restoring === page.id}
            onClick={() => handleRestore(page)}
            className="pv-serif ml-4 h-8 flex-shrink-0 gap-1.5 rounded-full px-3 text-[13px] italic text-[hsl(var(--pv-text-muted))] hover:text-foreground"
          >
            {restoring === page.id ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RotateCcw className="h-3.5 w-3.5" />
            )}
            Restore
          </Button>
        </div>
      ))}
    </div>
  );
}
