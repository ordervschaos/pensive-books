import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { PageNavigation } from "@/components/page/PageNavigation";
import { PageContent } from "@/components/page/PageContent";
import { PageLoading } from "@/components/page/PageLoading";
import { PageNotFound } from "@/components/page/PageNotFound";
import { useBookPermissions } from "@/hooks/use-book-permissions";
import { setPageTitle } from "@/utils/pageTitle";
import { TableOfContents } from "@/components/page/TableOfContents";
import {
  SidebarProvider,
  Sidebar,
  SidebarContent,
  SidebarInset
} from "@/components/ui/sidebar";
import { PagePreloader } from "@/components/page/PagePreloader";
import { preloadPages } from "@/utils/pagePreloader";
import { PageChatPanel } from "@/components/page/PageChatPanel";
import { PageMeta } from "@/components/page/PageMeta";
import { SlugService } from "@/utils/slugService";

// Custom hooks
import { usePageViewData } from "@/hooks/use-page-view-data";
import { useBookmarkTracking } from "@/hooks/use-bookmark-tracking";
import { usePageNavigation } from "@/hooks/use-page-navigation";
import { useKeyboardNavigation } from "@/hooks/use-keyboard-navigation";
import { usePageSave } from "@/hooks/use-page-save";

/**
 * Refactored PageView component - Now much cleaner!
 * Delegates logic to custom hooks and child components
 */
