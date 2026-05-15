import Link from "next/link";
import { slugifyIdTitle } from "@/lib/pensive";
import type { PublicBook } from "@/lib/public-books";

type Props = {
  book: PublicBook;
};

export function PublicBookCard({ book }: Props) {
  const href = `/library/books/${slugifyIdTitle(book.id, book.name)}`;

  return (
    <Link href={href} className="group flex flex-col gap-3">
      <div className="relative aspect-[3/4] overflow-hidden rounded-xl border bg-card shadow-sm transition-transform group-hover:-translate-y-1">
        {book.cover_url ? (
          <div className="relative h-full w-full">
            <img
              src={book.cover_url}
              alt={book.name}
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
            {book.show_text_on_cover && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/35 p-4 text-center text-white">
                <h3 className="line-clamp-3 text-lg font-semibold md:text-xl">
                  {book.name}
                </h3>
                {book.subtitle && (
                  <p className="mt-2 line-clamp-2 text-sm text-white/90">
                    {book.subtitle}
                  </p>
                )}
                {book.author && (
                  <p className="mt-2 text-sm text-white/90">by {book.author}</p>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center bg-muted p-5 text-center">
            <h3 className="line-clamp-4 text-lg font-semibold text-muted-foreground md:text-2xl">
              {book.name}
            </h3>
          </div>
        )}
      </div>

      <div className="space-y-1">
        <h3 className="line-clamp-2 text-sm font-medium text-foreground">
          {book.name}
        </h3>
        {book.subtitle && (
          <p className="line-clamp-2 text-sm text-muted-foreground">
            {book.subtitle}
          </p>
        )}
        {book.author && (
          <p className="text-sm text-muted-foreground">by {book.author}</p>
        )}
      </div>
    </Link>
  );
}
