import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Lock } from "lucide-react";
import { usePublishedPageData } from "@/hooks/use-published-page-data";
import { PageLoading } from "@/components/page/PageLoading";
import { SlugService } from "@/utils/slugService";
import { BookInfo } from "@/components/book/BookInfo";
import { useUserBookPreferences } from "@/hooks/use-user-book-preferences";
import { IntegratedFlashcardSection } from "@/components/flashcard/IntegratedFlashcardSection";
import { FlashcardEditor } from "@/components/flashcard/FlashcardEditor";
import { GenerateFlashcardsDialog } from "@/components/flashcard/GenerateFlashcardsDialog";
import { FlashcardModal } from "@/components/flashcard/FlashcardModal";
import { useFlashcards, CreateFlashcardData } from "@/hooks/use-flashcards";
import { setPageTitle } from "@/utils/pageTitle";
import { Helmet } from "react-helmet-async";

const LOCALSTORAGE_BOOKMARKS_KEY = 'bookmarked_pages';

/**
 * PublishedBookDetails - Public view of a published book
 * Shows table of contents from published version only (immutable)
 */
export default function PublishedBookDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [bookmarkedPageIndex, setBookmarkedPageIndex] = useState<number | null>(null);

  // Fetch published book data
  const { book, allPages, loading, notFound } = usePublishedPageData(id, undefined);

  // Get user session for preferences
  const [session, setSession] = useState<any>(null);

  // Check beta flag
  const isBetaEnabled = localStorage.getItem('is_beta') === 'true';

  const bookId = SlugService.extractId(id);

  // User book preferences
  const {
    preferences,
    loading: preferencesLoading,
    toggleFlashcards
  } = useUserBookPreferences({
    bookId: bookId,
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
  } = useFlashcards(bookId?.toString());

  // Flashcard UI state
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isGenerateDialogOpen, setIsGenerateDialogOpen] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [viewingFlashcard, setViewingFlashcard] = useState<any>(null);
  const [currentFlashcardIndex, setCurrentFlashcardIndex] = useState(0);
  const [editingFlashcard, setEditingFlashcard] = useState<any>(null);
  const [isFlashcardSaving, setIsFlashcardSaving] = useState(false);

  const fetchBookmarkedPage = useCallback(async (session: any) => {
    try {
      if (session) {
        const { data: userData, error } = await supabase
          .from('user_data')
          .select('bookmarked_pages')
          .eq('user_id', session.user.id)
          .maybeSingle();

        if (error) throw error;

        const bookmarks = userData?.bookmarked_pages || {};
        const bookmarkData = bookmarks[bookId];
        
        // Handle both old format (just number) and new format ({ pageIndex, timestamp })
        if (typeof bookmarkData === 'number') {
          setBookmarkedPageIndex(bookmarkData);
        } else if (bookmarkData && typeof bookmarkData === 'object') {
          setBookmarkedPageIndex(bookmarkData.pageIndex ?? null);
        } else {
          setBookmarkedPageIndex(null);
        }
      } else {
        const storedBookmarks = localStorage.getItem(LOCALSTORAGE_BOOKMARKS_KEY);
        const bookmarks = storedBookmarks ? JSON.parse(storedBookmarks) : {};
        const bookmarkData = bookmarks[bookId];
        
        // Handle both old format (just number) and new format ({ pageIndex, timestamp })
        if (typeof bookmarkData === 'number') {
          setBookmarkedPageIndex(bookmarkData);
        } else if (bookmarkData && typeof bookmarkData === 'object') {
          setBookmarkedPageIndex(bookmarkData.pageIndex ?? null);
        } else {
          setBookmarkedPageIndex(null);
        }
      }
    } catch (error: any) {
      console.error('Error fetching bookmarked page:', error);
    }
  }, [bookId]);

  const updateBookmark = async (pageIndex: number | null) => {
    try {
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
          [bookId]: {
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
          [bookId]: {
            pageIndex: pageIndex,
            timestamp: timestamp
          }
        };
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

  useEffect(() => {
    const checkAuthAndFetch = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setSession(session);
      fetchBookmarkedPage(session);
    };

    checkAuthAndFetch();
  }, [fetchBookmarkedPage]);

  useEffect(() => {
    if (book) {
      setPageTitle(book.name);
    }
  }, [book]);

  const handleContinueReading = () => {
    if (!allPages.length) return;

    const pageToNavigate = bookmarkedPageIndex !== null && bookmarkedPageIndex < allPages.length
      ? allPages[bookmarkedPageIndex]
      : allPages[0];

    if (pageToNavigate) {
      const newIndex = bookmarkedPageIndex === null ? 0 : bookmarkedPageIndex;
      updateBookmark(newIndex);
      const pageSlug = SlugService.generateSlug(pageToNavigate.id, pageToNavigate.title);
      navigate(`/library/book/${id}/page/${pageSlug}`);
    }
  };

  // Flashcard handlers
  const handleSaveFlashcard = async (data: CreateFlashcardData) => {
    setIsFlashcardSaving(true);
    try {
      if (editingFlashcard) {
        await updateFlashcard(editingFlashcard.id, data);
      } else {
        await createFlashcard(data);
      }
      setIsEditorOpen(false);
      setEditingFlashcard(null);
    } catch (error) {
      // Error already handled by useFlashcards hook
    } finally {
      setIsFlashcardSaving(false);
    }
  };

  const handleDeleteFlashcard = async (flashcard: any) => {
    try {
      await deleteFlashcard(flashcard.id);
    } catch (error) {
      // Error already handled by useFlashcards hook
    }
  };

  const handleGenerateFlashcards = async () => {
    await generateFlashcards();
    setIsGenerateDialogOpen(false);
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
              <BookInfo
                name={book.name}
                subtitle={book.subtitle}
                coverUrl={book.cover_url}
                bookId={bookId}
                author={book.author}
                showTextOnCover={false}
                currentPage={bookmarkedPageIndex ?? 0}
                totalPages={allPages.length}
                onContinueReading={handleContinueReading}
                lastUpdated={book.published_at}
              />
            </div>

            {/* Word Count - Note: Published pages don't include content in list */}
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {allPages.length} {allPages.length === 1 ? 'page' : 'pages'}
              </p>
            </div>

            {/* Pages List - Custom implementation for published books */}
            <Card className="mt-6">
              <div className="p-4 border-b border-border">
                <h2 className="text-lg font-semibold">Table of Contents</h2>
              </div>
              {allPages.length === 0 ? (
                <div className="p-8 text-center">
                  <p className="text-muted-foreground">This book has no pages yet.</p>
                </div>
              ) : (
                <div className="space-y-2 p-4">
                  {allPages.map((page, index) => (
                    <div
                      key={page.id}
                      className="p-3 hover:bg-accent cursor-pointer transition-colors rounded-md border border-transparent hover:border-border"
                      onClick={() => {
                        const pageSlug = SlugService.generateSlug(page.id, page.title);
                        updateBookmark(index);
                        navigate(`/library/book/${id}/page/${pageSlug}`);
                      }}
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-medium text-muted-foreground w-8">
                          {index + 1}.
                        </span>
                        <h3 className="text-base font-medium flex-1">{page.title || "Untitled"}</h3>
                        {bookmarkedPageIndex === index && (
                          <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded">
                            Current
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Integrated Flashcard Section - Only visible in beta */}
            {isBetaEnabled && session && (
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

          {/* Flashcard Dialogs */}
          <FlashcardEditor
            flashcard={editingFlashcard}
            isOpen={isEditorOpen}
            onClose={() => {
              setIsEditorOpen(false);
              setEditingFlashcard(null);
            }}
            onSave={handleSaveFlashcard}
            loading={isFlashcardSaving}
          />

          <GenerateFlashcardsDialog
            isOpen={isGenerateDialogOpen}
            onClose={() => setIsGenerateDialogOpen(false)}
            onGenerate={handleGenerateFlashcards}
            generating={flashcardsLoading}
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
        </div>
      </div>
    </div>
  );
}
