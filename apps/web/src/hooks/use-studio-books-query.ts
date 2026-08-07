import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { escapeIlike, type OwnedBook } from "@/hooks/use-my-books-query";

export interface StudioBooksResult {
  books: OwnedBook[];
  total: number;
}

const PAGE_SIZE = 60;

export function useStudioBooks({ userId, search }: { userId: string | null; search: string }) {
  return useQuery({
    queryKey: ["studio-books", userId, search.trim().toLowerCase()],
    enabled: Boolean(userId),
    queryFn: async (): Promise<StudioBooksResult> => {
      if (!userId) return { books: [], total: 0 };

      // book_nodes!inner scopes the list to books that actually have a DNA tree —
      // that's what makes a book a "Studio" book, there's no flag on `books` for it.
      let query = supabase
        .from("books")
        .select("*, book_nodes!inner(id)", { count: "exact" })
        .eq("owner_id", userId)
        .eq("is_archived", false)
        .limit(1, { foreignTable: "book_nodes" });

      const trimmed = search.trim();
      if (trimmed) {
        const term = `%${escapeIlike(trimmed)}%`;
        query = query.or(`name.ilike.${term},subtitle.ilike.${term}`);
      }

      query = query
        .order("pinned", { ascending: false, nullsFirst: false })
        .order("updated_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(PAGE_SIZE);

      const { data, error, count } = await query;
      if (error) throw error;

      return { books: (data ?? []) as OwnedBook[], total: count ?? 0 };
    },
  });
}
