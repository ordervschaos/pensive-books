import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ChevronLeft, ChevronRight, BookOpen, Lock } from "lucide-react";
import { usePublishedPageData } from "@/hooks/use-published-page-data";
import { PageLoading } from "@/components/page/PageLoading";
import { SlugService } from "@/utils/slugService";
import { StaticPageRenderer } from "@/components/page/StaticPageRenderer";
import {
  SidebarProvider,
  Sidebar,
  SidebarContent,
  SidebarInset
} from "@/components/ui/sidebar";
import { useEffect, useCallback } from "react";
import { useKeyboardNavigation } from "@/hooks/use-keyboard-navigation";
import { useBookmarkTracking } from "@/hooks/use-bookmark-tracking";

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

  // Navigation handlers - defined early for keyboard navigation hook
  const numericBookId = SlugService.extractId(bookId);
  const numericPageId = SlugService.extractId(pageId);

  const handleNavigateToPage = useCallback((targetPageId: number, targetTitle: string) => {
    const pageSlug = SlugService.generateSlug(targetPageId, targetTitle);
    navigate(`/library/book/${bookId}/page/${pageSlug}`);
  }, [bookId, navigate]);

  const handlePrevious = useCallback(() => {
    if (currentIndex > 0 && allPages.length > 0) {
      const prevPage = allPages[currentIndex - 1];
      handleNavigateToPage(prevPage.id, prevPage.title);
    }
  }, [currentIndex, allPages, handleNavigateToPage]);

  const handleNext = useCallback(() => {
    if (currentIndex < totalPages - 1 && allPages.length > 0) {
      const nextPage = allPages[currentIndex + 1];
      handleNavigateToPage(nextPage.id, nextPage.title);
    }
  }, [currentIndex, totalPages, allPages, handleNavigateToPage]);

  const handleBackToBook = useCallback(() => {
    navigate(`/library/book/${bookId}`);
  }, [bookId, navigate]);

  // Set page title
  useEffect(() => {
    if (page?.title && book?.name) {
      document.title = `${page.title} - ${book.name}`;
    }
  }, [page?.title, book?.name]);

  // Automatically track reading position (updates bookmark when currentIndex changes)
  useBookmarkTracking(numericBookId, currentIndex);

  // Enable arrow key navigation (Left/Right arrows)
  useKeyboardNavigation(
    {
      onNext: handleNext,
      onPrev: handlePrevious
    },
    false // Not in editing mode (read-only view)
  );

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
            <div className={`flex-1 container max-w-5xl mx-auto px-4 py-4 flex flex-col gap-4 ${
              page.page_type === 'section' ? 'justify-center' : ''
            }`}>
              {/* Static Rendered Content */}
              <div className={page.page_type === 'section' ? 'flex-1 flex items-center justify-center' : 'flex-1'}>
                <StaticPageRenderer 
                  content={page.content} 
                  centerContent={page.page_type === 'section'}
                />
              </div>

              {/* Navigation Footer */}
              <div className="mt-8">
                <div className="bg-muted/30 border border-border rounded-lg p-4 md:p-6">
                  {/* Top row: Back to book button */}
                  <div className="flex items-center justify-end mb-4 pb-3 border-b border-border">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleBackToBook}
                      className="text-sm text-muted-foreground hover:text-foreground"
                    >
                      <ChevronLeft className="h-4 w-4 mr-1" />
                      Back to Book
                    </Button>
                  </div>

                  {/* Navigation row: Previous | Page counter | Next */}
                  <div className="flex items-center justify-between mb-4">
                    {/* Previous Button */}
                    <Button
                      variant="outline"
                      onClick={handlePrevious}
                      disabled={currentIndex === 0}
                      className="flex items-center gap-2 px-4 md:px-6 py-2"
                    >
                      <ChevronLeft className="h-4 w-4" />
                      <span className="hidden sm:inline">Previous</span>
                    </Button>

                    {/* Center: Page counter */}
                    <span className="text-sm text-muted-foreground">
                      Page {currentIndex + 1} / {totalPages}
                    </span>

                    {/* Next Button or Back to Contents */}
                    {currentIndex < totalPages - 1 ? (
                      <Button
                        onClick={handleNext}
                        className="flex items-center gap-2 px-4 md:px-6 py-2"
                      >
                        <span className="hidden sm:inline">Next</span>
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    ) : (
                      <Button
                        onClick={handleBackToBook}
                        className="flex items-center gap-2 px-4 md:px-6 py-2"
                      >
                        <BookOpen className="h-4 w-4" />
                        <span className="hidden sm:inline">Back to Contents</span>
                      </Button>
                    )}
                  </div>

                  {/* Next Page Preview */}
                  {nextPageTitle && currentIndex < totalPages - 1 && (
                    <div className="text-center pt-2 border-t border-border">
                      <p className="text-sm text-muted-foreground">
                        Next: <span className="font-medium text-foreground">{nextPageTitle}</span>
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </SidebarInset>
        </div>
      </div>
    </SidebarProvider>
  );
}
