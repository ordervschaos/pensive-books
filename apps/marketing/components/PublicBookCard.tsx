import Link from "next/link";
import { BookCard } from "@pensive/shared/ui/book-card";
import { slugifyIdTitle } from "@/lib/pensive";
import type { PublicBook } from "@/lib/public-books";

type Props = {
  book: PublicBook;
};

export function PublicBookCard({ book }: Props) {
  const href = `/library/books/${slugifyIdTitle(book.id, book.name)}`;
  const isMature = book.content_tags?.includes("mature");

  return (
    <Link href={href} className="group block">
      <BookCard
        book={book}
        topLeftOverlay={
          isMature ? (
            <span className="inline-flex items-center rounded-full bg-red-700/80 px-2 py-0.5 text-[10px] font-medium text-white shadow-sm">
              18+
            </span>
          ) : null
        }
      />
    </Link>
  );
}
