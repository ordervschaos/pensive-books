import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft} from "lucide-react";
import { MatureContentGate } from "@/components/MatureContentGate";
import { PublishedPageTracker } from "@/components/PublishedPageTracker";
import { RichTextRenderer } from "@/components/RichTextRenderer";
import { KeyboardPageNav } from "@/components/KeyboardPageNav";
import { getPublishedPage } from "@/lib/public-books";
import { slugifyIdTitle } from "@/lib/pensive";

export const dynamic = "force-dynamic";

type Props = {
  params: {
    bookSlug: string;
    pageSlug: string;
  };
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const detail = await getPublishedPage(params.bookSlug, params.pageSlug);

  if (!detail) {
    return {
      title: "Page Not Found | Pensive",
    };
  }

  return {
    title: `${detail.page.title} | ${detail.book.name} | Pensive`,
    description: `Read ${detail.page.title} from ${detail.book.name}.`,
    openGraph: {
      title: `${detail.page.title} | ${detail.book.name} | Pensive`,
      description: `Read ${detail.page.title} from ${detail.book.name}.`,
      images: detail.book.cover_url ? [detail.book.cover_url] : ["/og-image.png"],
    },
  };
}

export default async function PublishedPageRoute({ params }: Props) {
  const detail = await getPublishedPage(params.bookSlug, params.pageSlug);

  if (!detail) {
    notFound();
  }

  const canonicalBookSlug = slugifyIdTitle(detail.book.id, detail.book.name);
  const canonicalPageSlug = slugifyIdTitle(detail.page.id, detail.page.title);

  if (
    params.bookSlug !== canonicalBookSlug ||
    params.pageSlug !== canonicalPageSlug
  ) {
    redirect(
      `/library/books/${canonicalBookSlug}/pages/${canonicalPageSlug}`,
    );
  }

  const prevHref = detail.previousPage
    ? `/library/books/${canonicalBookSlug}/pages/${slugifyIdTitle(detail.previousPage.id, detail.previousPage.title)}`
    : null;
  const nextHref = detail.nextPage
    ? `/library/books/${canonicalBookSlug}/pages/${slugifyIdTitle(detail.nextPage.id, detail.nextPage.title)}`
    : null;

  const bookHref = `/library/books/${canonicalBookSlug}`;
  const total = detail.book.pages.length;
  const current = detail.currentIndex + 1;
  const isMature = Boolean(detail.book.content_tags?.includes("mature"));

  const content = (
    <main className="relative min-h-[calc(100vh-56px)] bg-background">
      <PublishedPageTracker
        bookId={detail.book.id}
        pageIndex={detail.currentIndex}
      />
      <KeyboardPageNav prevHref={prevHref} nextHref={nextHref} />

      {/* Page header — sits in flow, scrolls away with the page */}
      <header className="mx-auto flex max-w-[680px] items-center justify-between gap-4 px-6 pt-6">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href={bookHref}
            aria-label="Back to book"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[hsl(var(--pv-text-muted))] transition-colors hover:bg-[hsl(var(--pv-surface-2))] hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0">
            <div className="pv-mono truncate text-[10.5px] uppercase tracking-[0.18em] text-[hsl(var(--pv-text-faint))]">
              {detail.book.name}
            </div>
            {detail.book.author && (
              <div className="pv-serif truncate text-[13px] italic text-[hsl(var(--pv-text-muted))]">
                {detail.book.author}
              </div>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {/* placeholder for action buttons */}
        </div>
      </header>

      {/* Reading column */}
      <article className="mx-auto max-w-[640px] px-6 pb-20 pt-16">
        <div className="text-center">
          <div className="pv-eyebrow">
            page {current} of {total}
          </div>
          <h1 className="pv-display mt-3.5 text-[44px] font-normal italic leading-[1.05] tracking-tight text-foreground md:text-[56px]">
            {detail.page.title}
          </h1>
          <div
            aria-hidden
            className="mb-10 mt-7 text-[hsl(var(--pv-text-faint))]"
            style={{ letterSpacing: "8px" }}
          >
            —
          </div>
        </div>

        <div className="reader-body">
          <RichTextRenderer
            content={detail.page.content}
            bookId={detail.book.id}
            bookSlug={canonicalBookSlug}
            centerContent={detail.page.page_type === "section"}
            pageTitle={detail.page.title}
          />
        </div>

        <div
          aria-hidden
          className="mt-9 text-center text-[22px] text-[hsl(var(--pv-text-faint))]"
        >
          §
        </div>

        {/* Footer page navigation */}
        <footer className="mt-14 grid grid-cols-[1fr_auto_1fr] items-baseline gap-6 border-t border-border pt-7">
          {prevHref ? (
            <Link
              href={prevHref}
              className="pv-serif justify-self-start text-[15px] italic text-[hsl(var(--pv-text-muted))] transition-colors hover:text-foreground"
            >
              ← previous page
            </Link>
          ) : (
            <span />
          )}
          <span className="pv-mono text-[11px] uppercase tracking-[0.18em] text-[hsl(var(--pv-text-faint))]">
            page {current} of {total}
          </span>
          {nextHref && detail.nextPage ? (
            <Link
              href={nextHref}
              className="pv-serif justify-self-end border-b border-foreground pb-px text-[15px] text-foreground"
            >
              {detail.nextPage.title || "Next page"} →
            </Link>
          ) : (
            <span />
          )}
        </footer>
      </article>
    </main>
  );

  if (isMature) {
    return (
      <MatureContentGate bookName={detail.book.name}>{content}</MatureContentGate>
    );
  }

  return content;
}

function ToolButton({
  children,
  ariaLabel,
  href,
}: {
  children: React.ReactNode;
  ariaLabel: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[hsl(var(--pv-text-muted))] transition-colors hover:bg-[hsl(var(--pv-surface-2))] hover:text-foreground"
    >
      {children}
    </Link>
  );
}

