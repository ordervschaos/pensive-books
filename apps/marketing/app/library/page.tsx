import type { Metadata } from "next";
import Link from "next/link";
import { getLibraryBooksPage, type PublicBook } from "@/lib/public-books";
import { slugifyIdTitle } from "@/lib/pensive";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Library | Pensive",
  description: "Browse books published on Pensive.",
};

const LIBRARY_PAGE_SIZE = 24;

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

function parsePage(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number.parseInt(raw ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

type LibrarySearchParams = {
  page?: string | string[];
};

export default async function LibraryPage({
  searchParams,
}: {
  searchParams?: LibrarySearchParams;
}) {
  const page = parsePage(searchParams?.page);
  const { books, total } = await getLibraryBooksPage(page, LIBRARY_PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(total / LIBRARY_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const isFirstPage = currentPage === 1;
  const featured = isFirstPage ? books.slice(0, 3) : [];
  const rest = isFirstPage ? books.slice(3) : books;

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
            {total}{" "}
            {total === 1 ? "book" : "books"} ·{" "}
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

      {total === 0 ? (
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
              {isFirstPage && <hr className="mt-14 border-t border-border" />}
              <section className={isFirstPage ? "mt-9" : "mt-9"}>
                <SectionHead
                  title={isFirstPage ? "The catalog" : `The catalog · page ${currentPage}`}
                  more={`${total} books`}
                />
                <div className="grid grid-cols-2 gap-x-9 gap-y-12 sm:grid-cols-3 md:grid-cols-4">
                  {rest.map((book) => (
                    <CatalogCard key={book.id} book={book} />
                  ))}
                </div>
              </section>
            </>
          )}

          {totalPages > 1 && (
            <Pagination currentPage={currentPage} totalPages={totalPages} />
          )}
        </>
      )}
    </main>
  );
}

function Pagination({
  currentPage,
  totalPages,
}: {
  currentPage: number;
  totalPages: number;
}) {
  const prevHref = currentPage > 1
    ? currentPage - 1 === 1
      ? "/library"
      : `/library?page=${currentPage - 1}`
    : null;
  const nextHref =
    currentPage < totalPages ? `/library?page=${currentPage + 1}` : null;

  return (
    <nav
      aria-label="Library pagination"
      className="mt-14 flex items-center justify-between border-t border-border pt-7"
    >
      {prevHref ? (
        <Link
          href={prevHref}
          className="pv-serif text-[15px] italic text-[hsl(var(--pv-text-muted))] transition-colors hover:text-foreground"
        >
          ← previous page
        </Link>
      ) : (
        <span />
      )}
      <span className="pv-mono text-[11px] uppercase tracking-[0.18em] text-[hsl(var(--pv-text-faint))]">
        page {currentPage} of {totalPages}
      </span>
      {nextHref ? (
        <Link
          href={nextHref}
          className="pv-serif border-b border-foreground pb-px text-[15px] text-foreground"
        >
          next page →
        </Link>
      ) : (
        <span />
      )}
    </nav>
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
      <h3 className="pv-display mt-[18px] text-[26px] font-normal leading-[1.1] tracking-tight text-foreground md:text-[28px]">
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
      <h4 className="pv-serif mt-3.5 text-[17px] font-medium leading-snug text-foreground">
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
