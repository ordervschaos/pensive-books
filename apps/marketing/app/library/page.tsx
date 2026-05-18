import type { Metadata } from "next";
import Link from "next/link";
import { getLibraryBooks, type PublicBook } from "@/lib/public-books";
import { slugifyIdTitle } from "@/lib/pensive";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Library | Pensive",
  description: "Browse books published on Pensive.",
};

function formatToday() {
  return new Intl.DateTimeFormat("en", {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date());
}

function bookHref(book: PublicBook) {
  return `/library/books/${slugifyIdTitle(book.id, book.name)}`;
}

export default async function LibraryPage() {
  const books = await getLibraryBooks();
  const featured = books.slice(0, 3);
  const rest = books.slice(3);

  return (
    <main className="mx-auto max-w-[1240px] px-6 pb-24 pt-14 md:px-12">
      {/* Masthead */}
      <header className="flex flex-col items-start justify-between gap-8 md:flex-row md:items-end">
        <div>
          <div className="pv-eyebrow">
            The Library · {formatToday()}
          </div>
          <h1 className="pv-display mt-4 max-w-[760px] text-[44px] font-normal leading-[1.05] tracking-tight text-foreground md:text-[56px]">
            A library of <em>self-published</em>
            <br className="hidden md:block" /> books, kept quiet on purpose.
          </h1>
        </div>
        <div className="flex flex-col items-start gap-4 md:items-end">
          <p className="pv-serif max-w-[320px] text-[14px] italic text-[hsl(var(--pv-text-muted))] md:text-right">
            {books.length}{" "}
            {books.length === 1 ? "book" : "books"} ·{" "}
            <span className="text-foreground">all written on Pensive</span>
          </p>
          <a
            className="pv-serif border-b border-foreground pb-px text-[15px] text-foreground"
            href="https://app.pensive.me/books/new"
          >
            Submit a book →
          </a>
        </div>
      </header>

      <hr className="mt-11 border-t border-border" />

      {books.length === 0 ? (
        <div className="mt-12 rounded-2xl border border-border bg-[hsl(var(--pv-surface-2))] p-10 text-center text-[hsl(var(--pv-text-muted))]">
          No published books found.
        </div>
      ) : (
        <>
          {featured.length > 0 && (
            <section className="mt-9">
              <SectionHead title="This week, on Pensive" more={`${featured.length} featured`} />
              <div className="grid grid-cols-1 gap-10 md:grid-cols-3">
                {featured.map((book) => (
                  <FeaturedCard key={book.id} book={book} />
                ))}
              </div>
            </section>
          )}

          {rest.length > 0 && (
            <>
              <hr className="mt-14 border-t border-border" />
              <section className="mt-9">
                <SectionHead title="The catalog" more={`${books.length} books`} />
                <div className="grid grid-cols-2 gap-x-9 gap-y-12 sm:grid-cols-3 md:grid-cols-4">
                  {rest.map((book) => (
                    <CatalogCard key={book.id} book={book} />
                  ))}
                </div>
              </section>
            </>
          )}
        </>
      )}
    </main>
  );
}

function SectionHead({ title, more }: { title: string; more: string }) {
  return (
    <div className="mb-7 flex items-baseline justify-between">
      <div className="pv-display text-[28px] italic tracking-tight text-foreground md:text-[30px]">
        {title}
      </div>
      <span className="pv-eyebrow">{more}</span>
    </div>
  );
}

function FeaturedCard({ book }: { book: PublicBook }) {
  return (
    <Link href={bookHref(book)} className="group block">
      <Cover book={book} />
      <p className="pv-eyebrow mt-[18px]">A book on Pensive</p>
      <h3 className="pv-display mt-2 text-[26px] font-normal leading-[1.1] tracking-tight text-foreground md:text-[28px]">
        {book.name}
      </h3>
      {book.subtitle && (
        <p className="pv-serif mt-1.5 text-[16px] italic leading-snug text-[hsl(var(--pv-text-muted))]">
          {book.subtitle}
        </p>
      )}
      {book.author && (
        <p className="pv-serif mt-3.5 text-[14px] text-[hsl(var(--pv-text-muted))]">
          by <span className="text-foreground">{book.author}</span>
        </p>
      )}
    </Link>
  );
}

function CatalogCard({ book }: { book: PublicBook }) {
  return (
    <Link href={bookHref(book)} className="group block">
      <Cover book={book} compact />
      <p className="pv-eyebrow mt-3.5">A book on Pensive</p>
      <h4 className="pv-serif mt-2 text-[17px] font-medium leading-snug text-foreground">
        {book.name}
      </h4>
      {book.author && (
        <p className="pv-serif text-[14px] text-[hsl(var(--pv-text-muted))]">
          by {book.author}
        </p>
      )}
    </Link>
  );
}

function Cover({ book, compact = false }: { book: PublicBook; compact?: boolean }) {
  const showsTitle = Boolean(book.cover_url && book.show_text_on_cover);
  const wrapperClass = `relative aspect-[4/5] w-full overflow-hidden rounded-[3px] border border-border bg-[hsl(var(--pv-surface-2))] transition-transform duration-300 group-hover:-translate-y-0.5 ${
    compact ? "shadow-[0_8px_18px_rgba(0,0,0,0.06)]" : "shadow-[0_14px_28px_rgba(0,0,0,0.08)]"
  }`;

  if (book.cover_url) {
    return (
      <div className={wrapperClass}>
        <img
          src={book.cover_url}
          alt={book.name}
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
        />
        {showsTitle && (
          <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/70 via-black/20 to-transparent p-4">
            <h2 className="pv-display text-lg font-normal italic leading-tight text-white">
              {book.name}
            </h2>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={wrapperClass}
      style={{
        backgroundImage:
          "repeating-linear-gradient(135deg, rgba(0,0,0,0.04) 0 14px, rgba(0,0,0,0.00) 14px 28px), linear-gradient(135deg, hsl(var(--pv-surface-2)), hsl(var(--pv-border-soft)))",
      }}
    >
      <div className="flex h-full items-center justify-center px-4 text-center">
        <span className="pv-display text-[20px] italic leading-tight text-foreground">
          {book.name}
        </span>
      </div>
    </div>
  );
}
