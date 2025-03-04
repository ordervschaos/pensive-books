import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { BookInfo } from "@/components/book/BookInfo";
import { PagesList } from "@/components/book/PagesList";
import { useBookPermissions } from "@/hooks/use-book-permissions";
import { BookActionsBar } from "@/components/book/BookActionsBar";
import { ShareBookButton } from "@/components/book/ShareBookButton";
import { ContinueReadingButton } from "@/components/book/ContinueReadingButton";
import { setPageTitle } from "@/utils/pageTitle";

const LOCALSTORAGE_BOOKMARKS_KEY = 'bookmarked_pages';

const BookDetails = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [book, setBook] = useState<any>(null);
  const [pages, setPages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [isReorderMode, setIsReorderMode] = useState(false);
  const [isDeleteMode, setIsDeleteMode] = useState(false);
  const [bookmarkedPageIndex, setBookmarkedPageIndex] = useState<number | null>(null);
  const { canEdit, isOwner, loading: permissionsLoading } = useBookPermissions(id);

  const getNumericId = (param: string | undefined) => {
    if (!param) return 0;
    const match = param.match(/^(\d+)/);
    return match ? parseInt(match[1]) : 0;
  };

  const fetchBookmarkedPage = async (session: any) => {
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
  };

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

  useEffect(() => {
    const checkAuthAndFetch = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      fetchBookmarkedPage(session);
      fetchBookDetails();
    };

    checkAuthAndFetch();
  }, [id]);

  const fetchBookDetails = async () => {
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
  };

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

  if (loading || !book) {
    return null;
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <div className="container mx-auto px-4 py-6">
        <div className="max-w-7xl mx-auto space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
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
                <h1
                  className={`text-3xl font-bold ${canEdit ? 'cursor-pointer hover:text-blue-600 transition-colors' : ''}`}
                  onClick={canEdit ? handleEditClick : undefined}
                >
                  {book.name}
                </h1>
                <p className="text-muted-foreground">{book.author || "Unknown author"}</p>
              </div>

              <PagesList
                pages={pages}
                bookId={parseInt(id || "0")}
                isReorderMode={isReorderMode}
                isDeleteMode={isDeleteMode}
                canEdit={canEdit}
                onDeleteModeChange={(isDelete) => setIsDeleteMode(isDelete)}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BookDetails;
