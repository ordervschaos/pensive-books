import { unstable_cache } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/pensive";

export interface PublicBook {
  id: number;
  name: string;
  author: string | null;
  subtitle: string | null;
  cover_url: string | null;
  show_text_on_cover: boolean;
}

export interface PublicProfile {
  user_id: string;
  username: string;
  name: string | null;
  intro: string | null;
  profile_pic: string | null;
}

export interface PublishedPageSummary {
  id: number;
  title: string;
  page_index: number;
}

export interface PublishedBook extends PublicBook {
  published_at: string | null;
  pages: PublishedPageSummary[];
}

export interface PublishedPage extends PublishedPageSummary {
  content: unknown;
  page_type: string;
}

export interface PublishedPageDetail {
  book: PublishedBook;
  page: PublishedPage;
  currentIndex: number;
  nextPage: PublishedPageSummary | null;
  previousPage: PublishedPageSummary | null;
}

const REVALIDATE_SECONDS = 3600;

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

function extractNumericId(value: string | undefined): number {
  if (!value) return 0;
  const match = value.match(/^(\d+)/);
  return match ? Number.parseInt(match[1], 10) : 0;
}

function toPageSummary(row: {
  page_id: number | null;
  title: string | null;
  page_index: number | null;
}): PublishedPageSummary | null {
  if (!row.page_id || row.page_index === null) {
    return null;
  }

  return {
    id: row.page_id,
    title: row.title || "Untitled",
    page_index: row.page_index,
  };
}

const getLibraryBooksCached = unstable_cache(
  async (): Promise<PublicBook[]> => {
    const { data, error } = await supabase
      .from("books")
      .select("id, name, author, subtitle, cover_url, show_text_on_cover")
      .eq("is_public", true)
      .eq("is_archived", false)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Failed to fetch public library books:", error);
      return [];
    }

    return data ?? [];
  },
  ["public-library-books"],
  { revalidate: REVALIDATE_SECONDS },
);

const getFeaturedBooksCached = unstable_cache(
  async (): Promise<PublicBook[]> => {
    const { data, error } = await supabase
      .from("books")
      .select("id, name, author, subtitle, cover_url, show_text_on_cover")
      .eq("is_public", true)
      .eq("is_archived", false)
      .order("created_at", { ascending: false })
      .limit(10);

    if (error) {
      console.error("Failed to fetch featured books for landing page:", error);
      return [];
    }

    return data ?? [];
  },
  ["landing-featured-books"],
  { revalidate: REVALIDATE_SECONDS },
);

const getPublicProfileCached = unstable_cache(
  async (username: string): Promise<PublicProfile | null> => {
    const { data, error } = await supabase
      .from("public_user_profiles")
      .select("user_id, username, name, intro, profile_pic")
      .eq("username", username)
      .maybeSingle();

    if (error) {
      console.error(`Failed to fetch public profile for ${username}:`, error);
      return null;
    }

    return data ?? null;
  },
  ["public-user-profile"],
  { revalidate: REVALIDATE_SECONDS },
);

const getPublicBooksByOwnerCached = unstable_cache(
  async (userId: string): Promise<PublicBook[]> => {
    const { data, error } = await supabase
      .from("books")
      .select("id, name, author, subtitle, cover_url, show_text_on_cover")
      .eq("owner_id", userId)
      .eq("is_public", true)
      .eq("is_archived", false)
      .order("created_at", { ascending: false });

    if (error) {
      console.error(`Failed to fetch public books for owner ${userId}:`, error);
      return [];
    }

    return data ?? [];
  },
  ["public-books-by-owner"],
  { revalidate: REVALIDATE_SECONDS },
);

