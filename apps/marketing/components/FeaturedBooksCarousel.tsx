"use client";

import { useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { slugifyIdTitle } from "@/lib/pensive";
import type { PublicBook } from "@/lib/public-books";

type Props = {
  books: PublicBook[];
};

function scrollByAmount(container: HTMLDivElement | null, direction: 1 | -1) {
  if (!container) return;

  const amount = Math.max(container.clientWidth * 0.8, 280);
  container.scrollBy({
    left: amount * direction,
    behavior: "smooth",
  });
}

export function FeaturedBooksCarousel({ books }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <div className="relative px-8">
      <div
        ref={containerRef}
        className="mx-auto flex w-full max-w-5xl gap-4 overflow-x-auto scroll-smooth [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {books.map((book) => (
          <a
            key={book.id}
            href={`/library/books/${slugifyIdTitle(book.id, book.name)}`}
            className="block min-w-[min(100%,280px)] flex-1 sm:min-w-[calc(50%-8px)] md:min-w-[calc(33.333%-11px)] lg:min-w-[calc(25%-12px)]"
          >
            <div className="relative aspect-[3/4] cursor-pointer overflow-hidden rounded-lg border bg-card text-card-foreground shadow-sm group">
              {book.cover_url ? (
                <div className="relative h-full w-full">
                  <img
                    src={book.cover_url}
                    alt={book.name}
                    className="h-full w-full object-cover transition-transform group-hover:scale-105"
                  />
                  {book.show_text_on_cover && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/30 p-4">
                      <h3 className="mb-1 text-base font-semibold text-white text-center sm:mb-2 sm:text-xl">
                        {book.name}
                      </h3>
                      {book.subtitle && (
                        <p className="mb-1 text-xs text-white/90 text-center sm:mb-2 sm:text-sm">
                          {book.subtitle}
                        </p>
                      )}
                      {book.author && (
                        <p className="text-xs text-white/90 text-center sm:text-sm">
                          by {book.author}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-muted p-4">
                  <h3 className="line-clamp-3 break-words text-center text-xs font-semibold text-muted-foreground md:text-2xl">
                    {book.name}
                  </h3>
                </div>
              )}
            </div>
          </a>
        ))}
      </div>

      <div className="hidden sm:block">
        <button
          type="button"
          aria-label="Previous books"
          onClick={() => scrollByAmount(containerRef.current, -1)}
          className="absolute left-4 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-input bg-background shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label="Next books"
          onClick={() => scrollByAmount(containerRef.current, 1)}
          className="absolute right-4 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-input bg-background shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
