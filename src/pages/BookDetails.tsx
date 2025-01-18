import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { TopNav } from "@/components/TopNav";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { BookInfo } from "@/components/book/BookInfo";
import { PagesList } from "@/components/book/PagesList";

const BookDetails = () => {
  const { id } = useParams();
  const { toast } = useToast();
  const [book, setBook] = useState<any>(null);
  const [pages, setPages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [isReorderMode, setIsReorderMode] = useState(false);

  useEffect(() => {
    fetchBookDetails();
  }, [id]);

  const fetchBookDetails = async () => {
    try {
      const { data: bookData, error: bookError } = await supabase
        .from("books")
        .select("*")
        .eq("id", parseInt(id || "0"))
        .single();

      if (bookError) throw bookError;
      setBook(bookData);

      const { data: pagesData, error: pagesError } = await supabase
        .from("pages")
        .select("*")
        .eq("book_id", parseInt(id || "0"));

      if (pagesError) throw pagesError;
      
      const sortedPages = (pagesData || []).sort((a, b) => a.page_index - b.page_index);
      setPages(sortedPages);
    } catch (error: any) {
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

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col">
        <TopNav />
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
        <TopNav />
        <div className="container mx-auto p-6 text-center">
          <h1 className="text-2xl font-bold mb-4">Book not found</h1>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <TopNav />
      <div className="container mx-auto p-6">
        <div className="max-w-7xl mx-auto space-y-6">
          <div className="flex flex-col">
            <h1 className="text-3xl font-bold">{book.name}</h1>
            <p className="text-muted-foreground">37signals</p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            <div className="lg:col-span-1">
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

            <div className="lg:col-span-3">
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
