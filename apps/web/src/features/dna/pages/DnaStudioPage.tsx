// DnaStudioPage — /books/:slug/dna. Author-only surface for the Novel DNA tree (Phase 4). Live
// projection of book_nodes (refresh = no-op): subscribe to row changes and re-load.
import { useCallback, useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useBookPermissions } from "@/hooks/use-book-permissions";
import { setPageTitle } from "@/utils/pageTitle";
import { loadTree } from "@/lib/bookNodes";
import type { DnaNode } from "@/lib/novelDna";
import type { Brief } from "@/lib/brief";
import { DnaStudio, type DnaSettings } from "@/components/book/dna/DnaStudio";

const getNumericId = (param: string | undefined) => {
  const m = param?.match(/^(\d+)/);
  return m ? parseInt(m[1]) : 0;
};

const DnaStudioPage = () => {
  const { bookSlug } = useParams();
  const navigate = useNavigate();
  const bookId = getNumericId(bookSlug);
  const { canEdit, hasAccess, loading: permLoading } = useBookPermissions(bookSlug);

  const [settings, setSettings] = useState<DnaSettings>({});
  const [nodes, setNodes] = useState<DnaNode[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (permLoading) return;
    if (!hasAccess || !canEdit) navigate(`/books/${bookSlug}`, { replace: true });
  }, [permLoading, hasAccess, canEdit, bookSlug, navigate]);

  const reload = useCallback(async () => {
    if (!bookId) return;
    const [{ data: book }, tree] = await Promise.all([
      supabase.from("books").select("name, author, brief, mode").eq("id", bookId).maybeSingle(),
      loadTree(bookId),
    ]);
    const brief = (book?.brief as Brief | null) ?? null;
    setSettings({ title: book?.name, author: (book?.author as string | null) ?? undefined, word_target: brief?.scope?.word_target,
      mode: (book as { mode?: "prose" | "picture" } | null)?.mode === "picture" ? "picture" : "prose" });
    setNodes(tree);
    if (book?.name) setPageTitle(`${book.name} · DNA`);
    setLoading(false);
  }, [bookId]);

  useEffect(() => { void reload(); }, [reload]);

  // Live projection: any book_nodes/books change for this book re-reads (debounced).
  useEffect(() => {
    if (!bookId) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const soon = () => { if (t) clearTimeout(t); t = setTimeout(() => void reload(), 400); };
    const ch = supabase
      .channel(`dna_${bookId}_${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "book_nodes", filter: `book_id=eq.${bookId}` }, soon)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "books", filter: `id=eq.${bookId}` }, soon)
      .subscribe();
    return () => { if (t) clearTimeout(t); void supabase.removeChannel(ch); };
  }, [bookId, reload]);

  if (permLoading || loading || !hasAccess || !canEdit) return null;
  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col overflow-hidden bg-background">
      <div className="min-h-0 flex-1">
        <DnaStudio bookId={bookId} bookSlug={bookSlug ?? String(bookId)} settings={settings} nodes={nodes} onChanged={reload} />
      </div>
    </div>
  );
};

export default DnaStudioPage;
