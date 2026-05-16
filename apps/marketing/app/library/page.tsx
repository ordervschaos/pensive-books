import type { Metadata } from "next";
import { BOOK_GRID_CLASS } from "@pensive/shared/ui/book-card";
import { getLibraryBooks } from "@/lib/public-books";
import { PublicBookCard } from "@/components/PublicBookCard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Library | Pensive",
  description: "Browse books published on Pensive.",
};

export default async function LibraryPage() {
  const books = await getLibraryBooks();

  return (
    <main className="container mx-auto max-w-7xl px-4 py-8">
      <header className="mb-10 space-y-3">
        <h1 className="font-serif text-4xl font-bold text-primary">The Library</h1>
        <p className="max-w-2xl text-muted-foreground">
        Books published and shared on Pensive
        </p>
        <p className="text-sm text-muted-foreground">
          {books.length} {books.length === 1 ? "book" : "books"}
        </p>
      </header>

      {books.length === 0 ? (
        <div className="rounded-2xl border bg-card p-10 text-center text-muted-foreground">
          No published books found.
        </div>
      ) : (
        <div className={BOOK_GRID_CLASS}>
          {books.map((book) => (
            <PublicBookCard key={book.id} book={book} />
          ))}
        </div>
      )}
    </main>
  );
}
