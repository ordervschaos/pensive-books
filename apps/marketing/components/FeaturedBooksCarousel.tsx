"use client";

import { useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { slugifyIdTitle } from "@/lib/pensive";
import type { PublicBook } from "@/lib/public-books";

type Props = {
  books: PublicBook[];
};

// Same palette set the library uses, so featured covers match the catalog.
const COVER_PALETTES: Array<{ bg: string; text: string }> = [
  { bg: "#1f2d44", text: "#e8dcc4" },
  { bg: "#6b1f1f", text: "#f0e6d2" },
  { bg: "#2d4a3e", text: "#e8e2cc" },
  { bg: "#ebe1c8", text: "#2a2014" },
  { bg: "#1f1f1f", text: "#d6c4a3" },
  { bg: "#b8862d", text: "#2a1a08" },
  { bg: "#4a3157", text: "#e8d4c4" },
  { bg: "#a04b2c", text: "#f5e8d2" },
];

function pickCoverPalette(book: PublicBook) {
  const seed = Array.from(`${book.id}-${book.name ?? ""}`).reduce(
    (acc, ch) => acc + ch.charCodeAt(0),
    0,
  );
  return COVER_PALETTES[seed % COVER_PALETTES.length];
}

function scrollByAmount(container: HTMLDivElement | null, direction: 1 | -1) {
  if (!container) return;
  const amount = Math.max(container.clientWidth * 0.8, 280);
  container.scrollBy({ left: amount * direction, behavior: "smooth" });
}

/** Mirrors the library page's `Cover` treatment so the two surfaces match. */
function Cover({ book }: { book: PublicBook }) {
  const showsTitle = Boolean(book.cover_url && book.show_text_on_cover);
  const wrapperClass =
    "relative aspect-[4/5] w-full overflow-hidden rounded-[3px] border border-border bg-[hsl(var(--pv-surface-2))] shadow-[0_8px_18px_rgba(0,0,0,0.06)] transition-transform duration-300 group-hover:-translate-y-0.5";

  if (book.cover_url) {
    return (
      <div className={wrapperClass}>
        <img
          src={book.cover_url}
          alt={book.name ?? "Book cover"}
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
        />
        {showsTitle && (
          <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/70 via-black/20 to-transparent p-4">
            <h3 className="pv-display text-lg font-normal italic leading-tight text-white">
              {book.name}
            </h3>
          </div>
        )}
      </div>
    );
  }

  const palette = pickCoverPalette(book);
  return (
    <div className={wrapperClass} style={{ backgroundColor: palette.bg }}>
      <div className="flex h-full items-center justify-center px-4 text-center">
        <span
          className="pv-display text-[20px] italic leading-[1.15]"
          style={{ color: palette.text }}
        >
          {book.name}
        </span>
      </div>
    </div>
  );
}

export function FeaturedBooksCarousel({ books }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <div className="relative">
      <div
        ref={containerRef}
        className="flex w-full gap-7 overflow-x-auto scroll-smooth pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {books.map((book) => (
          <a
            key={book.id}
            href={`/library/books/${slugifyIdTitle(book.id, book.name)}`}
            className="group block min-w-[min(70%,200px)] sm:min-w-[calc(33.333%-19px)] md:min-w-[calc(25%-21px)] lg:min-w-[calc(20%-23px)]"
          >
            <Cover book={book} />
            <h3 className="pv-serif mt-3 text-[15px] font-medium leading-snug text-foreground">
              {book.name}
            </h3>
            {book.author && (
              <p className="pv-serif text-[13px] text-[hsl(var(--pv-text-muted))]">
                by {book.author}
              </p>
            )}
          </a>
        ))}
      </div>

      <div className="hidden sm:block">
        <button
          type="button"
          aria-label="Previous books"
          onClick={() => scrollByAmount(containerRef.current, -1)}
          className="absolute -left-3 top-[34%] inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background text-foreground shadow-sm transition-colors hover:bg-[hsl(var(--pv-surface-2))]"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label="Next books"
          onClick={() => scrollByAmount(containerRef.current, 1)}
          className="absolute -right-3 top-[34%] inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background text-foreground shadow-sm transition-colors hover:bg-[hsl(var(--pv-surface-2))]"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
