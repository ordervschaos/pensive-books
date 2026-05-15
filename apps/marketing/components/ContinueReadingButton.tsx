"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { slugifyIdTitle } from "@/lib/pensive";
import { createClient } from "@/lib/supabase/client";

type PageSummary = {
  id: number;
  title: string;
};

type Props = {
  bookId: number;
  bookSlug: string;
  pages: PageSummary[];
};

const LOCALSTORAGE_BOOKMARKS_KEY = "bookmarked_pages";

function getBookmarkIndex(
  bookmarks: Record<string, unknown>,
  bookId: number,
): number | null {
  const entry = bookmarks[String(bookId)];

  if (typeof entry === "number") {
    return entry;
  }

  if (
    entry &&
    typeof entry === "object" &&
    "pageIndex" in entry &&
    typeof entry.pageIndex === "number"
  ) {
    return entry.pageIndex;
  }

  return null;
}

export function ContinueReadingButton({ bookId, bookSlug, pages }: Props) {
  const defaultHref = useMemo(() => {
    if (!pages.length) {
      return null;
    }

    return `/library/books/${bookSlug}/pages/${slugifyIdTitle(
      pages[0].id,
      pages[0].title,
    )}`;
  }, [bookSlug, pages]);

  const [href, setHref] = useState<string | null>(defaultHref);
  const [label, setLabel] = useState(pages.length > 0 ? "Start reading" : "No pages yet");

  useEffect(() => {
    let cancelled = false;

    async function loadBookmark() {
      if (!pages.length || !defaultHref) {
        return;
      }

      let bookmarkIndex: number | null = null;
      const supabase = createClient();

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (session) {
          const { data } = await supabase
            .from("user_data")
            .select("bookmarked_pages")
            .eq("user_id", session.user.id)
            .maybeSingle();

          bookmarkIndex = getBookmarkIndex(
            (data?.bookmarked_pages as Record<string, unknown>) || {},
            bookId,
          );
        } else {
          const raw = window.localStorage.getItem(LOCALSTORAGE_BOOKMARKS_KEY);
          const bookmarks = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
          bookmarkIndex = getBookmarkIndex(bookmarks, bookId);
        }
      } catch (error) {
        console.error("Failed to load public reading bookmark:", error);
      }

      if (cancelled) {
        return;
      }

      if (
        bookmarkIndex !== null &&
        bookmarkIndex >= 0 &&
        bookmarkIndex < pages.length
      ) {
        const page = pages[bookmarkIndex];
        setHref(
          `/library/books/${bookSlug}/pages/${slugifyIdTitle(page.id, page.title)}`,
        );
        setLabel("Continue reading");
        return;
      }

      setHref(defaultHref);
      setLabel("Start reading");
    }

    loadBookmark();

    return () => {
      cancelled = true;
    };
  }, [bookId, bookSlug, defaultHref, pages]);

  if (!href) {
    return (
      <span className="inline-flex items-center justify-center rounded-md border border-input px-4 py-2 text-sm text-muted-foreground">
        {label}
      </span>
    );
  }

  return (
    <Link
      href={href}
      className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
    >
      {label}
    </Link>
  );
}
