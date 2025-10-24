import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ChevronLeft, ChevronRight, BookOpen, Lock } from "lucide-react";
import { usePublishedPageData } from "@/hooks/use-published-page-data";
import { PageLoading } from "@/components/page/PageLoading";
import { SlugService } from "@/utils/slugService";
import { TipTapEditor } from "@/components/editor/TipTapEditor";
import {
  SidebarProvider,
  Sidebar,
  SidebarContent,
  SidebarInset
} from "@/components/ui/sidebar";
import { useEffect } from "react";

/**
 * PublishedPageView - Public read-only view of a published page
 * Shows content from page_versions (immutable published snapshot)
 */
export default function PublishedPageView() {
  const { bookId, pageId } = useParams();
  const navigate = useNavigate();

  // Fetch published page data
  const {
    page,
    book,
    allPages,
    currentIndex,
    totalPages,
    nextPageId,
    nextPageTitle,
    loading,
    notFound,
  } = usePublishedPageData(bookId, pageId);

  // Set page title
  useEffect(() => {
    if (page?.title && book?.name) {
      document.title = `${page.title} - ${book.name}`;
    }
  }, [page?.title, book?.name]);

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <div className="flex-1 container max-w-4xl mx-auto px-4 py-4">
          <PageLoading />
        </div>
      </div>
    );
  }

  if (notFound || !page || !book) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <div className="flex-1 container max-w-4xl mx-auto px-4 py-4">
          <Card className="p-12 text-center">
            <div className="flex flex-col items-center gap-4">
              <Lock className="h-16 w-16 text-muted-foreground" />
              <h2 className="text-2xl font-semibold">Page Not Available</h2>
              <p className="text-muted-foreground max-w-md">
                This page is not part of the published version or the book has been unpublished.
              </p>
              <Button onClick={() => navigate("/library")} variant="outline" className="mt-4">
                Browse Library
              </Button>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  const numericBookId = SlugService.extractId(bookId);
  const numericPageId = SlugService.extractId(pageId);

  const handleNavigateToPage = (targetPageId: number, targetTitle: string) => {
    const pageSlug = SlugService.generateSlug(targetPageId, targetTitle);
    navigate(`/published/book/${bookId}/page/${pageSlug}`);
  };

  const handlePrevious = () => {
    if (currentIndex > 0) {
      const prevPage = allPages[currentIndex - 1];
      handleNavigateToPage(prevPage.id, prevPage.title);
    }
  };

  const handleNext = () => {
    if (currentIndex < totalPages - 1) {
      const nextPage = allPages[currentIndex + 1];
      handleNavigateToPage(nextPage.id, nextPage.title);
    }
  };

  const handleBackToBook = () => {
    navigate(`/published/book/${bookId}`);
  };

  return (
    <SidebarProvider defaultOpen={false}>
      <div className="min-h-[calc(100vh-56px)] flex flex-col bg-background w-full">
        <div className="flex flex-1 h-full">
          {/* Left Sidebar: Table of Contents */}
          <Sidebar variant="sidebar" side="left">
            <SidebarContent>
              <div className="p-4">
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <BookOpen className="h-5 w-5" />
                  {book.name}
                </h3>
                <div className="space-y-1">
                  {allPages.map((p, idx) => (
                    <button
                      key={p.id}
                      onClick={() => handleNavigateToPage(p.id, p.title)}
                      className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                        p.id === numericPageId
                          ? "bg-accent text-accent-foreground font-medium"
                          : "hover:bg-accent/50"
                      }`}
                    >
                      <span className="text-muted-foreground mr-2">{idx + 1}.</span>
                      {p.title || "Untitled"}
                    </button>
                  ))}
                </div>
              </div>
            </SidebarContent>
          </Sidebar>

          {/* Main Content Area */}
          <SidebarInset className="flex-1 flex flex-col">
            <div className="flex-1 container max-w-5xl mx-auto px-4 py-4 flex flex-col gap-4">
              {/* Back to Book Button */}
              <div className="flex justify-between items-center">
                <Button variant="ghost" size="sm" onClick={handleBackToBook}>
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Back to Book
                </Button>
                <span className="text-sm text-muted-foreground">
                  Page {currentIndex + 1} of {totalPages}
                </span>
              </div>

              {/* Page Title */}
              <div className="mb-4">
                <h1 className="text-4xl font-bold">{page.title || "Untitled"}</h1>
              </div>

              {/* Read-only Editor */}
              <div className="flex-1">
                <TipTapEditor
                  content={page.content}
                  onChange={() => {}} // No-op for read-only
                  editable={false}
                />
              </div>

              {/* Navigation Footer */}
              <div className="mt-8 pt-6 border-t">
                <div className="flex justify-between items-center">
                  {/* Previous Button */}
                  <Button
                    variant="outline"
                    onClick={handlePrevious}
                    disabled={currentIndex === 0}
                  >
                    <ChevronLeft className="h-4 w-4 mr-2" />
                    Previous
                  </Button>

                  {/* Next Button */}
                  {currentIndex < totalPages - 1 ? (
                    <Button onClick={handleNext}>
                      Next
                      <ChevronRight className="h-4 w-4 ml-2" />
                    </Button>
                  ) : (
                    <Button variant="outline" onClick={handleBackToBook}>
                      <BookOpen className="h-4 w-4 mr-2" />
                      Back to Contents
                    </Button>
                  )}
                </div>

                {/* Next Page Preview */}
                {nextPageTitle && currentIndex < totalPages - 1 && (
                  <div className="mt-4 text-center">
                    <p className="text-sm text-muted-foreground">
                      Next: <span className="font-medium">{nextPageTitle}</span>
                    </p>
                  </div>
                )}
              </div>
            </div>
          </SidebarInset>
        </div>
      </div>
    </SidebarProvider>
  );
}
