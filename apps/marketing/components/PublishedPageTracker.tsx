"use client";

import { useEffect } from "react";

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

      try {
        // Use the server-side route handler so the session is read from the
        // cookie store (handles token refresh) rather than the browser client
        // which has autoRefreshToken=false and may silently fail on expired tokens.
        const response = await fetch("/api/bookmark", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bookId, pageIndex }),
        });

        if (cancelled) return;

        if (response.ok) {
          return;
        }

        if (response.status !== 401) {
          const text = await response.text().catch(() => "");
          console.error("[PublishedPageTracker] bookmark save failed:", response.status, text);
        }
        // 401 = not logged in → fall through to localStorage
      } catch (err) {
        if (cancelled) return;
        console.error("[PublishedPageTracker] network error:", err);
      }

      // Fallback for anonymous users (or when the API is unreachable).
      if (cancelled) return;
      const raw = window.localStorage.getItem(LOCALSTORAGE_BOOKMARKS_KEY);
      const bookmarks = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      window.localStorage.setItem(
        LOCALSTORAGE_BOOKMARKS_KEY,
        JSON.stringify({
          ...bookmarks,
          [bookId]: { pageIndex, timestamp },
        }),
      );
    }

    persistBookmark();

    return () => {
      cancelled = true;
    };
  }, [bookId, pageIndex]);

  return null;
}
