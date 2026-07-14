import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { BookInfo } from "@/components/book/BookInfo";
import { PagesList } from "./components/PagesList";
import { useBookPermissions } from "@/hooks/use-book-permissions";
import { BookActionsBar } from "./components/BookActionsBar";
import { setPageTitle } from "@/utils/pageTitle";
import { Helmet } from "react-helmet-async";
import { createSequel } from "@/lib/sequel";
import { Button } from "@/components/ui/button";
import { ArchivedPagesSection } from "./components/pageList/ArchivedPagesSection";
import { jsonToText, cumulativeWordOffsets } from "@/utils/tiptapHelpers";
import { CommitDialog } from "./components/CommitDialog";
import { PublishingDialog } from "@/components/book/PublishingDialog";
import { VersionControlButton } from "./components/VersionControlButton";
import { AdminViewBanner } from "@/components/book/AdminViewBanner";
import { MatureContentGate } from "@/components/book/MatureContentGate";
import { Brief } from "@/lib/brief";
import { BriefSummary } from "@/components/book/BriefSummary";
import { useMatureContent } from "@/hooks/use-mature-content";
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
  metadata?: { objective?: string } | null;
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
  content_tags?: string[] | null;
  brief?: Brief | null;
  /** Guided-build approval ledger: each step key → ISO timestamp the author approved it. */
  journey?: Partial<Record<"brief" | "spine" | "outline" | "voice" | "beats" | "draft", string>> | null;
}

