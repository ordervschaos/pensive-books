import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { BookInfo } from "@/components/book/BookInfo";
import { PagesList } from "@/components/book/PagesList";
import { useBookPermissions } from "@/hooks/use-book-permissions";
import { BookVisibilityToggle } from "@/components/book/BookVisibilityToggle";
import { Button } from "@/components/ui/button";
import { Copy, Settings } from "lucide-react";
import { setPageTitle } from "@/utils/pageTitle";

const BookDetails = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [book, setBook] = useState<any>(null);
  const [pages, setPages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [isReorderMode, setIsReorderMode] = useState(false);
  const { canEdit, isOwner, loading: permissionsLoading } = useBookPermissions(id);

  const handleCopyLink = async () => {
    const bookUrl = window.location.href;
    try {
      await navigator.clipboard.writeText(bookUrl);
      toast({
        title: "Link copied",
        description: "Book link has been copied to clipboard",
      });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Failed to copy",
        description: "Could not copy the link to clipboard",
      });
    }
  };


  useEffect(() => {
    const checkAuthAndFetch = async () => {
      const { data: { session } } = await supabase.auth.getSession();

      fetchBookDetails();
    };

    checkAuthAndFetch();
  }, [id]);

  const fetchBookDetails = async () => {
    try {
      console.log('Fetching book details for ID:', id);

      const { data: bookData, error: bookError } = await supabase
        .from("books")
        .select("*")
        .eq("id", parseInt(id || "0"))
        .single();

      if (bookError) {
        console.error('Error fetching book:', bookError);
        throw bookError;
      }

      console.log('Book data fetched:', bookData);
      setBook(bookData);
      setPageTitle(bookData.name);

      const { data: pagesData, error: pagesError } = await supabase
        .from("pages")
        .select("*")
        .eq("book_id", parseInt(id || "0"))
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

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col">
        <div className="container mx-auto px-4 py-6 space-y-6">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-[200px] w-full" />
          <Skeleton className="h-[400px] w-full" />
        </div>
      </div>
    );
  }

  if (!book) {
    return (
      <div className="min-h-screen flex flex-col">
        <div className="container mx-auto px-4 py-6 text-center">
          <h1 className="text-2xl font-bold mb-4">Book not found</h1>
          <p className="text-muted-foreground">The book you're looking for doesn't exist or you don't have permission to view it.</p>
        </div>
      </div>
    );
  }

  const BookInfoSection = () => {
    return <BookInfo
      name={book.name}
      subtitle={book.subtitle}
      coverUrl={book.cover_url}
      bookId={parseInt(id || "0")}
      author={book.author}
      showTextOnCover={book.show_text_on_cover}
    />;
  };

  const BookActions = () => {
    return canEdit && (
      <div className="flex justify-center my-4 gap-2 justify-between">
        <BookVisibilityToggle
          isPublic={book.is_public}
          onTogglePublish={togglePublish}
          publishing={publishing}
        />
        <Button onClick={handleEditClick} variant="ghost">
          <Settings className="h-4 w-4" />
        </Button>
      </div>
    );
  };

  const ShareBookLink = () => {
    return (
      <>
      {book.is_public && (
        <div className="mt-4 space-y-2">
          <p className="text-sm font-medium">Share this book</p>
          <div className="flex items-center gap-2 p-2 rounded-md bg-muted text-sm">
            <span className="truncate flex-1">
              {window.location.href}
            </span>
            <Button
              onClick={handleCopyLink}
              variant="ghost"
              size="sm"
              className="shrink-0"
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
      </>
    );
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
              {canEdit && <BookActions />}
              <ShareBookLink />
            </div>

            <div className="col-span-full lg:col-span-1">
              <BookInfoSection />
              <div className="hidden lg:block">
                {canEdit && <BookActions />}
                <ShareBookLink />
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
                canEdit={canEdit}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BookDetails;
