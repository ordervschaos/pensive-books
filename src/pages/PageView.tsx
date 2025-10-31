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
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

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
  const { toast } = useToast();
  
  // Use ref to track page type independently to avoid triggering content updates
  const pageTypeRef = useRef<'text' | 'section'>(page?.page_type as 'text' | 'section' || 'text');

  // 6. Page type update function
  const handlePageTypeChange = async (newPageType: 'text' | 'section') => {
    if (!canEdit || !page) return;
    
    try {
      const { error } = await supabase
        .from('pages')
        .update({ page_type: newPageType })
        .eq('id', numericPageId);

      if (error) throw error;

      // Update ref immediately to avoid re-renders
      pageTypeRef.current = newPageType;
      
      // Update local state for persistence
      setPage(prevPage =>
        prevPage ? { ...prevPage, page_type: newPageType } : null
      );

      // Manually trigger editor refocus after state update
      // Use a slight delay to ensure DOM has updated
      setTimeout(() => {
        const editorElement = document.querySelector('.ProseMirror') as HTMLElement;
        if (editorElement) {
          editorElement.focus();
        }
      }, 100);

      // Toast removed to prevent cursor loss
    } catch (error) {
      console.error('Error updating page type:', error);
      toast({
        variant: "destructive",
        title: "Failed to update page type",
        description: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };

  // 7. Page save logic with proper state update
  const { handleSave, handleApplyEdit, saving } = usePageSave(
    pageId,
    canEdit,
    (updatedJson, updatedTitle) => {
      // Update page title and content in local state
      setPage(prevPage =>
        prevPage ? { ...prevPage, title: updatedTitle, content: updatedJson } : null
      );
    }
  );

  // 8. Navigation logic
  const { navigateToPage, navigateNext, navigatePrev } = usePageNavigation(
    bookId,
    numericBookId,
    allPages,
    currentIndex
  );

  // 9. Page creation logic
  const { createNewPage } = usePageCreation(bookId, numericBookId, canEdit);

  // 10. Side effects (auto-tracking)
  useBookmarkTracking(numericBookId, currentIndex);
  useKeyboardNavigation({ onNext: navigateNext, onPrev: navigatePrev }, isEditing);
  usePageTitle(page?.title, book?.name);

  // 11. Preload next page for faster navigation
  useNextPagePreloader(numericBookId, nextPageId);

  // 12. Loading state
  if (dataLoading || permissionsLoading) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <div className="flex-1 container max-w-4xl mx-auto px-4 py-4">
          <PageLoading />
        </div>
      </div>
    );
  }

  // 13. Not found state
  if (!page || !book) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <div className="flex-1 container max-w-4xl mx-auto px-4 py-4">
          <PageNotFound bookId={bookId || ""} />
        </div>
      </div>
    );
  }

  // 14. Main render - Pure composition
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
                    jsonContent={page.content}
                    title={page.title || 'Untitled'}
                    onSave={handleSave}
                    saving={saving}
                    pageType={pageTypeRef.current}
                    onPageTypeChange={handlePageTypeChange}
                    editable={canEdit}
                    onEditingChange={setIsEditing}
                    canEdit={canEdit}
                    pageId={pageId}
                    isEditing={isEditing}
                    setIsEditing={setIsEditing}
                    onToggleChat={() => setIsChatOpen(!isChatOpen)}
                    hasActiveChat={isChatOpen}
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
              pageContent={page.content}
              canEdit={canEdit}
              isOpen={isChatOpen}
              onClose={() => setIsChatOpen(false)}
              onApplyEdit={(oldText, newText) => {
                handleApplyEdit(oldText, newText, page.content);
              }}
            />

          </SidebarInset>
        </div>
      </div>
    </SidebarProvider>
  );
};

export default PageView;
