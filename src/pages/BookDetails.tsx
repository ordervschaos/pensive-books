import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { BookInfo } from "@/components/book/BookInfo";
import { PagesList } from "@/components/book/PagesList";
import { useBookPermissions } from "@/hooks/use-book-permissions";
import { useUserBookPreferences } from "@/hooks/use-user-book-preferences";
import { BookActionsBar } from "@/components/book/BookActionsBar";
import { ShareBookButton } from "@/components/book/ShareBookButton";
import { ContinueReadingButton } from "@/components/book/ContinueReadingButton";
import { BookChatPanel } from "@/components/book/BookChatPanel";
import { IntegratedFlashcardSection } from "@/components/flashcard/IntegratedFlashcardSection";
import { FlashcardEditor } from "@/components/flashcard/FlashcardEditor";
import { GenerateFlashcardsDialog } from "@/components/flashcard/GenerateFlashcardsDialog";
import { FlashcardModal } from "@/components/flashcard/FlashcardModal";
import { useFlashcards } from "@/hooks/use-flashcards";
import { setPageTitle } from "@/utils/pageTitle";
import { Helmet } from "react-helmet-async";
import { executeBookOperation } from "@/lib/book-operations";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { jsonToText, getWordCountFromContent } from "@/utils/tiptapHelpers";
import { UncommittedChangesBadge } from "@/components/book/UncommittedChangesBadge";
import { CommitDialog } from "@/components/book/CommitDialog";
import { VersionHistory } from "@/components/book/VersionHistory";
import { GitCommit, History, FileText } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const LOCALSTORAGE_BOOKMARKS_KEY = 'bookmarked_pages';