const BookDetails = () => {
  const { bookSlug } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [book, setBook] = useState<BookRecord | null>(null);
  const [pages, setPages] = useState<BookPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [creatingSequel, setCreatingSequel] = useState(false);
  const [isDeleteMode, setIsDeleteMode] = useState(false);
  const [bookmarkedPageIndex, setBookmarkedPageIndex] = useState<number | null>(null);
  const [bookmarkTimestamp, setBookmarkTimestamp] = useState<string | null>(null);
  const { canEdit, isOwner, hasAccess, viaAdmin, ownerLabel, loading: permissionsLoading } = useBookPermissions(bookSlug);

  // Owner/collaborators only in the app; everyone else reading a public book goes to the
  // public reader (which never exposes author-only objective metadata). Mirrors PageView.
  useEffect(() => {
    if (permissionsLoading || hasAccess || !bookSlug) return;
    navigate(`/library/books/${bookSlug}`, { replace: true });
  }, [permissionsLoading, hasAccess, bookSlug, navigate]);
  const { enabled: matureEnabled, loading: matureLoading } = useMatureContent();
  const [matureUnlocked, setMatureUnlocked] = useState(false);


  const getNumericId = (param: string | undefined) => {
    if (!param) return 0;
    const match = param.match(/^(\d+)/);
    return match ? parseInt(match[1]) : 0;
  };
  
  // Extract numeric ID from slug
  const numericBookId = getNumericId(bookSlug);

  // Version control state
  const [isCommitDialogOpen, setIsCommitDialogOpen] = useState(false);
  const [isPublishingDialogOpen, setIsPublishingDialogOpen] = useState(false);
  const [showArchivedPages, setShowArchivedPages] = useState(false);
  // Manuscript leads the work; the Studio (AI build surface) is its own full-screen route
  // (/books/:slug/dna), reached via the "Studio" button. The brief is summarized in the header and
  // edited in a dialog — it no longer has a tab here.

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
        // Preserve any query string across the canonical-slug redirect.
        navigate(`/books/${slug}${window.location.search}`, { replace: true });
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
      fetchBookmarkedPage(session);
      fetchBookDetails();
    };

    checkAuthAndFetch();
  }, [numericBookId, fetchBookmarkedPage, fetchBookDetails]);

  // Keep book + pages live. Standard: the rendered UI is a projection of server state, so a refresh
  // is a no-op. A background AI run (a revise build rewriting pages, a generation advancing the
  // journey) mutates `books`/`pages` server-side; without this the host's one-time snapshot goes
  // stale and only a full reload corrects it. We refetch (debounced, so a build's burst of page
  // writes coalesces into one read) rather than patch-in-place, to stay simple and exact.
  useEffect(() => {
    if (!numericBookId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refetchSoon = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { void fetchBookDetails(); }, 500);
    };
    const channel = supabase
      .channel(`book_details_${numericBookId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "pages", filter: `book_id=eq.${numericBookId}` }, refetchSoon)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "books", filter: `id=eq.${numericBookId}` }, refetchSoon)
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [numericBookId, fetchBookDetails]);

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

  // Continue the story in a new book: canon (final state, cast, open threads, voice) carries over
  // and constrains the sequel's generation. See docs/pinned_method.md §8.
  const handleContinueAsSequel = async () => {
    if (creatingSequel) return;
    try {
      setCreatingSequel(true);
      const sequelId = await createSequel(numericBookId);
      toast({
        title: "Sequel created",
        description: "Canon carried over — the world, cast, and open threads of this book now constrain the new one.",
      });
      navigate(`/books/${sequelId}`);
    } catch (error: unknown) {
      toast({
        variant: "destructive",
        title: "Could not create the sequel",
        description: error instanceof Error ? error.message : "An unknown error occurred",
      });
    } finally {
      setCreatingSequel(false);
    }
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


  // Also covers the brief moment before a non-collaborator is redirected to the reader.
  if (loading || permissionsLoading || !hasAccess || !book) {
    return null;
  }

  const isMature = Boolean(book.content_tags?.includes('mature'));
  const needsGate =
    isMature &&
    !isOwner &&
    !matureEnabled &&
    !matureUnlocked &&
    !matureLoading;

  if (needsGate) {
    return <MatureContentGate onUnlock={() => setMatureUnlocked(true)} />;
  }

  // Construct absolute URLs for Open Graph meta tags
  const currentUrl = window.location.href;
  const coverImageUrl = book.cover_url 
    ? new URL(book.cover_url, window.location.origin).toString()
    : `${window.location.origin}/default-book-cover.png`;
  
  const bookDescription = book.subtitle || `A book by ${book.author || "Unknown author"}`;

  const manuscriptWordCount = cumulativeWordOffsets(pages).total;

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
        <div className="max-w-[1200px] mx-auto space-y-8">
          {viaAdmin && <AdminViewBanner ownerLabel={ownerLabel} />}
          {/* Two-column workspace: manuscript leads, planning in a right rail */}
          <div className="space-y-8">
            {/* Book Header with Cover and Info */}
            <div className="relative">
              {/* Header Actions - Top Right */}
              {canEdit && (
                <div className="absolute top-2 right-2 sm:top-3 sm:right-3 z-10 flex items-center gap-2">
                  <BookActionsBar
                    isPublic={book.is_public}
                    onPublish={handlePublish}
                    onUnpublish={handleUnpublish}
                    publishing={publishing}
                    onEditClick={handleEditClick}
                    onContinueAsSequel={handleContinueAsSequel}
                    creatingSequel={creatingSequel}
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
                wordCount={manuscriptWordCount}
                wordTarget={book.brief?.scope?.word_target ?? 0}
                briefSlot={
                  canEdit ? (
                    <BriefSummary
                      bookId={getNumericId(bookSlug)}
                      brief={book.brief ?? null}
                      onBriefChange={(brief) => setBook((b) => (b ? { ...b, brief } : b))}
                    />
                  ) : undefined
                }
                onOpenStudio={canEdit ? () => navigate(`/books/${bookSlug}/dna`) : undefined}
                onTitleChange={(name) => setBook((b) => (b ? { ...b, name } : b))}
              />

            </div>

            {/* Manuscript — the page list leads the book page; the AI build Studio is its own
                full-screen route, reached via the "Studio" button in the header. */}
            <div className={canEdit ? "space-y-6" : "border-t border-border pt-6"}>
              <PagesList
                pages={pages as any}
                bookId={getNumericId(bookSlug)}
                isDeleteMode={isDeleteMode}
                canEdit={canEdit}
                onDeleteModeChange={(isDelete) => setIsDeleteMode(isDelete)}
                wordCount={manuscriptWordCount}
                versionControl={
                  canEdit ? (
                    <VersionControlButton
                      bookId={getNumericId(bookSlug)}
                      bookSlug={bookSlug}
                      onSaveVersion={() => setIsCommitDialogOpen(true)}
                    />
                  ) : undefined
                }
              />
              {/* Archived pages — only relevant in the manuscript context */}
              {canEdit && (
                <div className="mt-8 pb-2">
                  {!showArchivedPages ? (
                    <button
                      type="button"
                      onClick={() => setShowArchivedPages(true)}
                      className="pv-serif text-[12px] italic text-[hsl(var(--pv-text-faint))] underline-offset-2 hover:text-[hsl(var(--pv-text-muted))] hover:underline transition-colors"
                    >
                      View archived pages
                    </button>
                  ) : (
                    <div className="overflow-hidden rounded-2xl border border-border bg-[hsl(var(--pv-surface-2))]/40">
                      <div className="flex items-center justify-between border-b border-[hsl(var(--pv-border-soft))] px-5 py-2.5">
                        <span className="pv-mono text-[10.5px] uppercase tracking-[0.18em] text-[hsl(var(--pv-text-muted))]">
                          Archived pages
                        </span>
                        <button
                          type="button"
                          onClick={() => setShowArchivedPages(false)}
                          className="pv-serif text-[12px] italic text-[hsl(var(--pv-text-faint))] hover:text-[hsl(var(--pv-text-muted))] transition-colors"
                        >
                          Hide
                        </button>
                      </div>
                      <ArchivedPagesSection
                        bookId={getNumericId(bookSlug)}
                        onRestore={fetchBookDetails}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>

          </div>

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
