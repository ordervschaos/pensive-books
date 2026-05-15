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

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

export const getFeaturedBooks = unstable_cache(
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
  { revalidate: 3600 },
);