const PageViewRefactored = () => {
  // 1. URL parameters
  const { bookId, pageId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [searchParams] = useSearchParams();

  // 2. Extract numeric IDs from slugs
  const numericBookId = SlugService.extractId(bookId);
  const numericPageId = SlugService.extractId(pageId);

  // 3. Fetch all data using custom hook
  const {
    page,
    book,
    allPages,
    currentIndex,
    totalPages,
    nextPageId,
    nextPageTitle,
    loading: dataLoading,
  } = usePageViewData(bookId, pageId);

  // 4. Check permissions
  const { canEdit, loading: permissionsLoading } = useBookPermissions(numericBookId.toString());

  // 5. Local UI state
  const [isEditing, setIsEditing] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);

  // 6. Page save logic
  const { handleSave, handleApplyEdit, saving } = usePageSave(
    pageId,
    canEdit,
    (updatedHtml, updatedTitle) => {
      // Update local page state after successful save
      if (page) {
        page.html_content = updatedHtml;
        page.title = updatedTitle;
      }
    }
  );

  // 7. Navigation logic
  const { navigateNext, navigatePrev } = usePageNavigation(
    bookId,
    numericBookId,
    allPages,
    currentIndex
  );

  // 8. Bookmark tracking (auto-runs on page change)
  useBookmarkTracking(numericBookId, currentIndex);

  // 9. Keyboard shortcuts
  useKeyboardNavigation(
    {
      onNext: navigateNext,
      onPrev: navigatePrev,
    },
    isEditing
  );

  // 10. Set page title in browser
  useEffect(() => {
    if (page && book) {
      setPageTitle(`${page.title} - ${book.name}`);
    }
  }, [page, book]);

  // 11. Auto-enter edit mode if URL has ?edit=true
  useEffect(() => {
    if (searchParams.get("edit") === "true" && canEdit) {
      setIsEditing(true);
    }
  }, [searchParams, canEdit]);

  // 12. Preload next pages for performance
  useEffect(() => {
    if (!dataLoading && nextPageId) {
      preloadPages(numericBookId, [nextPageId]).catch(error => {
        console.error('Error preloading next page:', error);
      });
    }
  }, [nextPageId, numericBookId, dataLoading]);

  // 13. Create new page handler
  const createNewPage = useCallback(async () => {
    if (!canEdit) {
      toast({
        variant: "destructive",
        title: "Permission denied",
        description: "You don't have permission to create pages in this book"
      });
      return;
    }

    try {
      const { data: newPage, error } = await supabase
        .rpc('create_next_page', {
          p_book_id: numericBookId
        })
        .select()
        .single();

      if (error) throw error;

      setIsEditing(true);
      navigate(`/book/${bookId}/page/${newPage.id}`);

      toast({
        title: "Page created",
        description: "Your new page has been created"
      });
    } catch (error: unknown) {
      toast({
        variant: "destructive",
        title: "Error creating page",
        description: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }, [canEdit, numericBookId, bookId, navigate, toast]);

  // 14. Loading state
  if (dataLoading || permissionsLoading) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <div className="flex-1 container max-w-4xl mx-auto px-4 py-4">
          <PageLoading />
        </div>
      </div>
    );
  }

  // 15. Not found state
  if (!page || !book) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <div className="flex-1 container max-w-4xl mx-auto px-4 py-4">
          <PageNotFound bookId={bookId || ""} />
        </div>
      </div>
    );
  }

  // 16. Main render
  return (
    <SidebarProvider defaultOpen={false}>
      <div className="min-h-[calc(100vh-56px)] flex flex-col bg-background w-full">

        {/* SEO Meta Tags */}
        <PageMeta page={page} book={book} />

        {/* Hidden preloader for next page */}
        {nextPageId && (
          <PagePreloader
            bookId={numericBookId}
            pageId={nextPageId}
            onPreloaded={(id) => console.log(`Preloaded page ${id}`)}
          />
        )}

        <div className="flex flex-1 h-full">

          {/* Left Sidebar: Table of Contents */}
          <Sidebar variant="sidebar" side="left">
            <SidebarContent>
              <TableOfContents
                pages={allPages}
                bookId={bookId || ""}
                currentPageId={numericPageId}
              />
            </SidebarContent>
          </Sidebar>

          {/* Main Content Area */}
          <SidebarInset className="flex-1 flex flex-col">
            <div className="flex flex-1 flex-col">
              <div className="flex-1 container max-w-5xl mx-auto px-4 py-4 flex flex-col gap-4">
                <div className="flex-1 flex flex-col">

                  {/* Page Editor/Viewer */}
                  <PageContent
                    content={page.html_content || ''}
                    title={page.title || 'Untitled'}
                    onSave={handleSave}
                    saving={saving}
                    pageType={page.page_type as 'text' | 'section'}
                    editable={canEdit}
                    onEditingChange={setIsEditing}
                    canEdit={canEdit}
                    pageId={pageId}
                    isEditing={isEditing}
                    setIsEditing={setIsEditing}
                    onToggleChat={() => setIsChatOpen(!isChatOpen)}
                    hasActiveChat={isChatOpen}
                  />

                  {/* Navigation Controls */}
                  <PageNavigation
                    bookId={bookId || ""}
                    currentIndex={currentIndex}
                    totalPages={totalPages}
                    onNavigate={(index) => {
                      const targetPage = allPages[index];
                      if (targetPage) {
                        const slug = SlugService.generateSlug(targetPage.id, targetPage.title);
                        navigate(`/book/${bookId}/page/${slug}`);
                      }
                    }}
                    nextPageTitle={nextPageTitle}
                    bookTitle={book.name}
                    isEditing={isEditing}
                    onNewPage={createNewPage}
                    canEdit={canEdit}
                    nextPageId={nextPageId}
                  />

                </div>
              </div>
            </div>

            {/* Right Sidebar: AI Chat Panel */}
            <PageChatPanel
              pageId={pageId || ""}
              pageContent={page.html_content || ''}
              canEdit={canEdit}
              isOpen={isChatOpen}
              onClose={() => setIsChatOpen(false)}
              onApplyEdit={(oldText, newText) =>
                handleApplyEdit(oldText, newText, page.html_content)
              }
            />

          </SidebarInset>
        </div>
      </div>
    </SidebarProvider>
  );
};

export default PageViewRefactored;
