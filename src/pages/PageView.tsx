import { useState } from "react";
import { useParams } from "react-router-dom";
import { PageNavigation } from "@/components/page/PageNavigation";
import { PageContent } from "@/components/page/PageContent";
import { PageLoading } from "@/components/page/PageLoading";
import { PageNotFound } from "@/components/page/PageNotFound";
import { useBookPermissions } from "@/hooks/use-book-permissions";
import { TableOfContents } from "@/components/page/TableOfContents";
import {
  SidebarProvider,
  Sidebar,
  SidebarContent,
  SidebarInset
} from "@/components/ui/sidebar";
import { PageChatPanel } from "@/components/page/PageChatPanel";
import { PageMeta } from "@/components/page/PageMeta";
import { SlugService } from "@/utils/slugService";

// Custom hooks
import { usePageViewData } from "@/hooks/use-page-view-data";
import { useBookmarkTracking } from "@/hooks/use-bookmark-tracking";
import { usePageNavigation } from "@/hooks/use-page-navigation";
import { useKeyboardNavigation } from "@/hooks/use-keyboard-navigation";
import { usePageSave } from "@/hooks/use-page-save";
import { useEditMode } from "@/hooks/use-edit-mode";
import { usePageTitle } from "@/hooks/use-page-title";
import { usePageCreation } from "@/hooks/use-page-creation";
import { useNextPagePreloader } from "@/hooks/use-next-page-preloader";

/**
 * Fully refactored PageView component
 * Pure orchestration - delegates ALL logic to custom hooks and child components
 */
const PageView = () => {
  // 1. URL parameters
  const { bookId, pageId } = useParams();

  // 2. Extract numeric IDs from slugs
  const numericBookId = SlugService.extractId(bookId);
  const numericPageId = SlugService.extractId(pageId);

  // 3. Fetch all data using custom hook
  const {
    page,
    setPage,
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
  const [isEditing, setIsEditing] = useEditMode(canEdit);
  const [isChatOpen, setIsChatOpen] = useState(false);

  // 6. Page save logic with proper state update
  const { handleSave, handleApplyEdit, saving } = usePageSave(
    pageId,
    canEdit,
    (updatedHtml, updatedTitle) => {
      // Properly update state without mutation
      setPage(prevPage =>
        prevPage ? { ...prevPage, html_content: updatedHtml, title: updatedTitle } : null
      );
    }
  );

  // 7. Navigation logic
  const { navigateToPage, navigateNext, navigatePrev } = usePageNavigation(
    bookId,
    numericBookId,
    allPages,
    currentIndex
  );

  // 8. Page creation logic
  const { createNewPage } = usePageCreation(bookId, numericBookId, canEdit);

  // 9. Side effects (auto-tracking)
  useBookmarkTracking(numericBookId, currentIndex);
  useKeyboardNavigation({ onNext: navigateNext, onPrev: navigatePrev }, isEditing);
  usePageTitle(page?.title, book?.name);

  // 10. Preload next page for faster navigation
  useNextPagePreloader(numericBookId, nextPageId);

  // 11. Loading state
  if (dataLoading || permissionsLoading) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <div className="flex-1 container max-w-4xl mx-auto px-4 py-4">
          <PageLoading />
        </div>
      </div>
    );
  }

  // 12. Not found state
  if (!page || !book) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <div className="flex-1 container max-w-4xl mx-auto px-4 py-4">
          <PageNotFound bookId={bookId || ""} />
        </div>
      </div>
    );
  }

  // 13. Main render - Pure composition
  return (
    <SidebarProvider defaultOpen={false}>
      <div className="min-h-[calc(100vh-56px)] flex flex-col bg-background w-full">

        {/* SEO Meta Tags */}
        <PageMeta page={page} book={book} />

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
                    key={`current-page-${page.id.toString()}-cache-${pageId}`} // Force remount when page changes to prevent stale content
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
                    jsonContent={page.content}
                    bookId={bookId}
                  />

                  {/* Navigation Controls */}
                  <PageNavigation
                    bookId={bookId || ""}
                    currentIndex={currentIndex}
                    totalPages={totalPages}
                    onNavigate={navigateToPage}
                    nextPageTitle={nextPageTitle}
                    bookTitle={book.name}
                    isEditing={isEditing}
                    onNewPage={createNewPage}
                    canEdit={canEdit}
                    nextPageId={nextPageId}
                    setIsEditing={setIsEditing}
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

export default PageView;
