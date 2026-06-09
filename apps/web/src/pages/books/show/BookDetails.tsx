import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { BookInfo } from "@/components/book/BookInfo";
import { PagesList } from "./components/PagesList";
import { useBookPermissions } from "@/hooks/use-book-permissions";
import { BookActionsBar } from "./components/BookActionsBar";
import { BookChatPanel } from "./components/BookChatPanel";
import { setPageTitle } from "@/utils/pageTitle";
import { Helmet } from "react-helmet-async";
import { executeBookOperation } from "@/lib/book-operations";
import { Button } from "@/components/ui/button";
import { ArchivedPagesSection } from "./components/pageList/ArchivedPagesSection";
import { jsonToText, cumulativeWordOffsets } from "@/utils/tiptapHelpers";
import { CommitDialog } from "./components/CommitDialog";
import { PublishingDialog } from "@/components/book/PublishingDialog";
import { VersionControlButton } from "./components/VersionControlButton";
import { AdminTagPanel } from "@/components/book/AdminTagPanel";
import { AdminViewBanner } from "@/components/book/AdminViewBanner";
import { MatureContentGate } from "@/components/book/MatureContentGate";
import { Brief } from "@/lib/brief";
import { BookBriefSection } from "@/components/book/BookBriefSection";
import { type RevisionPrefill } from "@/components/book/ReviseWithAI";
import { BookJourney } from "@/components/book/BookJourney";
import { ResolutionMap } from "@/components/book/ResolutionMap";
import { BookSpine } from "@/components/book/BookSpine";
import { ThreadsSection } from "@/components/book/ThreadsSection";
import { BookBibleSection } from "@/components/book/BookBibleSection";
import { getPageStatus } from "./components/pageList/pageUtils";
import { computeCompletion } from "@/lib/brief";
import { cn } from "@/lib/utils";
import { useAdmin } from "@/hooks/use-admin";
import { useMatureContent } from "@/hooks/use-mature-content";
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
  bible?: { text: string } | null;
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
  const { canEdit, isOwner, hasAccess, viaAdmin, ownerLabel, loading: permissionsLoading } = useBookPermissions(bookSlug);

  // Owner/collaborators only in the app; everyone else reading a public book goes to the
  // public reader (which never exposes author-only objective metadata). Mirrors PageView.
  useEffect(() => {
    if (permissionsLoading || hasAccess || !bookSlug) return;
    navigate(`/library/books/${bookSlug}`, { replace: true });
  }, [permissionsLoading, hasAccess, bookSlug, navigate]);
  const { isAdmin } = useAdmin();
  const { enabled: matureEnabled, loading: matureLoading } = useMatureContent();
  const [matureUnlocked, setMatureUnlocked] = useState(false);

  // Check beta flag
  const isBetaEnabled = localStorage.getItem('is_beta') === 'true';

  const getNumericId = (param: string | undefined) => {
    if (!param) return 0;
    const match = param.match(/^(\d+)/);
    return match ? parseInt(match[1]) : 0;
  };
  
  // Extract numeric ID from slug
  const numericBookId = getNumericId(bookSlug);

  // Revise-with-AI: a prefill handed over from the editor's-read report.
  const [revisionPrefill, setRevisionPrefill] = useState<RevisionPrefill | null>(null);

  // Version control state
  const [isCommitDialogOpen, setIsCommitDialogOpen] = useState(false);
  const [isPublishingDialogOpen, setIsPublishingDialogOpen] = useState(false);
  const [showArchivedPages, setShowArchivedPages] = useState(false);
  // Manuscript leads the work; the brief and all AI tools live behind their own tabs.
  // Persisted to localStorage so the choice survives a refresh.
  const tabKey = `book-tab:${bookSlug}`;
  type WorkspaceTab = "brief" | "manuscript" | "threads" | "bible" | "ai";
  const [activeTab, setActiveTab] = useState<WorkspaceTab>(() => {
    const saved = localStorage.getItem(tabKey);
    return saved === "brief" || saved === "threads" || saved === "bible" || saved === "ai"
      ? (saved as WorkspaceTab)
      : "manuscript";
  });
  const switchTab = (tab: WorkspaceTab) => {
    setActiveTab(tab);
    localStorage.setItem(tabKey, tab);
  };

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

  // The brief gates AI planning (objectives are drawn from it). Empty brief → 0 fields filled.
  const briefSet = computeCompletion(book.brief ?? null) > 0;

  // Pages with an objective but no prose yet are "ready to write" — surfaced as a dot on the AI tab.
  const plannedCount = pages.filter((p) => getPageStatus(p as any) === "objective").length;

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
                wordCount={manuscriptWordCount}
                wordTarget={book.brief?.scope?.word_target ?? 0}
              />

            </div>

            {/* Work area — Brief / Manuscript / Threads / Bible / AI, each on its own tab */}
            {canEdit ? (
              <div className="space-y-6">
                {/* Tabs: Manuscript leads the work; Brief holds the foundation AI tools plan from */}
                <div
                  role="tablist"
                  aria-label="Book workspace"
                  className="flex flex-wrap gap-1 border-b border-[hsl(var(--pv-border-soft))]"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === "manuscript"}
                    onClick={() => switchTab("manuscript")}
                    className={cn(
                      "pv-serif -mb-px inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-3 text-[18px] transition-colors",
                      activeTab === "manuscript"
                        ? "border-foreground text-foreground"
                        : "border-transparent text-[hsl(var(--pv-text-muted))] hover:text-foreground"
                    )}
                  >
                    Manuscript
                    <span className="pv-mono rounded-full bg-[hsl(var(--pv-surface-2))] px-2 py-0.5 text-[11px] tabular-nums text-[hsl(var(--pv-text-muted))]">
                      {pages.length}
                    </span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === "brief"}
                    onClick={() => switchTab("brief")}
                    className={cn(
                      "pv-serif -mb-px inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-3 text-[18px] transition-colors",
                      activeTab === "brief"
                        ? "border-foreground text-foreground"
                        : "border-transparent text-[hsl(var(--pv-text-muted))] hover:text-foreground"
                    )}
                  >
                    Brief
                    {!briefSet && (
                      <span
                        className="h-[7px] w-[7px] rounded-full bg-[#5b6db8]"
                        title="Brief not set yet"
                        aria-label="Brief not set yet"
                      />
                    )}
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === "threads"}
                    onClick={() => switchTab("threads")}
                    className={cn(
                      "pv-serif -mb-px inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-3 text-[18px] transition-colors",
                      activeTab === "threads"
                        ? "border-foreground text-foreground"
                        : "border-transparent text-[hsl(var(--pv-text-muted))] hover:text-foreground"
                    )}
                  >
                    Threads
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === "bible"}
                    onClick={() => switchTab("bible")}
                    className={cn(
                      "pv-serif -mb-px inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-3 text-[18px] transition-colors",
                      activeTab === "bible"
                        ? "border-foreground text-foreground"
                        : "border-transparent text-[hsl(var(--pv-text-muted))] hover:text-foreground"
                    )}
                  >
                    Bible
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === "ai"}
                    onClick={() => switchTab("ai")}
                    className={cn(
                      "pv-serif -mb-px inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-3 text-[18px] transition-colors",
                      activeTab === "ai"
                        ? "border-foreground text-foreground"
                        : "border-transparent text-[hsl(var(--pv-text-muted))] hover:text-foreground"
                    )}
                  >
                    AI tools
                    {plannedCount > 0 && (
                      <span
                        className="h-[7px] w-[7px] rounded-full bg-[#5b6db8]"
                        title={`${plannedCount} ${plannedCount === 1 ? "page" : "pages"} ready to write`}
                        aria-label={`${plannedCount} pages ready to write`}
                      />
                    )}
                  </button>
                </div>

                {/* Brief tab — edit the shared context every AI tool plans from, in place */}
                {activeTab === "brief" && (
                  <BookBriefSection
                    bookId={getNumericId(bookSlug)}
                    brief={book.brief ?? null}
                    onBriefChange={(brief) => setBook((b) => (b ? { ...b, brief } : b))}
                  />
                )}

                {/* Manuscript tab — writing & page management, full width */}
                {activeTab === "manuscript" && (
                  <PagesList
                    pages={pages as any}
                    bookId={getNumericId(bookSlug)}
                    isDeleteMode={isDeleteMode}
                    canEdit={canEdit}
                    onDeleteModeChange={(isDelete) => setIsDeleteMode(isDelete)}
                    onChatToggle={() => setIsChatOpen(!isChatOpen)}
                    hasActiveChat={isChatOpen}
                    wordCount={manuscriptWordCount}
                    versionControl={
                      <VersionControlButton
                        bookId={getNumericId(bookSlug)}
                        bookSlug={bookSlug}
                        onSaveVersion={() => setIsCommitDialogOpen(true)}
                      />
                    }
                  />
                )}

                {/* Threads tab — open loops & foreshadowing, an artifact parallel to the manuscript */}
                {activeTab === "threads" && (
                  <ThreadsSection
                    bookId={getNumericId(bookSlug)}
                    manuscriptWordCount={manuscriptWordCount}
                  />
                )}

                {/* Bible tab — established canon (characters, world, style) every page must stay true to */}
                {activeTab === "bible" && (
                  <BookBibleSection
                    bookId={getNumericId(bookSlug)}
                    bible={book.bible?.text ?? null}
                    onBibleChange={(text) =>
                      setBook((b) => (b ? { ...b, bible: text ? { text } : null } : b))
                    }
                  />
                )}

                {/* AI tools tab — the whole build journey, created → brief → scaffold → write →
                    editor's read → revise → publish, as one guided staircase. */}
                {activeTab === "ai" && (
                  <div className="space-y-6">
                    {/* Resolution Map (admin preview, read-only): the multi-resolution completeness
                        chart that will become the primary build surface once its cells are interactive. */}
                    {isAdmin && <ResolutionMap bookId={getNumericId(bookSlug)} refreshKey={pages.length} onChanged={fetchBookDetails} />}
                    {isAdmin && <BookSpine bookId={getNumericId(bookSlug)} onChanged={fetchBookDetails} />}
                    <BookJourney
                    bookId={getNumericId(bookSlug)}
                    briefSet={briefSet}
                    pages={pages}
                    isPublic={book.is_public}
                    onEditBrief={() => switchTab("brief")}
                    onChanged={fetchBookDetails}
                    onPublish={handlePublish}
                    revisionPrefill={revisionPrefill}
                    onRevisePrefill={setRevisionPrefill}
                    onRevisionApplied={() => fetchBookDetails()}
                    />
                  </div>
                )}
              </div>
            ) : (
              /* Read-only owner view — manuscript only (collaborators are redirected to the reader). */
              <div className="border-t border-border pt-6">
                <PagesList
                  pages={pages as any}
                  bookId={getNumericId(bookSlug)}
                  isDeleteMode={isDeleteMode}
                  canEdit={canEdit}
                  onDeleteModeChange={(isDelete) => setIsDeleteMode(isDelete)}
                  onChatToggle={() => setIsChatOpen(!isChatOpen)}
                  hasActiveChat={isChatOpen}
                  wordCount={manuscriptWordCount}
                />
              </div>
            )}

            {/* Admin content tagging */}
            {isAdmin && (
              <AdminTagPanel
                bookId={getNumericId(bookSlug)}
                initialTags={book.content_tags ?? []}
                onTagsChange={(tags) => setBook((b) => b ? { ...b, content_tags: tags } : b)}
              />
            )}

            {/* Archived pages — subtle link at the bottom, only for editors */}
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

          {/* Chat Sidebar - Rendered as a portal */}
          <BookChatPanel
            bookId={bookSlug || ""}
            bookMetadata={getBookMetadata()!}
            canEdit={canEdit}
            isOpen={isChatOpen}
            onClose={() => setIsChatOpen(false)}
            onApplyOperation={handleApplyOperation}
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
