// useManuscript — the book + its live pages, kept as a projection of server state (refresh = no-op).
// A debounced refetch on any Realtime event over `pages`/`books` for this book, so an accepted change,
// an in-place edit in another tab, or a Studio render all land here without a reload.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { ManuscriptBook, ManuscriptPage } from "../lib/manuscriptAgent";

const PAGE_COLS = "id, page_index, page_type, title, content, updated_at";

export function useManuscript(bookId: number) {
  const [book, setBook] = useState<ManuscriptBook | null>(null);
  const [pages, setPages] = useState<ManuscriptPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Returns the fresh snapshot too, for callers that chain structural writes (accept-all).
  const refetch = useCallback(async (): Promise<{ book: ManuscriptBook | null; pages: ManuscriptPage[] }> => {
    if (!bookId) return { book: null, pages: [] };
    const [{ data: b, error: be }, { data: p, error: pe }] = await Promise.all([
      supabase.from("books").select("id, name, subtitle, author, is_public, cover_url").eq("id", bookId).eq("is_archived", false).maybeSingle(),
      supabase.from("pages").select(PAGE_COLS).eq("book_id", bookId).eq("archived", false).order("page_index", { ascending: true }),
    ]);
    if (be || pe) { setError((be ?? pe)!.message); setLoading(false); throw new Error((be ?? pe)!.message); }
    const nextBook = b ? { ...(b as ManuscriptBook), name: (b as { name: string | null }).name ?? "Untitled", is_public: !!(b as { is_public: boolean | null }).is_public } : null;
    const nextPages = ((p ?? []) as ManuscriptPage[]).map((x) => ({ ...x, page_type: (x.page_type === "section" ? "section" : "text") as "section" | "text" }));
    setBook(nextBook);
    setPages(nextPages);
    setLoading(false);
    return { book: nextBook, pages: nextPages };
  }, [bookId]);

  useEffect(() => { refetch().catch(() => {}); }, [refetch]);

  useEffect(() => {
    if (!bookId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const soon = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => { refetch().catch(() => {}); }, 300); };
    const channel = supabase
      .channel(`manuscript_${bookId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "pages", filter: `book_id=eq.${bookId}` }, soon)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "books", filter: `id=eq.${bookId}` }, soon)
      .subscribe();
    return () => { if (timer) clearTimeout(timer); supabase.removeChannel(channel); };
  }, [bookId, refetch]);

  return { book, pages, loading, error, refetch };
}
