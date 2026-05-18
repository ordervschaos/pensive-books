import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
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

  const publishedDate = formatPublishedDate(book.published_at);
  const pageCount = book.pages.length;
  // Rough estimate: ~3 minutes per page; this is intentionally an approximation
  // since the data set doesn't track word counts.
  const minutes = pageCount * 3;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;

  return (
    <main className="mx-auto max-w-[760px] px-6 pb-24 pt-14">
      <Link
        href="/library"
        className="pv-serif text-[14px] italic text-[hsl(var(--pv-text-muted))] transition-colors hover:text-foreground"
      >
        ← back to the library
      </Link>

      {/* Cover */}
      <div className="mt-9 flex justify-center">
        <div className="relative h-[312px] w-[240px] overflow-hidden rounded-[3px] border border-border bg-[hsl(var(--pv-surface-2))] shadow-[0_24px_50px_rgba(0,0,0,0.12)]">
          {book.cover_url ? (
            <img
              src={book.cover_url}
              alt={book.name}
              className="h-full w-full object-cover"
            />
          ) : (
            <div
              className="flex h-full w-full items-center justify-center px-4 text-center"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(135deg, rgba(0,0,0,0.04) 0 14px, rgba(0,0,0,0.00) 14px 28px), linear-gradient(135deg, hsl(var(--pv-surface-2)), hsl(var(--pv-border-soft)))",
              }}
            >
              <span className="pv-display text-[22px] italic leading-tight text-foreground">
                {book.name}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Title block */}
      <div className="mt-10 text-center">
        <div className="pv-eyebrow">a book on pensive</div>
        <h1 className="pv-display mt-4 text-[52px] font-normal leading-none tracking-tight text-foreground md:text-[64px]">
          {book.name}
        </h1>
        {book.subtitle && (
          <p className="pv-serif mt-3 text-[20px] font-normal italic leading-snug text-[hsl(var(--pv-text-muted))] md:text-[22px]">
            {book.subtitle}
          </p>
        )}
        {book.author && (
          <p className="pv-serif mt-5 text-[16px] text-foreground">
            by {book.author}
          </p>
        )}
      </div>

      {/* Meta line */}
      <div className="pv-mono mt-6 flex flex-wrap items-center justify-center gap-2 text-[11px] uppercase tracking-[0.15em] text-[hsl(var(--pv-text-muted))]">
        <span>
          {pageCount} {pageCount === 1 ? "page" : "pages"}
        </span>
        {minutes > 0 && (
          <>
            <Dot />
            <span>
              ~{hours > 0 ? `${hours}h ` : ""}
              {remMinutes}m
            </span>
          </>
        )}
        {publishedDate && (
          <>
            <Dot />
            <span>Published {publishedDate}</span>
          </>
        )}
      </div>

      {/* Primary actions */}
      <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
        <ContinueReadingButton
          bookId={book.id}
          bookSlug={canonicalBookSlug}
          pages={book.pages.map((page) => ({
            id: page.id,
            title: page.title,
          }))}
        />
        {book.pages[0] && (
          <Link
            href={`/library/books/${canonicalBookSlug}/pages/${slugifyIdTitle(book.pages[0].id, book.pages[0].title)}`}
            className="pv-serif inline-flex items-center justify-center rounded-full border border-border bg-transparent px-6 py-3 text-[14px] tracking-[0.01em] text-foreground transition-colors hover:bg-[hsl(var(--pv-surface-2))]"
          >
            Read from the start
          </Link>
        )}
      </div>

      {/* Contents */}
      {book.pages.length > 0 && (
        <>
          <hr className="my-16 border-t border-border" />
          <div className="pv-eyebrow text-center">Contents</div>
          <ol className="m-0 mt-5 list-none p-0">
            {book.pages.map((page, index) => (
              <li
                key={page.id}
                className="border-b border-dashed border-border"
              >
                <Link
                  href={`/library/books/${canonicalBookSlug}/pages/${slugifyIdTitle(page.id, page.title)}`}
                  className="pv-serif grid grid-cols-[36px_1fr_auto] items-baseline gap-4 px-1 py-4 text-[18px] text-foreground transition-colors hover:bg-[hsl(var(--pv-surface-2))]"
                >
                  <span
                    className="text-[hsl(var(--pv-text-faint))]"
                    style={{ fontVariantNumeric: "oldstyle-nums" }}
                  >
                    {index + 1}.
                  </span>
                  <span>{page.title || "Untitled"}</span>
                  <span className="pv-mono text-[11px] uppercase tracking-[0.1em] text-[hsl(var(--pv-text-faint))]">
                    page {index + 1}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </>
      )}
    </main>
  );
}

function Dot() {
  return (
    <span
      aria-hidden
      className="inline-block h-[3px] w-[3px] rounded-full bg-[hsl(var(--pv-text-faint))]"
    />
  );
}
