import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { BookInfo } from "@/components/book/BookInfo";
import { PagesList } from "./components/PagesList";
import { useBookPermissions } from "@/hooks/use-book-permissions";
import { useUserBookPreferences } from "@/hooks/use-user-book-preferences";
import { BookActionsBar } from "./components/BookActionsBar";
import { BookChatPanel } from "./components/BookChatPanel";
import { IntegratedFlashcardSection } from "@/components/flashcard/IntegratedFlashcardSection";
import { FlashcardEditor } from "@/components/flashcard/FlashcardEditor";
import { GenerateFlashcardsDialog } from "@/components/flashcard/GenerateFlashcardsDialog";
import { FlashcardModal } from "@/components/flashcard/FlashcardModal";
import { useFlashcards } from "@/hooks/use-flashcards";
import { setPageTitle } from "@/utils/pageTitle";
import { Helmet } from "react-helmet-async";
import { executeBookOperation } from "@/lib/book-operations";
import { Button } from "@/components/ui/button";
import { jsonToText, getWordCountFromContent } from "@/utils/tiptapHelpers";
import { CommitDialog } from "./components/CommitDialog";
import { PublishingDialog } from "@/components/book/PublishingDialog";
import { VersionControlButton } from "./components/VersionControlButton";
import { MessageSquare } from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import type { EditorJSON } from "@/types/editor";

const LOCALSTORAGE_BOOKMARKS_KEY = 'bookmarked_pages';

interface BookmarkEntry {
  pageIndex?: number | null;
  timestamp?: string | null;
}

interface BookPage {
  id: number;
  title?: string | null;
  page_index: number;
  updated_at?: string | null;
  content?: EditorJSON | null;
  page_type?: 'text' | 'section';
}

interface BookRecord {
  name: string;
  subtitle?: string | null;
  author?: string | null;
  cover_url?: string | null;
  show_text_on_cover?: boolean;
  is_public: boolean;
  updated_at?: string | null;
  published_at?: string | null;
}

interface FlashcardRecord {
  id: number;
  front?: string;
  back?: string;
}

