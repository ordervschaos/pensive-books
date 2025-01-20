import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { BookInfo } from "@/components/book/BookInfo";
import { PagesList } from "@/components/book/PagesList";

const BookDetails = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [book, setBook] = useState<any>(null);
  const [pages, setPages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [isReorderMode, setIsReorderMode] = useState(false);

  useEffect(() => {
    // Check authentication status before fetching data
    const checkAuthAndFetch = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        toast({
          variant: "destructive",
          title: "Authentication required",
          description: "Please sign in to view this book"
        });
        navigate('/');
        return;
      }
      
      fetchBookDetails();
    };

    checkAuthAndFetch();
  }, [id]);

  const fetchBookDetails = async () => {
    try {
      console.log('Fetching book details for ID:', id);
      
      // First fetch the book to verify access
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

      // Then fetch pages for the book
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
        <div className="container mx-auto p-6 space-y-6">
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
        <div className="container mx-auto p-6 text-center">
          <h1 className="text-2xl font-bold mb-4">Book not found</h1>
          <p className="text-muted-foreground">The book you're looking for doesn't exist or you don't have permission to view it.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <div className="container mx-auto p-6">
        <div className="max-w-7xl mx-auto space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            <div className="lg:col-span-1">
              <div onClick={handleEditClick} className="cursor-pointer">
                <BookInfo 
                  name={book.name}
                  isPublic={book.is_public}
                  createdAt={book.created_at}
                  updatedAt={book.updated_at}
                  publishedAt={book.published_at}
                  bookId={book.id}
                  coverUrl={book.cover_url}
                  onTogglePublish={togglePublish}
                  publishing={publishing}
                />
              </div>
            </div>

            <div className="lg:col-span-3">
              <div className="flex flex-col">
                <h1 
                  className="text-3xl font-bold cursor-pointer hover:text-blue-600 transition-colors"
                  onClick={handleEditClick}
                >
                  {book.name}
                </h1>
                <p className="text-muted-foreground">{book.author || "Unknown author"}</p>
              </div>
              <PagesList 
                pages={pages}
                bookId={parseInt(id || "0")}
                isReorderMode={isReorderMode}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BookDetails;