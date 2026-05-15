import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Clock3, LibraryBig } from "lucide-react";
import { ContinueReadingButton } from "@/components/ContinueReadingButton";
import { getPublishedBook } from "@/lib/public-books";
import { slugifyIdTitle } from "@/lib/pensive";

export const dynamic = "force-dynamic";

type Props = {
  params: {
    bookSlug: string;
  };
};

function formatPublishedDate(value: string | null) {
  if (!value) {
    return null;
  }

  return new Intl.DateTimeFormat("en", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const book = await getPublishedBook(params.bookSlug);

  if (!book) {
    return {
      title: "Book Not Found | Pensive",
    };
  }

  return {
    title: `${book.name} | Pensive`,
    description: book.subtitle || `A public book by ${book.author || "Unknown author"}.`,
    openGraph: {
      title: `${book.name} | Pensive`,
      description: book.subtitle || `A public book by ${book.author || "Unknown author"}.`,
      images: book.cover_url ? [book.cover_url] : ["/og-image.png"],
    },
  };
}

export default async function PublishedBookPage({ params }: Props) {
  const book = await getPublishedBook(params.bookSlug);

  if (!book) {
    notFound();
  }

  const canonicalBookSlug = slugifyIdTitle(book.id, book.name);
  if (params.bookSlug !== canonicalBookSlug) {
    redirect(`/library/books/${canonicalBookSlug}`);
  }

  const firstPage = book.pages[0];
  const publishedDate = formatPublishedDate(book.published_at);

  return (
    <main className="container mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6">
        <Link
          href="/library"
          className="text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          ← Back to library
        </Link>
      </div>

      <section className="grid gap-8 rounded-3xl border bg-card p-6 shadow-sm md:grid-cols-[280px_minmax(0,1fr)] md:p-8">
        <div className="overflow-hidden rounded-2xl border bg-muted">
          {book.cover_url ? (
            <img
              src={book.cover_url}
              alt={book.name}
              className="aspect-[3/4] h-full w-full object-cover"
            />
          ) : (
            <div className="flex aspect-[3/4] items-center justify-center p-8 text-center">
              <h1 className="text-3xl font-semibold text-muted-foreground">
                {book.name}
              </h1>
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="space-y-3">
            <h1 className="font-serif text-4xl font-bold text-primary md:text-5xl">
              {book.name}
            </h1>
            {book.subtitle && (
              <p className="text-xl text-muted-foreground">{book.subtitle}</p>
            )}
            {book.author && (
              <p className="text-base text-muted-foreground">by {book.author}</p>
            )}
          </div>

          <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1.5">
              <LibraryBig className="h-4 w-4" />
              {book.pages.length} {book.pages.length === 1 ? "page" : "pages"}
            </span>
            {publishedDate && (
              <span className="inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1.5">
                <Clock3 className="h-4 w-4" />
                Published {publishedDate}
              </span>
            )}
          </div>

          <div className="flex flex-wrap gap-3">
            <ContinueReadingButton
              bookId={book.id}
              bookSlug={canonicalBookSlug}
              pages={book.pages.map((page) => ({
                id: page.id,
                title: page.title,
              }))}
            />
            {firstPage && (
              <Link
                href={`/library/books/${canonicalBookSlug}/pages/${slugifyIdTitle(firstPage.id, firstPage.title)}`}
                className="inline-flex items-center justify-center rounded-md border border-input px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                Read from the start
              </Link>
            )}
          </div>
        </div>
      </section>

      {book.pages.length > 0 && (
        <section className="mt-8 rounded-3xl border bg-card shadow-sm">
          <div className="border-b px-6 py-4 md:px-8">
            <h2 className="text-lg font-semibold">Table of Contents</h2>
          </div>
          <div className="divide-y">
            {book.pages.map((page, index) => (
              <Link
                key={page.id}
                href={`/library/books/${canonicalBookSlug}/pages/${slugifyIdTitle(page.id, page.title)}`}
                className="flex items-center gap-4 px-6 py-3 transition-colors hover:bg-accent md:px-8"
              >
                <span className="w-8 shrink-0 text-sm text-muted-foreground">
                  {index + 1}.
                </span>
                <span className="text-sm font-medium">{page.title || "Untitled"}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
