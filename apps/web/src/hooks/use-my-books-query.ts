import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type FilterType = "all" | "published" | "private" | "pinned";
export type SortType =
  | "recently-updated"
  | "recently-created"
  | "alphabetical-az"
  | "alphabetical-za";

export interface OwnedBook {
  id: number;
  name: string;
  subtitle?: string | null;
  author?: string | null;
  cover_url?: string | null;
  show_text_on_cover?: boolean;
  is_public: boolean;
  is_archived: boolean;
  pinned?: boolean | null;
  created_at: string;
  updated_at: string;
  owner_id?: string;
}

export interface SharedBook extends OwnedBook {
  access_level: string;
}

export interface MyBooksPage {
  books: OwnedBook[];
  total: number;
}

export interface MyBooksCounts {
  all: number;
  published: number;
  private: number;
  pinned: number;
}

interface UseMyBooksPageParams {
  userId: string | null;
  filter: FilterType;
  search: string;
  sort: SortType;
  page: number;
  pageSize: number;
}

function escapeIlike(value: string) {
  return value.replace(/[%_,]/g, (m) => `\\${m}`);
}

export function useMyBooksPage({
  userId,
  filter,
  search,
  sort,
  page,
  pageSize,
}: UseMyBooksPageParams) {
  return useQuery({
    queryKey: [
      "my-books-page",
      userId,
      filter,
      search.trim().toLowerCase(),
      sort,
      page,
      pageSize,
    ],
    enabled: Boolean(userId),
    queryFn: async (): Promise<MyBooksPage> => {
      if (!userId) return { books: [], total: 0 };

      let query = supabase
        .from("books")
        .select("*", { count: "exact" })
        .eq("owner_id", userId)
        .eq("is_archived", false);

      if (filter === "published") query = query.eq("is_public", true);
      else if (filter === "private") query = query.eq("is_public", false);
      else if (filter === "pinned") query = query.eq("pinned", true);

      const trimmed = search.trim();
      if (trimmed) {
        const term = `%${escapeIlike(trimmed)}%`;
        query = query.or(
          `name.ilike.${term},subtitle.ilike.${term},author.ilike.${term}`,
        );
      }

      // Keep pinned items at the top unless the user is already filtering by pinned.
      if (filter !== "pinned") {
        query = query.order("pinned", { ascending: false, nullsFirst: false });
      }

      switch (sort) {
        case "recently-updated":
          query = query.order("updated_at", { ascending: false });
          break;
        case "recently-created":
          query = query.order("created_at", { ascending: false });
          break;
        case "alphabetical-az":
          query = query.order("name", { ascending: true });
          break;
        case "alphabetical-za":
          query = query.order("name", { ascending: false });
          break;
      }

      const offset = (page - 1) * pageSize;
      const { data, error, count } = await query.range(
        offset,
        offset + pageSize - 1,
      );

      if (error) throw error;

      return { books: (data ?? []) as OwnedBook[], total: count ?? 0 };
    },
    placeholderData: (prev) => prev,
  });
}

export function useMyBooksCounts(userId: string | null) {
  return useQuery({
    queryKey: ["my-books-counts", userId],
    enabled: Boolean(userId),
    queryFn: async (): Promise<MyBooksCounts> => {
      if (!userId) return { all: 0, published: 0, private: 0, pinned: 0 };

      const base = () =>
        supabase
          .from("books")
          .select("id", { count: "exact", head: true })
          .eq("owner_id", userId)
          .eq("is_archived", false);

      const [allRes, publishedRes, privateRes, pinnedRes] = await Promise.all([
        base(),
        base().eq("is_public", true),
        base().eq("is_public", false),
        base().eq("pinned", true),
      ]);

      return {
        all: allRes.count ?? 0,
        published: publishedRes.count ?? 0,
        private: privateRes.count ?? 0,
        pinned: pinnedRes.count ?? 0,
      };
    },
  });
}

export function useSharedBooks(userEmail: string | null) {
  return useQuery({
    queryKey: ["my-shared-books", userEmail],
    enabled: Boolean(userEmail),
    queryFn: async (): Promise<SharedBook[]> => {
      if (!userEmail) return [];

      const { data, error } = await supabase
        .from("book_access")
        .select("access_level, books!inner (*)")
        .eq("invited_email", userEmail)
        .eq("status", "accepted")
        .eq("books.is_archived", false);

      if (error) throw error;

      return (data ?? [])
        .filter((item) => item.books !== null)
        .map((item) => ({
          ...(item.books as unknown as OwnedBook),
          access_level: item.access_level,
        })) as SharedBook[];
    },
  });
}