const getPublishedBookCached = unstable_cache(
  async (bookId: number): Promise<PublishedBook | null> => {
    const { data: bookData, error: bookError } = await supabase
      .from("books")
      .select(
        "id, name, author, subtitle, cover_url, show_text_on_cover, published_version_id",
      )
      .eq("id", bookId)
      .eq("is_public", true)
      .eq("is_archived", false)
      .maybeSingle();

    if (bookError) {
      console.error(`Failed to fetch public book ${bookId}:`, bookError);
      return null;
    }

    if (!bookData?.published_version_id) {
      return null;
    }

    const { data: versionData, error: versionError } = await supabase
      .from("book_versions")
      .select("id, name, subtitle, author, cover_url, published_at")
      .eq("id", bookData.published_version_id)
      .eq("is_published", true)
      .maybeSingle();

    if (versionError) {
      console.error(
        `Failed to fetch published version ${bookData.published_version_id} for book ${bookId}:`,
        versionError,
      );
      return null;
    }

    if (!versionData) {
      return null;
    }

    const { data: pageRows, error: pagesError } = await supabase
      .from("page_versions")
      .select("page_id, title, page_index")
      .eq("book_version_id", versionData.id)
      .order("page_index", { ascending: true });

    if (pagesError) {
      console.error(
        `Failed to fetch published pages for version ${versionData.id}:`,
        pagesError,
      );
      return null;
    }

    return {
      id: bookData.id,
      name: versionData.name || bookData.name,
      author: versionData.author ?? bookData.author,
      subtitle: versionData.subtitle ?? bookData.subtitle,
      cover_url: versionData.cover_url ?? bookData.cover_url,
      show_text_on_cover: bookData.show_text_on_cover,
      published_at: versionData.published_at,
      pages: (pageRows ?? [])
        .map(toPageSummary)
        .filter((page): page is PublishedPageSummary => page !== null),
    };
  },
  ["published-book"],
  { revalidate: REVALIDATE_SECONDS },
);

const getPublishedPageCached = unstable_cache(
  async (
    bookId: number,
    pageId: number,
  ): Promise<PublishedPageDetail | null> => {
    const book = await getPublishedBookCached(bookId);

    if (!book) {
      return null;
    }

    const { data: bookData, error: bookError } = await supabase
      .from("books")
      .select("published_version_id")
      .eq("id", bookId)
      .eq("is_public", true)
      .eq("is_archived", false)
      .maybeSingle();

    if (bookError || !bookData?.published_version_id) {
      if (bookError) {
        console.error(
          `Failed to fetch published version id for public book ${bookId}:`,
          bookError,
        );
      }
      return null;
    }

    const { data: pageRow, error: pageError } = await supabase
      .from("page_versions")
      .select("page_id, title, page_index, content, page_type")
      .eq("book_version_id", bookData.published_version_id)
      .eq("page_id", pageId)
      .maybeSingle();

    if (pageError) {
      console.error(
        `Failed to fetch published page ${pageId} for book ${bookId}:`,
        pageError,
      );
      return null;
    }

    if (!pageRow || !pageRow.page_id || pageRow.page_index === null) {
      return null;
    }

    const currentIndex = book.pages.findIndex((page) => page.id === pageRow.page_id);

    return {
      book,
      page: {
        id: pageRow.page_id,
        title: pageRow.title || "Untitled",
        page_index: pageRow.page_index,
        content: pageRow.content,
        page_type: pageRow.page_type || "text",
      },
      currentIndex,
      previousPage: currentIndex > 0 ? book.pages[currentIndex - 1] : null,
      nextPage:
        currentIndex >= 0 && currentIndex < book.pages.length - 1
          ? book.pages[currentIndex + 1]
          : null,
    };
  },
  ["published-page"],
  { revalidate: REVALIDATE_SECONDS },
);

export function decodeUsernameParam(value: string): string {
  const decoded = decodeURIComponent(value);
  return decoded.startsWith("@") ? decoded.slice(1) : decoded;
}

export async function getLibraryBooks(): Promise<PublicBook[]> {
  return getLibraryBooksCached();
}

export async function getFeaturedBooks(): Promise<PublicBook[]> {
  return getFeaturedBooksCached();
}

export async function getPublicProfile(
  usernameParam: string,
): Promise<PublicProfile | null> {
  const username = decodeUsernameParam(usernameParam);
  if (!username) {
    return null;
  }

  return getPublicProfileCached(username);
}

export async function getPublicBooksByOwner(
  userId: string,
): Promise<PublicBook[]> {
  return getPublicBooksByOwnerCached(userId);
}

export async function getPublishedBook(
  bookParam: string,
): Promise<PublishedBook | null> {
  const bookId = extractNumericId(bookParam);
  if (!bookId) {
    return null;
  }

  return getPublishedBookCached(bookId);
}

export async function getPublishedPage(
  bookParam: string,
  pageParam: string,
): Promise<PublishedPageDetail | null> {
  const bookId = extractNumericId(bookParam);
  const pageId = extractNumericId(pageParam);

  if (!bookId || !pageId) {
    return null;
  }

  return getPublishedPageCached(bookId, pageId);
}