const BookDetails = () => {
  const { id } = useParams();
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
  const [isChatOpen, setIsChatOpen] = useState(false);
  const { canEdit, isOwner, loading: permissionsLoading } = useBookPermissions(id);
  
  // Get user session for preferences
  const [session, setSession] = useState<any>(null);

  // Check beta flag
  const isBetaEnabled = localStorage.getItem('is_beta') === 'true';

  const getNumericId = (param: string | undefined) => {
    if (!param) return 0;
    const match = param.match(/^(\d+)/);
    return match ? parseInt(match[1]) : 0;
  };
  
  // User book preferences
  const { 
    preferences, 
    loading: preferencesLoading, 
    toggleFlashcards 
  } = useUserBookPreferences({ 
    bookId: getNumericId(id), 
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
  } = useFlashcards(getNumericId(id), session?.user?.id || '');

  // Flashcard UI state
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isGenerateDialogOpen, setIsGenerateDialogOpen] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [viewingFlashcard, setViewingFlashcard] = useState<any>(null);
  const [currentFlashcardIndex, setCurrentFlashcardIndex] = useState(0);
  const [editingFlashcard, setEditingFlashcard] = useState<any>(null);

  // Version control state
  const [isCommitDialogOpen, setIsCommitDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("pages");

  const fetchBookmarkedPage = useCallback(async (session: any) => {
    try {
      const numericId = getNumericId(id);
      if (session) {
        const { data: userData, error } = await supabase
          .from('user_data')
          .select('bookmarked_pages')
          .eq('user_id', session.user.id)
          .maybeSingle();

        if (error) throw error;
        
        const bookmarks = userData?.bookmarked_pages || {};
        setBookmarkedPageIndex(bookmarks[numericId] ?? null);
      } else {
        const storedBookmarks = localStorage.getItem(LOCALSTORAGE_BOOKMARKS_KEY);
        const bookmarks = storedBookmarks ? JSON.parse(storedBookmarks) : {};
        setBookmarkedPageIndex(bookmarks[numericId] ?? null);
      }
    } catch (error: any) {
      console.error('Error fetching bookmarked page:', error);
    }
  }, [id]);

  const updateBookmark = async (pageIndex: number | null) => {
    try {
      const numericId = getNumericId(id);
      const { data: { session } } = await supabase.auth.getSession();

      if (session) {
        const { data: userData, error: fetchError } = await supabase
          .from('user_data')
          .select('bookmarked_pages')
          .eq('user_id', session.user.id)
          .maybeSingle();

        if (fetchError) throw fetchError;

        const bookmarks = (userData?.bookmarked_pages as Record<string, number>) || {};
        const updatedBookmarks = { ...bookmarks, [numericId]: pageIndex };

        const { error: updateError } = await supabase
          .from('user_data')
          .update({ bookmarked_pages: updatedBookmarks })
          .eq('user_id', session.user.id);

        if (updateError) throw updateError;
      } else {
        const storedBookmarks = localStorage.getItem(LOCALSTORAGE_BOOKMARKS_KEY);
        const bookmarks = storedBookmarks ? JSON.parse(storedBookmarks) : {};
        const updatedBookmarks = { ...bookmarks, [numericId]: pageIndex };
        localStorage.setItem(LOCALSTORAGE_BOOKMARKS_KEY, JSON.stringify(updatedBookmarks));
      }

      setBookmarkedPageIndex(pageIndex);
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
      const numericId = getNumericId(id);
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

      if (bookData && !id?.includes('-') && bookData.name) {
        const slug = `${numericId}-${bookData.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
        navigate(`/book/${slug}`, { replace: true });
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
  }, [id, navigate, toast]);

  useEffect(() => {
    const checkAuthAndFetch = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setSession(session);
      fetchBookmarkedPage(session);
      fetchBookDetails();
    };

    checkAuthAndFetch();
  }, [id, fetchBookmarkedPage, fetchBookDetails]);

  const togglePublish = async () => {
    try {
      setPublishing(true);
      const newPublishState = !book.is_public;

      const { error } = await supabase
        .from("books")
        .update({
          is_public: newPublishState,
          published_at: newPublishState ? new Date().toISOString() : null
        })
        .eq("id", parseInt(id || "0"));

      if (error) throw error;

      setBook({
        ...book,
        is_public: newPublishState,
        published_at: newPublishState ? new Date().toISOString() : null
      });

      toast({
        title: newPublishState ? "Book Published" : "Book Unpublished",
        description: newPublishState
          ? "Your book is now available to the public"
          : "Your book is now private"
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error updating book",
        description: error.message
      });
    } finally {
      setPublishing(false);
    }
  };

  const handleEditClick = () => {
    navigate(`/book/${id}/edit`);
  };

  const handleContinueReading = () => {
    const numericId = getNumericId(id);
    if (!pages.length) return;

    const pageToNavigate = bookmarkedPageIndex !== null && bookmarkedPageIndex < pages.length
      ? pages[bookmarkedPageIndex]
      : pages[0];

    if (pageToNavigate) {
      const newIndex = bookmarkedPageIndex === null ? 0 : bookmarkedPageIndex;
      updateBookmark(newIndex);
      navigate(`/book/${numericId}/page/${pageToNavigate.id}`);
    }
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

    const numericId = getNumericId(id);
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
        <div className="max-w-7xl mx-auto space-y-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
            <div className="lg:hidden col-span-full">
              <h1
                className={`text-2xl font-bold mb-2 ${canEdit ? 'cursor-pointer hover:text-blue-600 transition-colors' : ''}`}
                onClick={canEdit ? handleEditClick : undefined}
              >
                {book.name}
              </h1>
              <p className="text-muted-foreground mb-4">{book.author || "Unknown author"}</p>
              
              <div className="flex flex-wrap gap-3">
                <ContinueReadingButton
                  onClick={handleContinueReading}
                  bookmarkedPageIndex={bookmarkedPageIndex}
                  totalPages={pages.length}
                  className="flex-1 sm:flex-none"
                />
              </div>

              {canEdit && (
                <BookActionsBar
                  isPublic={book.is_public}
                  onTogglePublish={togglePublish}
                  publishing={publishing}
                  onEditClick={handleEditClick}
                />
              )}
              
              <ShareBookButton
                isPublic={book.is_public}
                url={window.location.href}
              />
            </div>

            <div className="col-span-full lg:col-span-1">
              <BookInfo
                name={book.name}
                subtitle={book.subtitle}
                coverUrl={book.cover_url}
                bookId={parseInt(id || "0")}
                author={book.author}
                showTextOnCover={book.show_text_on_cover}
              />
              
              <div className="hidden lg:block space-y-4">
                <ContinueReadingButton
                  onClick={handleContinueReading}
                  bookmarkedPageIndex={bookmarkedPageIndex}
                  totalPages={pages.length}
                  className="w-full"
                />

                {canEdit && (
                  <BookActionsBar
                    isPublic={book.is_public}
                    onTogglePublish={togglePublish}
                    publishing={publishing}
                    onEditClick={handleEditClick}
                  />
                )}
                
                <ShareBookButton
                  isPublic={book.is_public}
                  url={window.location.href}
                />
              </div>
            </div>

            <div className="col-span-full lg:col-span-3">
              <div className="hidden lg:block mb-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <h1
                      className={`text-3xl font-bold ${canEdit ? 'cursor-pointer hover:text-blue-600 transition-colors' : ''}`}
                      onClick={canEdit ? handleEditClick : undefined}
                    >
                      {book.name}
                    </h1>
                    <p className="text-muted-foreground">{book.author || "Unknown author"}</p>
                    {/* number of words */}
                    <p className="text-muted-foreground">{pages.reduce((acc, page) =>
                      acc + (page.page_type === 'text' && page.content ? getWordCountFromContent(page.content) : 0), 0)} words</p>
                  </div>

                  {canEdit && (
                    <div className="flex flex-col gap-2">
                      <UncommittedChangesBadge bookId={parseInt(id || "0")} showCount />
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setIsCommitDialogOpen(true)}
                        className="gap-2"
                      >
                        <GitCommit className="h-4 w-4" />
                        Commit Changes
                      </Button>
                    </div>
                  )}
                </div>
              </div>


              <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList>
                  <TabsTrigger value="pages" className="gap-2">
                    <FileText className="h-4 w-4" />
                    Pages
                  </TabsTrigger>
                  {canEdit && (
                    <TabsTrigger value="versions" className="gap-2">
                      <History className="h-4 w-4" />
                      Version History
                    </TabsTrigger>
                  )}
                </TabsList>

                <TabsContent value="pages" className="mt-6">
                  <PagesList
                    pages={pages}
                    bookId={parseInt(id || "0")}
                    isReorderMode={isReorderMode}
                    isDeleteMode={isDeleteMode}
                    canEdit={canEdit}
                    onDeleteModeChange={(isDelete) => setIsDeleteMode(isDelete)}
                    onChatToggle={() => setIsChatOpen(!isChatOpen)}
                    hasActiveChat={isChatOpen}
                  />
                </TabsContent>

                {canEdit && (
                  <TabsContent value="versions" className="mt-6">
                    <VersionHistory
                      bookId={parseInt(id || "0")}
                      bookName={book.name}
                      allowRollback={isOwner}
                      onPreview={(versionId) => {
                        navigate(`/book/${id}/version/${versionId}`);
                      }}
                    />
                  </TabsContent>
                )}
              </Tabs>

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

          </div>

          {/* Chat Sidebar - Rendered as a portal */}
          <BookChatPanel
            bookId={id || ""}
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
            bookId={parseInt(id || "0")}
            bookName={book.name}
            open={isCommitDialogOpen}
            onOpenChange={setIsCommitDialogOpen}
            onSuccess={() => {
              // Optionally switch to version history tab after successful commit
              setActiveTab("versions");
            }}
          />
        </div>
      </div>
    </div>
  );
};

export default BookDetails;
