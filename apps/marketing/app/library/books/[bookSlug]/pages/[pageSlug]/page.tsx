import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { PublishedPageTracker } from "@/components/PublishedPageTracker";
import { RichTextRenderer } from "@/components/RichTextRenderer";
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

  return (
    <main className="min-h-[calc(100vh-56px)] bg-background">
      <PublishedPageTracker
        bookId={detail.book.id}
        pageIndex={detail.currentIndex}
      />

      <div className="container mx-auto max-w-5xl px-4 py-6">
        <section className="rounded-3xl border bg-card px-5 py-8 shadow-sm md:px-8 md:py-10">
          <RichTextRenderer
            content={detail.page.content}
            bookId={detail.book.id}
            bookSlug={canonicalBookSlug}
            centerContent={detail.page.page_type === "section"}
          />

          <div className="mt-12 border-t pt-6">
            <div className="mb-4 flex items-center justify-between gap-3">
              {detail.previousPage ? (
                <Link
                  href={`/library/books/${canonicalBookSlug}/pages/${slugifyIdTitle(detail.previousPage.id, detail.previousPage.title)}`}
                  className="inline-flex items-center gap-2 rounded-md border border-input px-3 py-2 text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </Link>
              ) : (
                <span className="inline-flex items-center gap-2 rounded-md border border-input px-3 py-2 text-sm text-muted-foreground">
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </span>
              )}

              <span className="text-sm text-muted-foreground">
                {detail.currentIndex + 1} / {detail.book.pages.length}
              </span>

              {detail.nextPage ? (
                <Link
                  href={`/library/books/${canonicalBookSlug}/pages/${slugifyIdTitle(detail.nextPage.id, detail.nextPage.title)}`}
                  className="inline-flex items-center gap-2 rounded-md border border-input px-3 py-2 text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Link>
              ) : (
                <span className="inline-flex items-center gap-2 rounded-md border border-input px-3 py-2 text-sm text-muted-foreground">
                  Next
                  <ChevronRight className="h-4 w-4" />
                </span>
              )}
            </div>

            {detail.nextPage && (
              <p className="mb-4 text-center text-sm text-muted-foreground">
                Next:{" "}
                <span className="font-medium text-foreground">
                  {detail.nextPage.title}
                </span>
              </p>
            )}

            <div className="flex justify-center">
              <Link
                href={`/library/books/${canonicalBookSlug}`}
                className="text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                Back to book
              </Link>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
