import { useState, useRef, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { PageNavigation } from "./components/PageNavigation";
import { PageContent } from "./components/PageContent";
import { PageLoading } from "@/components/page/PageLoading";
import { PageNotFound } from "./components/PageNotFound";
import { useBookPermissions } from "@/hooks/use-book-permissions";
import { TableOfContents } from "./components/TableOfContents";
import { PageChatPanel } from "./components/PageChatPanel";
import { PageMeta } from "./components/PageMeta";
import { PageViewSettings } from "./components/PageViewSettings";
import { PageTableOfContents } from "./components/PageTableOfContents";
import { PageSettingsDrawer } from "./components/PageSettingsDrawer";
import { SlugService } from "@/utils/slugService";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { SearchDialog } from "@/components/search/SearchDialog";

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
  // 1. URL parameters (slugs, not IDs)
  const { bookSlug, pageSlug } = useParams();
  const navigate = useNavigate();

  // 2. Extract numeric IDs from slugs
  const numericBookId = SlugService.extractId(bookSlug);
  const numericPageId = SlugService.extractId(pageSlug);

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
  } = usePageViewData(bookSlug, pageSlug);

  // 4. Check permissions
  const { canEdit, loading: permissionsLoading } = useBookPermissions(numericBookId.toString());

  // 5. Local UI state
  const [isEditing, setIsEditing] = useEditMode(canEdit);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const { toast } = useToast();
  
  // Use ref to track page type independently to avoid triggering content updates
  const pageTypeRef = useRef<'text' | 'section'>(page?.page_type as 'text' | 'section' || 'text');
  
  // Update pageTypeRef whenever page changes to prevent persistence between pages
  useEffect(() => {
    if (page?.page_type) {
      pageTypeRef.current = page.page_type as 'text' | 'section';
    }
  }, [page?.id, page?.page_type]); // Re-run when page ID or page_type changes

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
    numericPageId.toString(),
    canEdit,
    (updatedJson, updatedTitle) => {
      // Update page title and content in local state
      setPage(prevPage =>
        prevPage ? { ...prevPage, title: updatedTitle, content: updatedJson } : null
      );
    },
    numericBookId // Pass bookId for proper cache updates
  );

  // 8. Navigation logic
  const { navigateToPage, navigateNext, navigatePrev } = usePageNavigation(
    bookSlug, // Used for URL generation only
    numericBookId,
    allPages,
    currentIndex
  );

  // 9. Page creation logic
  const { createNewPage } = usePageCreation(bookSlug, numericBookId, canEdit); // bookSlug used for URL generation

  // 10. Page deletion logic
  const handleDeletePage = async () => {
    if (!canEdit) {
      toast({
        variant: "destructive",
        title: "Permission denied",
        description: "You don't have permission to delete this page"
      });
      return;
    }

    try {
      // Archive the page
      const { error: archiveError } = await supabase
        .from('pages')
        .update({ 
          archived: true,
          updated_at: new Date().toISOString()
        })
        .eq('id', numericPageId);

      if (archiveError) throw archiveError;

      // Get remaining pages and update their indices
      const remainingPages = allPages.filter(p => p.id !== numericPageId);
      const updatedPages = remainingPages.map((page, index) => ({
        id: page.id,
        page_index: index,
        book_id: numericBookId
      }));

      // Update the indices of remaining pages
      const { error: updateError } = await supabase
        .from('pages')
        .upsert(updatedPages);

      if (updateError) throw updateError;

      toast({
        title: "Page deleted",
        description: "The page has been archived successfully"
      });

      // Smart navigation after deletion
      if (remainingPages.length === 0) {
        // No pages left, go to book details (table of contents)
        navigate(`/books/${bookSlug}`);
      } else if (currentIndex < remainingPages.length) {
        // Not the last page, go to the next page (which now has the same index)
        const nextPage = remainingPages[currentIndex];
        navigate(`/books/${bookSlug}/pages/${nextPage.id}`);
      } else {
        // Was the last page, go to the previous page (now the new last page)
        const prevPage = remainingPages[remainingPages.length - 1];
        navigate(`/books/${bookSlug}/pages/${prevPage.id}`);
      }
    } catch (error) {
      console.error('Error deleting page:', error);
      toast({
        variant: "destructive",
        title: "Error deleting page",
        description: error instanceof Error ? error.message : "Failed to delete page"
      });
    }
  };

  // 11. Side effects (auto-tracking)
  useBookmarkTracking(numericBookId, currentIndex);
  useKeyboardNavigation({ onNext: navigateNext, onPrev: navigatePrev }, isEditing);
  usePageTitle(page?.title, book?.name);

  // 12. Preload next page for faster navigation
  useNextPagePreloader(numericBookId, nextPageId);

  // 13. Loading state
  if (dataLoading || permissionsLoading) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <PageViewSettings onSearchOpen={() => setSearchOpen(true)} />
        <div className="flex-1 container max-w-4xl mx-auto px-4 py-4">
          <PageLoading />
        </div>
      </div>
    );
  }

  // 14. Not found state
  if (!page || !book) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <PageViewSettings onSearchOpen={() => setSearchOpen(true)} />
        <div className="flex-1 container max-w-4xl mx-auto px-4 py-4">
          <PageNotFound bookId={numericBookId.toString()} />
        </div>
      </div>
    );
  }

  // 15. Main render - Pure composition
  return (
    <div className="min-h-screen flex bg-background w-full">
      {/* SEO Meta Tags */}
      <PageMeta page={page} book={book} />

      {/* Settings Drawer */}
      <PageSettingsDrawer onSearchOpen={() => setSearchOpen(true)} />

      {/* Login/Logout Button */}
      <PageViewSettings onSearchOpen={() => setSearchOpen(true)} />

      {/* Search Dialog */}
      <SearchDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
      />

      {/* Left Sidebar: Pages List - Fixed height, independently scrollable */}
      <aside className="hidden lg:flex w-64 flex-col border-r border-border/40 bg-background/50 h-screen sticky top-0 overflow-hidden">
        <TableOfContents
          pages={allPages}
          bookId={numericBookId.toString()}
          currentPageId={numericPageId}
          onNewPage={createNewPage}
          canEdit={canEdit}
          bookName={book.name}
        />
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col">
        <div className="flex-1 container max-w-5xl mx-auto px-4 py-4 flex flex-col gap-4">
          <div className="flex-1 flex flex-col">

            {/* Page Editor/Viewer */}
            <PageContent
              key={`current-page-${page.id.toString()}`} // Force remount when page changes to prevent stale content
              jsonContent={page.content}
              onSave={handleSave}
              saving={saving}
              pageType={pageTypeRef.current}
              onPageTypeChange={handlePageTypeChange}
              editable={canEdit}
              onEditingChange={setIsEditing}
              canEdit={canEdit}
              pageId={numericPageId.toString()}
              isEditing={isEditing}
              setIsEditing={setIsEditing}
              onToggleChat={() => setIsChatOpen(!isChatOpen)}
              hasActiveChat={isChatOpen}
              bookId={numericBookId.toString()}
              onDeletePage={handleDeletePage}
            />

            {/* Navigation Controls */}
            <PageNavigation
              bookId={numericBookId.toString()}
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

      {/* Right Sidebar: Page TOC (hidden when chat is open) */}
      {!isChatOpen && <PageTableOfContents pageId={numericPageId} />}

      {/* Right Sidebar: AI Chat Panel */}
      <PageChatPanel
        pageId={numericPageId.toString()}
        pageContent={page.content}
        canEdit={canEdit}
        isOpen={isChatOpen}
        onClose={() => setIsChatOpen(false)}
        onApplyEdit={(oldText, newText) => {
          handleApplyEdit(oldText, newText, page.content);
        }}
      />
    </div>
  );
};

export default PageView;
