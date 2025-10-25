import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { BookOpen, Lock } from "lucide-react";
import { usePublishedPageData } from "@/hooks/use-published-page-data";
import { PageLoading } from "@/components/page/PageLoading";
import { SlugService } from "@/utils/slugService";

/**
 * PublishedBookDetails - Public view of a published book
 * Shows table of contents from published version only (immutable)
 */
export default function PublishedBookDetails() {
  const { id } = useParams();
  const navigate = useNavigate();

  // Fetch published book data
  const { book, allPages, loading, notFound } = usePublishedPageData(id, undefined);

  if (loading) {
    return (
      <div className="container mx-auto p-6">
        <PageLoading />
      </div>
    );
  }

  if (notFound || !book) {
    return (
      <div className="container mx-auto p-6">
        <Card className="p-12 text-center">
          <div className="flex flex-col items-center gap-4">
            <Lock className="h-16 w-16 text-muted-foreground" />
            <h2 className="text-2xl font-semibold">Book Not Available</h2>
            <p className="text-muted-foreground max-w-md">
              This book is either not published, has been unpublished, or does not exist.
            </p>
            <Button onClick={() => navigate("/library")} variant="outline" className="mt-4">
              Browse Library
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  const bookId = SlugService.extractId(id);

  return (
    <div className="container mx-auto p-6 max-w-5xl">
      {/* Book Header */}
      <div className="mb-8">
        <div className="flex gap-6 items-start">
          {/* Book Cover */}
          {book.cover_url && (
            <div className="w-48 flex-shrink-0">
              <img
                src={book.cover_url}
                alt={book.name}
                className="w-full rounded-lg shadow-lg"
              />
            </div>
          )}

          {/* Book Info */}
          <div className="flex-1">
            <h1 className="text-4xl font-bold mb-2">{book.name}</h1>
            {book.subtitle && (
              <p className="text-xl text-muted-foreground mb-4">{book.subtitle}</p>
            )}
            {book.author && (
              <p className="text-lg text-muted-foreground mb-4">by {book.author}</p>
            )}
            {book.published_at && (
              <p className="text-sm text-muted-foreground">
                Published {new Date(book.published_at).toLocaleDateString()}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Table of Contents */}
      <div className="mb-6">
        <h2 className="text-2xl font-semibold mb-4 flex items-center gap-2">
          <BookOpen className="h-6 w-6" />
          Table of Contents
        </h2>
      </div>

      {/* Page List */}
      {allPages.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-muted-foreground">This book has no pages yet.</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {allPages.map((page, index) => (
            <Card
              key={page.id}
              className="p-4 hover:bg-accent cursor-pointer transition-colors"
              onClick={() => {
                const pageSlug = SlugService.generateSlug(page.id, page.title);
                navigate(`/library/book/${id}/page/${pageSlug}`);
              }}
            >
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-muted-foreground w-8">
                  {index + 1}.
                </span>
                <h3 className="text-lg font-medium flex-1">{page.title || "Untitled"}</h3>
                <BookOpen className="h-4 w-4 text-muted-foreground" />
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Start Reading Button */}
      {allPages.length > 0 && (
        <div className="mt-8 flex justify-center">
          <Button
            size="lg"
            onClick={() => {
              const firstPage = allPages[0];
              const pageSlug = SlugService.generateSlug(firstPage.id, firstPage.title);
              navigate(`/library/book/${id}/page/${pageSlug}`);
            }}
          >
            <BookOpen className="h-5 w-5 mr-2" />
            Start Reading
          </Button>
        </div>
      )}
    </div>
  );
}
