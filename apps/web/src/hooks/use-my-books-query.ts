import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type FilterType = "all" | "published" | "private" | "pinned" | "archived";
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
  content_tags?: string[] | null;
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
  archived: number;
}

interface UseMyBooksInfiniteParams {
  userId: string | null;
  filter: FilterType;
  search: string;
  sort: SortType;
  pageSize: number;
}

export function escapeIlike(value: string) {
  return value.replace(/[%_,]/g, (m) => `\\${m}`);
}

async function fetchMyBooksPage({
  userId,
  filter,
  search,
  sort,
  pageParam,
  pageSize,
}: {
  userId: string;
  filter: FilterType;
  search: string;
  sort: SortType;
  pageParam: number;
  pageSize: number;
}): Promise<MyBooksPage> {
  let query = supabase
    .from("books")
    .select("*", { count: "exact" })
    .eq("owner_id", userId)
    .eq("is_archived", filter === "archived" ? true : false);

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

  // Tie-break so range() is deterministic across pages when the primary sort has ties.
  query = query.order("id", { ascending: false });

  const offset = pageParam * pageSize;
  const { data, error, count } = await query.range(
    offset,
    offset + pageSize - 1,
  );

  if (error) throw error;

  return { books: (data ?? []) as OwnedBook[], total: count ?? 0 };
}

export function useInfiniteMyBooks({
  userId,
  filter,
  search,
  sort,
  pageSize,
}: UseMyBooksInfiniteParams) {
  return useInfiniteQuery({
    queryKey: [
      "my-books-infinite",
      userId,
      filter,
      search.trim().toLowerCase(),
      sort,
      pageSize,
    ],
    enabled: Boolean(userId),
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      if (!userId) return { books: [], total: 0 } as MyBooksPage;
      return fetchMyBooksPage({
        userId,
        filter,
        search,
        sort,
        pageParam: pageParam as number,
        pageSize,
      });
    },
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((sum, p) => sum + p.books.length, 0);
      if (loaded >= lastPage.total) return undefined;
      return allPages.length;
    },
  });
}

export function useMyBooksCounts(userId: string | null) {
  return useQuery({
    queryKey: ["my-books-counts", userId],
    enabled: Boolean(userId),
    queryFn: async (): Promise<MyBooksCounts> => {
      if (!userId) return { all: 0, published: 0, private: 0, pinned: 0, archived: 0 };

      const base = () =>
        supabase
          .from("books")
          .select("id", { count: "exact", head: true })
          .eq("owner_id", userId)
          .eq("is_archived", false);

      const archivedBase = () =>
        supabase
          .from("books")
          .select("id", { count: "exact", head: true })
          .eq("owner_id", userId)
          .eq("is_archived", true);

      const [allRes, publishedRes, privateRes, pinnedRes, archivedRes] = await Promise.all([
        base(),
        base().eq("is_public", true),
        base().eq("is_public", false),
        base().eq("pinned", true),
        archivedBase(),
      ]);

      return {
        all: allRes.count ?? 0,
        published: publishedRes.count ?? 0,
        private: privateRes.count ?? 0,
        pinned: pinnedRes.count ?? 0,
        archived: archivedRes.count ?? 0,
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
