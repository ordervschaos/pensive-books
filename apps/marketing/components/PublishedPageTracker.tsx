"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

type Props = {
  bookId: number;
  pageIndex: number;
};

const LOCALSTORAGE_BOOKMARKS_KEY = "bookmarked_pages";

export function PublishedPageTracker({ bookId, pageIndex }: Props) {
  useEffect(() => {
    if (pageIndex < 0) {
      return;
    }

    let cancelled = false;

    async function persistBookmark() {
      const timestamp = new Date().toISOString();
      const supabase = createClient();

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (cancelled) {
          return;
        }

        if (session) {
          const { data } = await supabase
            .from("user_data")
            .select("bookmarked_pages")
            .eq("user_id", session.user.id)
            .maybeSingle();

          const bookmarks =
            (data?.bookmarked_pages as Record<string, unknown>) || {};

          await supabase
            .from("user_data")
            .update({
              bookmarked_pages: {
                ...bookmarks,
                [bookId]: {
                  pageIndex,
                  timestamp,
                },
              },
            })
            .eq("user_id", session.user.id);

          return;
        }

        const raw = window.localStorage.getItem(LOCALSTORAGE_BOOKMARKS_KEY);
        const bookmarks = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};

        window.localStorage.setItem(
          LOCALSTORAGE_BOOKMARKS_KEY,
          JSON.stringify({
            ...bookmarks,
            [bookId]: {
              pageIndex,
              timestamp,
            },
          }),
        );
      } catch (error) {
        console.error("Failed to persist public reading bookmark:", error);
      }
    }

    persistBookmark();

    return () => {
      cancelled = true;
    };
  }, [bookId, pageIndex]);

  return null;
}
