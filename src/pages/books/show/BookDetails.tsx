import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { BookInfo } from "@/components/book/BookInfo";
import { PagesList } from "./components/PagesList";
import { useBookPermissions } from "@/hooks/use-book-permissions";
import { useUserBookPreferences } from "@/hooks/use-user-book-preferences";
import { BookActionsBar } from "./components/BookActionsBar";
import { ShareBookButton } from "./components/ShareBookButton";
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
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { jsonToText, getWordCountFromContent } from "@/utils/tiptapHelpers";
import { UncommittedChangesBadge } from "./components/UncommittedChangesBadge";
import { CommitDialog } from "./components/CommitDialog";
import { PublishingDialog } from "@/components/book/PublishingDialog";
import { BookSidebar } from "./components/BookSidebar";
import { VSCodeLayout } from "./components/VSCodeLayout";
import { VersionService } from "@/services/VersionService";
import { GitCommit, History, FileText } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const LOCALSTORAGE_BOOKMARKS_KEY = 'bookmarked_pages';

const BookDetails = () => {
  const { bookSlug } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const [book, setBook] = useState<any>(null);
  const [pages, setPages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [isReorderMode, setIsReorderMode] = useState(false);
  const [isDeleteMode, setIsDeleteMode] = useState(false);
  const [bookmarkedPageIndex, setBookmarkedPageIndex] = useState<number | null>(null);
  const [bookmarkTimestamp, setBookmarkTimestamp] = useState<string | null>(null);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const { canEdit, isOwner, loading: permissionsLoading } = useBookPermissions(bookSlug);
  
  // Get user session for preferences
  const [session, setSession] = useState<any>(null);

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
    createFlashcard,
    updateFlashcard,
    deleteFlashcard,
    generateFlashcards
  } = useFlashcards(getNumericId(bookSlug), session?.user?.id || '');

  // Flashcard UI state
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isGenerateDialogOpen, setIsGenerateDialogOpen] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [viewingFlashcard, setViewingFlashcard] = useState<any>(null);
  const [currentFlashcardIndex, setCurrentFlashcardIndex] = useState(0);
  const [editingFlashcard, setEditingFlashcard] = useState<any>(null);

  // Version control state
  const [isCommitDialogOpen, setIsCommitDialogOpen] = useState(false);
  const [isPublishingDialogOpen, setIsPublishingDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("pages");

  // Fetch latest version for version badge
  const { data: latestVersion } = useQuery({
    queryKey: ["latest-version", numericBookId],
    queryFn: () => VersionService.getLatestVersion(numericBookId),
    enabled: numericBookId > 0,
  });

  const fetchBookmarkedPage = useCallback(async (session: any) => {
    try {
      const numericId = getNumericId(bookSlug);
      if (session) {
        const { data: userData, error } = await supabase
          .from('user_data')
          .select('bookmarked_pages')
          .eq('user_id', session.user.id)
          .maybeSingle();

        if (error) throw error;
        
        const bookmarks = userData?.bookmarked_pages || {};
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
        const bookmarks = storedBookmarks ? JSON.parse(storedBookmarks) : {};
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
    } catch (error: any) {
      console.error('Error fetching bookmarked page:', error);
    }
  }, [numericBookId]);

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

        const bookmarks = (userData?.bookmarked_pages as Record<string, any>) || {};
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
        const bookmarks = storedBookmarks ? JSON.parse(storedBookmarks) : {};
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
    } catch (error: any) {
      console.error('Error updating bookmark:', error);
      toast({
        variant: "destructive",
        title: "Error updating bookmark",
        description: error.message
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
      setBook(bookData);
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
      setPages(pagesData || []);
    } catch (error: any) {
      console.error('Error in fetchBookDetails:', error);
      toast({
        variant: "destructive",
        title: "Error fetching book details",
        description: error.message
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
      const result = await executeBookOperation(operation, numericId, pages);
      
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
      await createFlashcard(front, back);
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
      await updateFlashcard(id, front, back);
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

  const handleDeleteFlashcard = async (flashcard: any) => {
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

  const handleViewFlashcard = (flashcard: any) => {
    const index = flashcards.findIndex(f => f.id === flashcard.id);
    setCurrentFlashcardIndex(index);
    setViewingFlashcard(flashcard);
    setIsModalOpen(true);
  };

  const handleEditFlashcard = (flashcard: any) => {
    setEditingFlashcard(flashcard);
    setIsEditorOpen(true);
  };

  const handleStudyFlashcard = (flashcard: any) => {
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
      
      <div className="container mx-auto px-4 py-6">
        <div className="max-w-5xl mx-auto space-y-6">
          {/* Single Column Layout */}
          <div className="space-y-6">
            {/* Book Header with Cover and Info */}
            <div className="rounded-2xl border border-border/50 bg-gradient-to-b from-card/60 to-card/30 shadow-xl backdrop-blur overflow-hidden relative">
              {/* Header Actions - Top Right */}
              {canEdit && (
                <div className="absolute top-4 right-4 sm:top-5 sm:right-5 md:top-6 md:right-6 z-10 flex items-center gap-2">
                  <ShareBookButton
                    isPublic={book.is_public}
                    url={window.location.href}
                  />

                  <BookActionsBar
                    isPublic={book.is_public}
                    onPublish={handlePublish}
                    onUnpublish={handleUnpublish}
                    publishing={publishing}
                    onEditClick={handleEditClick}
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
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {pages.reduce((acc, page) =>
                  acc + (page.page_type === 'text' && page.content ? getWordCountFromContent(page.content) : 0), 0)} words
              </p>

              {canEdit && (
                <div className="flex items-center gap-2">
                  {/* Draft Badge */}
                  <UncommittedChangesBadge
                    bookId={getNumericId(bookSlug)}
                    bookSlug={bookSlug}
                    showCount
                  />
                  
                  {/* Version Badge */}
                  {latestVersion ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => navigate(`/books/${bookSlug}/versions`)}
                      className="gap-1.5 h-7 px-2.5 text-xs font-mono"
                    >
                      <History className="h-3.5 w-3.5" />
                      v{latestVersion.version_number}
                    </Button>
                  ) : (
                    <Badge
                      variant="outline"
                      className="gap-1.5 h-7 px-2.5 text-xs bg-muted/50 text-muted-foreground border-muted-foreground/20"
                    >
                      <History className="h-3.5 w-3.5" />
                      No version
                    </Badge>
                  )}
                  
                  {/* Save Button */}
                  <Button
                    size="sm"
                    variant="default"
                    onClick={() => setIsCommitDialogOpen(true)}
                    className="gap-1.5 h-7 px-3 text-xs bg-primary hover:bg-primary/90"
                  >
                    <GitCommit className="h-3.5 w-3.5" />
                    Save this version
                  </Button>
                </div>
              )}
            </div>

            {/* Pages List - Center Stage */}
            <PagesList
              pages={pages}
              bookId={getNumericId(bookSlug)}
              isReorderMode={isReorderMode}
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
            isOpen={isEditorOpen}
            onClose={() => {
              setIsEditorOpen(false);
              setEditingFlashcard(null);
            }}
            onSubmit={editingFlashcard ? 
              (front, back) => handleUpdateFlashcard(editingFlashcard.id, front, back) :
              handleCreateFlashcard
            }
            initialFront={editingFlashcard?.front || ''}
            initialBack={editingFlashcard?.back || ''}
            title={editingFlashcard ? 'Edit Flashcard' : 'Create Flashcard'}
          />

          <GenerateFlashcardsDialog
            isOpen={isGenerateDialogOpen}
            onClose={() => setIsGenerateDialogOpen(false)}
            onGenerate={handleGenerateFlashcards}
            loading={flashcardsLoading}
          />

          <FlashcardModal
            flashcard={viewingFlashcard}
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
            onSuccess={() => {
              // Optionally switch to version history tab after successful commit
              setActiveTab("versions");
            }}
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

          {/* VSCode-style Sidebar for Changes and Versions */}
          <VSCodeLayout
            bookId={getNumericId(bookSlug)}
            bookSlug={bookSlug || ""}
            bookName={book.name}
            pages={pages}
            canEdit={canEdit}
            isOwner={isOwner}
            isReorderMode={isReorderMode}
            isDeleteMode={isDeleteMode}
            onDeleteModeChange={setIsDeleteMode}
            onChatToggle={() => setIsChatOpen(!isChatOpen)}
            hasActiveChat={isChatOpen}
          />
        </div>
      </div>
    </div>
  );
};

export default BookDetails;
