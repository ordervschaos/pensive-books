import type { ReactNode } from "react";
import { BookCoverFallback } from "./book-cover-fallback";

export const BOOK_GRID_CLASS =
  "grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6";

export interface BookCardBook {
  id: number | string;
  name: string | null;
  author?: string | null;
  subtitle?: string | null;
  cover_url?: string | null;
  show_text_on_cover?: boolean | null;
}

export interface BookCardProps {
  book: BookCardBook;
  /** Optional overlay rendered top-right of the cover (e.g., pin button). */
  topRightOverlay?: ReactNode;
  /** Optional overlay rendered top-left of the cover (e.g., status badges). */
  topLeftOverlay?: ReactNode;
  /** Optional content rendered below the cover, under the title strip. */
  metadata?: ReactNode;
  /** Custom fallback element when book has no `cover_url`. Defaults to `BookCoverFallback`. */
  fallbackCover?: ReactNode;
}

/**
 * Purely presentational book card. The consumer is responsible for the
 * interactive wrapper — e.g. `<Link className="group">` or
 * `<div className="group cursor-pointer" onClick=...>` — so this component
 * works in both Vite/react-router and Next.js App Router contexts.
 *
 * Hover effects rely on the `group` class being set on that wrapper.
 */
export function BookCard({
  book,
  topRightOverlay,
  topLeftOverlay,
  metadata,
  fallbackCover,
}: BookCardProps) {
  const showsTitleOnCover = Boolean(book.cover_url && book.show_text_on_cover);
  const coverShowsTitle = book.cover_url ? showsTitleOnCover : true;

  return (
    <div className="flex flex-col">
      <div className="relative aspect-[4/5] w-full overflow-hidden rounded-xl border border-border/50 bg-card shadow-[0_1px_2px_rgba(0,0,0,0.06)] transition-all duration-300 group-hover:-translate-y-1 group-hover:border-border group-hover:shadow-[0_18px_40px_-12px_rgba(0,0,0,0.4)]">
        {topRightOverlay && (
          <div className="absolute right-2 top-2 z-10">{topRightOverlay}</div>
        )}

        {topLeftOverlay && (
          <div className="absolute left-2 top-2 z-10 flex flex-col gap-1">
            {topLeftOverlay}
          </div>
        )}

        <div className="h-full w-full">
          {book.cover_url ? (
            <div className="relative h-full w-full">
              <img
                src={book.cover_url}
                alt={book.name || "Book cover"}
                className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
              />
              {showsTitleOnCover && (
                <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/85 via-black/40 to-transparent p-3.5">
                  <h2 className="break-words font-serif text-sm font-semibold leading-tight tracking-tight text-white line-clamp-4 sm:text-base">
                    {book.name}
                  </h2>
                  {book.author && (
                    <p className="mt-1.5 hidden line-clamp-1 break-words text-[9px] font-medium uppercase tracking-[0.18em] text-white/75 sm:block sm:text-[10px]">
                      {book.author}
                    </p>
                  )}
                </div>
              )}
            </div>
          ) : (
            fallbackCover ?? (
              <BookCoverFallback
                bookId={book.id}
                title={book.name}
                author={book.author}
                variant="tile"
              />
            )
          )}
        </div>
      </div>

      {/* The 64px floor keeps captions on a shared baseline when the title +
          author render below the cover (they wrap to 1–2 lines). When the
          cover already carries the title there is nothing to reserve for, so
          the floor would just be dead space under every card. */}
      <div className={`mt-3 px-0.5 ${coverShowsTitle ? "" : "min-h-[64px]"}`}>
        {!coverShowsTitle && (
          <h3 className="line-clamp-2 break-words font-serif text-[15px] font-semibold leading-snug tracking-tight text-foreground">
            {book.name}
          </h3>
        )}
        {!coverShowsTitle && book.author && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {book.author}
          </p>
        )}
        {metadata}
      </div>
    </div>
  );
}