const BookDetails = () => {
  const { bookSlug } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [book, setBook] = useState<BookRecord | null>(null);
  const [pages, setPages] = useState<BookPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [isDeleteMode, setIsDeleteMode] = useState(false);
  const [bookmarkedPageIndex, setBookmarkedPageIndex] = useState<number | null>(null);
  const [bookmarkTimestamp, setBookmarkTimestamp] = useState<string | null>(null);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const { canEdit, loading: permissionsLoading } = useBookPermissions(bookSlug);
  
  // Get user session for preferences
  const [session, setSession] = useState<Session | null>(null);

  // Check beta flag
  const isBetaEnabled = localStorage.getItem('is_beta') === 'true';

  const getNumericId = (param: string | undefined) => {
    if (!param) return 0;
    const match = param.match(/^(\d+)/);
    return match ? parseInt(match[1]) : 0;
  };
  
  // Extract numeric ID from slug
  const numericBookId = getNumericId(bookSlug);
  
  // User book preferences
  const { 
    preferences, 
    loading: preferencesLoading, 
    toggleFlashcards 
  } = useUserBookPreferences({ 
    bookId: getNumericId(bookSlug), 
    userId: session?.user?.id || '' 
  });

  // Flashcard management
  const {
    flashcards,
    loading: flashcardsLoading,
    generating: flashcardsGenerating,
    createFlashcard,
    updateFlashcard,
    deleteFlashcard,
    generateFlashcards
  } = useFlashcards(bookSlug);

  // Flashcard UI state
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isGenerateDialogOpen, setIsGenerateDialogOpen] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [viewingFlashcard, setViewingFlashcard] = useState<FlashcardRecord | null>(null);
  const [currentFlashcardIndex, setCurrentFlashcardIndex] = useState(0);
  const [editingFlashcard, setEditingFlashcard] = useState<FlashcardRecord | null>(null);

  // Version control state
  const [isCommitDialogOpen, setIsCommitDialogOpen] = useState(false);
  const [isPublishingDialogOpen, setIsPublishingDialogOpen] = useState(false);

  const fetchBookmarkedPage = useCallback(async (session: Session | null) => {
    try {
      const numericId = getNumericId(bookSlug);
      if (session) {
        const { data: userData, error } = await supabase
          .from('user_data')
          .select('bookmarked_pages')
          .eq('user_id', session.user.id)
          .maybeSingle();

        if (error) throw error;
        
        const bookmarks = (userData?.bookmarked_pages as Record<string, number | BookmarkEntry>) || {};
        const bookmarkData = bookmarks[numericId];
        
        // Handle both old format (just number) and new format ({ pageIndex, timestamp })
        if (typeof bookmarkData === 'number') {
          setBookmarkedPageIndex(bookmarkData);
          setBookmarkTimestamp(null);
        } else if (bookmarkData && typeof bookmarkData === 'object') {
          setBookmarkedPageIndex(bookmarkData.pageIndex ?? null);
          setBookmarkTimestamp(bookmarkData.timestamp ?? null);
        } else {
          setBookmarkedPageIndex(null);
          setBookmarkTimestamp(null);
        }
      } else {
        const storedBookmarks = localStorage.getItem(LOCALSTORAGE_BOOKMARKS_KEY);
        const bookmarks = storedBookmarks
          ? (JSON.parse(storedBookmarks) as Record<string, number | BookmarkEntry>)
          : {};
        const bookmarkData = bookmarks[numericId];
        
        // Handle both old format (just number) and new format ({ pageIndex, timestamp })
        if (typeof bookmarkData === 'number') {
          setBookmarkedPageIndex(bookmarkData);
          setBookmarkTimestamp(null);
        } else if (bookmarkData && typeof bookmarkData === 'object') {
          setBookmarkedPageIndex(bookmarkData.pageIndex ?? null);
          setBookmarkTimestamp(bookmarkData.timestamp ?? null);
        } else {
          setBookmarkedPageIndex(null);
          setBookmarkTimestamp(null);
        }
      }
    } catch (error: unknown) {
      console.error('Error fetching bookmarked page:', error);
    }
  }, [bookSlug]);

  const updateBookmark = async (pageIndex: number | null) => {
    try {
      const numericId = getNumericId(bookSlug);
      const { data: { session } } = await supabase.auth.getSession();
      const timestamp = new Date().toISOString();

      if (session) {
        const { data: userData, error: fetchError } = await supabase
          .from('user_data')
          .select('bookmarked_pages')
          .eq('user_id', session.user.id)
          .maybeSingle();

        if (fetchError) throw fetchError;

        const bookmarks = (userData?.bookmarked_pages as Record<string, number | BookmarkEntry>) || {};
        const updatedBookmarks = { 
          ...bookmarks, 
          [numericId]: {
            pageIndex: pageIndex,
            timestamp: timestamp
          }
        };

        const { error: updateError } = await supabase
          .from('user_data')
          .update({ bookmarked_pages: updatedBookmarks })
          .eq('user_id', session.user.id);

        if (updateError) throw updateError;
      } else {
        const storedBookmarks = localStorage.getItem(LOCALSTORAGE_BOOKMARKS_KEY);
        const bookmarks = storedBookmarks
          ? (JSON.parse(storedBookmarks) as Record<string, number | BookmarkEntry>)
          : {};
        const updatedBookmarks = { 
          ...bookmarks, 
          [numericId]: {
            pageIndex: pageIndex,
            timestamp: timestamp
          }
        };
        localStorage.setItem(LOCALSTORAGE_BOOKMARKS_KEY, JSON.stringify(updatedBookmarks));
      }

      setBookmarkedPageIndex(pageIndex);
      setBookmarkTimestamp(timestamp);
    } catch (error: unknown) {
      console.error('Error updating bookmark:', error);
      toast({
        variant: "destructive",
        title: "Error updating bookmark",
        description: error instanceof Error ? error.message : "Failed to update bookmark",
      });
    }
  };

  const fetchBookDetails = useCallback(async () => {
    try {
      const numericId = getNumericId(bookSlug);
      console.log('Fetching book details for ID:', numericId);

      const { data: bookData, error: bookError } = await supabase
        .from("books")
        .select("*")
        .eq("id", numericId)
        .eq("is_archived", false)
        .single();
      
      if (bookError) {
        console.error('Error fetching book:', bookError);
        throw bookError;
      }

      if (bookData && !bookSlug?.includes('-') && bookData.name) {
        const slug = `${numericId}-${bookData.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
        navigate(`/books/${slug}`, { replace: true });
      }

      console.log('Book data fetched:', bookData);
      setBook(bookData as BookRecord);
      setPageTitle(bookData.name);

      const { data: pagesData, error: pagesError } = await supabase
        .from("pages")
        .select("*")
        .eq("book_id", numericId)
        .eq("archived", false)
        .order('page_index', { ascending: true });

      if (pagesError) {
        console.error('Error fetching pages:', pagesError);
        throw pagesError;
      }

      console.log('Pages fetched:', pagesData?.length);
      setPages((pagesData || []) as BookPage[]);
    } catch (error: unknown) {
      console.error('Error in fetchBookDetails:', error);
      toast({
        variant: "destructive",
        title: "Error fetching book details",
        description: error instanceof Error ? error.message : "Failed to fetch book details",
      });
    } finally {
      setLoading(false);
    }
  }, [bookSlug, navigate, toast]);

  useEffect(() => {
    const checkAuthAndFetch = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setSession(session);
      fetchBookmarkedPage(session);
      fetchBookDetails();
    };

    checkAuthAndFetch();
  }, [numericBookId, fetchBookmarkedPage, fetchBookDetails]);

  const handlePublish = () => {
    setIsPublishingDialogOpen(true);
  };

  const handleUnpublish = () => {
    setIsPublishingDialogOpen(true);
  };

  const handlePublishingSuccess = async () => {
    // Refresh book details after publishing/unpublishing
    await fetchBookDetails();
    setPublishing(false);
  };

  const handleEditClick = () => {
    navigate(`/books/${bookSlug}/edit`);
  };

  const handleContinueReading = async () => {
    const numericId = getNumericId(bookSlug);
    if (!pages.length) return;

    const pageToNavigate = bookmarkedPageIndex !== null && bookmarkedPageIndex < pages.length
      ? pages[bookmarkedPageIndex]
      : pages[0];

    if (pageToNavigate) {
      const newIndex = bookmarkedPageIndex === null ? 0 : bookmarkedPageIndex;
      // updateBookmark now includes timestamp, which serves as last_read
      updateBookmark(newIndex);
      navigate(`/books/${numericId}/pages/${pageToNavigate.id}`);
    }
  };

  const handleContinueWriting = () => {
    const numericId = getNumericId(bookSlug);
    if (!pages.length) return;

    // Find the most recently updated page
    const lastUpdatedPage = [...pages].sort((a, b) => {
      const dateA = new Date(a.updated_at || 0).getTime();
      const dateB = new Date(b.updated_at || 0).getTime();
      return dateB - dateA;
    })[0];

    if (lastUpdatedPage) {
      navigate(`/books/${numericId}/pages/${lastUpdatedPage.id}?edit=true`);
    }
  };

  // Get the index of the last updated page
  const getLastUpdatedPageIndex = () => {
    if (!pages.length) return undefined;
    
    const lastUpdatedPage = [...pages].sort((a, b) => {
      const dateA = new Date(a.updated_at || 0).getTime();
      const dateB = new Date(b.updated_at || 0).getTime();
      return dateB - dateA;
    })[0];

    return lastUpdatedPage?.page_index;
  };

  // Determine whether to show writing or reading button
  const shouldShowWritingButton = () => {
    if (!canEdit || !pages.length) return false;

    // Find the most recent page update time
    const mostRecentPageUpdate = Math.max(
      ...pages.map(page => new Date(page.updated_at || 0).getTime())
    );

    // Get last read time from bookmarked_pages timestamp
    const lastReadTime = bookmarkTimestamp ? new Date(bookmarkTimestamp).getTime() : 0;

    // If there's no last read time, or if a page was updated more recently than the last read, show writing
    return !lastReadTime || mostRecentPageUpdate > lastReadTime;
  };

  // Prepare book metadata for chat
  const getBookMetadata = () => {
    if (!book || !pages) return null;

    const metadata = {
      name: book.name,
      author: book.author || 'Unknown',
      subtitle: book.subtitle || '',
      pageCount: pages.length,
      pages: pages.map(page => ({
        id: page.id,
        title: page.title || 'Untitled',
        pageIndex: page.page_index,
        summary: (() => {
          if (!page.content) return 'No content';
          const text = jsonToText(page.content);
          return text ? text.substring(0, 200) + (text.length > 200 ? '...' : '') : 'No content';
        })()
      }))
    };
    
    console.log('Book metadata being sent to AI:', JSON.stringify(metadata, null, 2));
    return metadata;
  };

  // Handle book operations from chat
  const handleApplyOperation = async (operation: {
    type: 'add' | 'archive' | 'move' | 'edit';
    pageId?: number;
    newIndex?: number;
    title?: string;
    content?: string;
    oldContent?: string;
    newContent?: string;
  }) => {
    if (!canEdit) {
      toast({
        variant: "destructive",
        title: "Permission denied",
        description: "You don't have permission to edit this book"
      });
      return;
    }

    const numericId = getNumericId(bookSlug);
    if (!numericId) return;

    try {
      const result = await executeBookOperation(operation, numericId, pages as any);
      
      if (result.success) {
        toast({
          title: "Operation completed",
          description: `Successfully ${operation.type}ed page`
        });
        
        // Refresh book data to reflect changes
        await fetchBookDetails();
      } else {
        toast({
          variant: "destructive",
          title: "Operation failed",
          description: result.error || "Failed to complete operation"
        });
      }
    } catch (error) {
      console.error('Error applying operation:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to apply operation"
      });
    }
  };

  // Flashcard handlers
  const handleCreateFlashcard = async (front: string, back: string) => {
    try {
      await createFlashcard({ front, back });
      setIsEditorOpen(false);
      toast({
        title: "Flashcard created",
        description: "Your flashcard has been added successfully"
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to create flashcard"
      });
    }
  };

  const handleUpdateFlashcard = async (id: number, front: string, back: string) => {
    try {
      await updateFlashcard(id, { front, back });
      setIsEditorOpen(false);
      setEditingFlashcard(null);
      toast({
        title: "Flashcard updated",
        description: "Your flashcard has been updated successfully"
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to update flashcard"
      });
    }
  };

  const handleDeleteFlashcard = async (flashcard: FlashcardRecord) => {
    try {
      await deleteFlashcard(flashcard.id);
      toast({
        title: "Flashcard deleted",
        description: "Your flashcard has been removed"
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to delete flashcard"
      });
    }
  };

  const handleGenerateFlashcards = async () => {
    try {
      await generateFlashcards();
      setIsGenerateDialogOpen(false);
      toast({
        title: "Flashcards generated",
        description: "New flashcards have been created from your book content"
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to generate flashcards"
      });
    }
  };

  const handleViewFlashcard = (flashcard: FlashcardRecord) => {
    const index = flashcards.findIndex(f => f.id === flashcard.id);
    setCurrentFlashcardIndex(index);
    setViewingFlashcard(flashcard);
    setIsModalOpen(true);
  };

  const handleEditFlashcard = (flashcard: FlashcardRecord) => {
    setEditingFlashcard(flashcard);
    setIsEditorOpen(true);
  };

  const handleStudyFlashcard = (flashcard: FlashcardRecord) => {
    handleViewFlashcard(flashcard);
  };

  const handleNavigateFlashcard = (index: number) => {
    if (index >= 0 && index < flashcards.length) {
      setCurrentFlashcardIndex(index);
      setViewingFlashcard(flashcards[index]);
    }
  };

  if (loading || !book) {
    return null;
  }

  // Construct absolute URLs for Open Graph meta tags
  const currentUrl = window.location.href;
  const coverImageUrl = book.cover_url 
    ? new URL(book.cover_url, window.location.origin).toString()
    : `${window.location.origin}/default-book-cover.png`;
  
  const bookDescription = book.subtitle || `A book by ${book.author || "Unknown author"}`;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Helmet>
        {/* Primary Meta Tags */}
        <title>{book.name} | Pensive</title>
        <meta name="title" content={`${book.name} | Pensive`} />
        <meta name="description" content={bookDescription} />
        
        {/* Open Graph / Facebook */}
        <meta property="og:type" content="book" />
        <meta property="og:url" content={currentUrl} />
        <meta property="og:title" content={`${book.name} | Pensive`} />
        <meta property="og:description" content={bookDescription} />
        <meta property="og:image" content={coverImageUrl} />
        
        {/* Twitter */}
        <meta property="twitter:card" content="summary_large_image" />
        <meta property="twitter:url" content={currentUrl} />
        <meta property="twitter:title" content={`${book.name} | Pensive`} />
        <meta property="twitter:description" content={bookDescription} />
        <meta property="twitter:image" content={coverImageUrl} />
        
        {/* Book-specific metadata */}
        {book.author && <meta property="book:author" content={book.author} />}
        {book.published_at && <meta property="book:release_date" content={book.published_at} />}
      </Helmet>
      
      <div className="container mx-auto px-6 py-10 md:px-8">
        <div className="max-w-5xl mx-auto space-y-8">
          {/* Single Column Layout */}
          <div className="space-y-8">
            {/* Book Header with Cover and Info */}
            <div className="relative">
              {/* Header Actions - Top Right */}
              {canEdit && (
                <div className="absolute top-2 right-2 sm:top-3 sm:right-3 z-10 flex items-center gap-2">
                  {isBetaEnabled && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => navigate(`/books/${bookSlug}/chat`)}
                      aria-label="Chat with Book"
                      className="pv-serif h-9 w-9 gap-0 rounded-full border-0 bg-transparent p-0 text-[13px] italic text-[hsl(var(--pv-text-muted))] hover:text-foreground sm:w-auto sm:gap-1.5 sm:border sm:border-border sm:px-3.5"
                    >
                      <MessageSquare className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
                      <span className="hidden sm:inline">Chat with Book</span>
                    </Button>
                  )}

                  <BookActionsBar
                    isPublic={book.is_public}
                    onPublish={handlePublish}
                    onUnpublish={handleUnpublish}
                    publishing={publishing}
                    onEditClick={handleEditClick}
                    url={window.location.href}
                  />
                </div>
              )}

              <BookInfo
                name={book.name}
                subtitle={book.subtitle}
                coverUrl={book.cover_url}
                bookId={getNumericId(bookSlug)}
                author={book.author}
                showTextOnCover={book.show_text_on_cover}
                currentPage={bookmarkedPageIndex ?? 0}
                totalPages={pages.length}
                onContinueReading={handleContinueReading}
                onContinueWriting={handleContinueWriting}
                lastUpdated={book.updated_at}
                canEdit={canEdit}
                lastUpdatedPageIndex={getLastUpdatedPageIndex()}
                showWritingButton={shouldShowWritingButton()}
              />
            </div>

            {/* Word Count & Version Control */}
            <div className="flex flex-col gap-3 border-t border-border pt-6 sm:flex-row sm:items-baseline sm:justify-between">
              <div className="pv-eyebrow">
                The manuscript ·{" "}
                <span className="pv-serif text-[13px] normal-case not-italic tracking-normal text-[hsl(var(--pv-text-muted))]">
                  {pages.reduce((acc, page) =>
                    acc + (page.page_type === 'text' && page.content ? getWordCountFromContent(page.content) : 0), 0).toLocaleString()} words
                </span>
              </div>

              {canEdit && (
                <VersionControlButton
                  bookId={getNumericId(bookSlug)}
                  bookSlug={bookSlug}
                  onSaveVersion={() => setIsCommitDialogOpen(true)}
                />
              )}
            </div>

            {/* Pages List - Center Stage */}
            <PagesList
              pages={pages as any}
              bookId={getNumericId(bookSlug)}
              isDeleteMode={isDeleteMode}
              canEdit={canEdit}
              onDeleteModeChange={(isDelete) => setIsDeleteMode(isDelete)}
              onChatToggle={() => setIsChatOpen(!isChatOpen)}
              hasActiveChat={isChatOpen}
            />

            {/* Integrated Flashcard Section - Only visible in beta */}
            {isBetaEnabled && (
              <IntegratedFlashcardSection
                flashcards={flashcards}
                loading={flashcardsLoading}
                onGenerate={() => setIsGenerateDialogOpen(true)}
                onEdit={handleEditFlashcard}
                onDelete={handleDeleteFlashcard}
                onStudy={handleStudyFlashcard}
                onView={handleViewFlashcard}
                isEnabled={preferences?.flashcards_enabled ?? true}
                onToggleEnabled={toggleFlashcards}
                preferencesLoading={preferencesLoading}
              />
            )}
          </div>

          {/* Chat Sidebar - Rendered as a portal */}
          <BookChatPanel
            bookId={bookSlug || ""}
            bookMetadata={getBookMetadata()!}
            canEdit={canEdit}
            isOpen={isChatOpen}
            onClose={() => setIsChatOpen(false)}
            onApplyOperation={handleApplyOperation}
          />

          {/* Flashcard Dialogs */}
          <FlashcardEditor
            flashcard={editingFlashcard as any}
            isOpen={isEditorOpen}
            onClose={() => {
              setIsEditorOpen(false);
              setEditingFlashcard(null);
            }}
            onSave={(data) => editingFlashcard
              ? handleUpdateFlashcard(editingFlashcard.id, data.front, data.back)
              : handleCreateFlashcard(data.front, data.back)
            }
          />

          <GenerateFlashcardsDialog
            isOpen={isGenerateDialogOpen}
            onClose={() => setIsGenerateDialogOpen(false)}
            onGenerate={handleGenerateFlashcards}
            generating={flashcardsGenerating}
          />

          <FlashcardModal
            flashcard={viewingFlashcard as any}
            flashcards={flashcards}
            currentIndex={currentFlashcardIndex}
            isOpen={isModalOpen}
            onClose={() => {
              setIsModalOpen(false);
              setViewingFlashcard(null);
            }}
            onNavigate={handleNavigateFlashcard}
          />

          {/* Version Control Dialog */}
          <CommitDialog
            bookId={getNumericId(bookSlug)}
            bookName={book.name}
            open={isCommitDialogOpen}
            onOpenChange={setIsCommitDialogOpen}
            onSuccess={() => undefined}
          />

          {/* Publishing Dialog */}
          <PublishingDialog
            bookId={getNumericId(bookSlug)}
            bookName={book.name}
            isPublic={book.is_public}
            open={isPublishingDialogOpen}
            onOpenChange={setIsPublishingDialogOpen}
            onSuccess={handlePublishingSuccess}
          />

        </div>
      </div>
    </div>
  );
};

export default BookDetails;
