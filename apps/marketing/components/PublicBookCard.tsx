import Link from "next/link";
import { BookCard } from "@pensive/shared/ui/book-card";
import { slugifyIdTitle } from "@/lib/pensive";
import type { PublicBook } from "@/lib/public-books";

type Props = {
  book: PublicBook;
};

export function PublicBookCard({ book }: Props) {
  const href = `/library/books/${slugifyIdTitle(book.id, book.name)}`;

  return (
    <Link href={href} className="group block">
      <BookCard book={book} />
    </Link>
  );
}
