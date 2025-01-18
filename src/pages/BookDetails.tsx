import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { TopNav } from "@/components/TopNav";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { BookHeader } from "@/components/book/BookHeader";
import { BookInfo } from "@/components/book/BookInfo";
import { PagesList } from "@/components/book/PagesList";

const BookDetails = () => {
  const { id } = useParams();
  const { toast } = useToast();
  const [book, setBook] = useState<any>(null);
  const [pages, setPages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);

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
        <div className="max-w-4xl mx-auto">
          <BookHeader 
            isPublic={book.is_public}
            onTogglePublish={togglePublish}
            publishing={publishing}
          />

          <div className="mt-8 grid grid-cols-[300px,1fr] gap-8">
            <div>
              {book.cover_url ? (
                <img 
                  src={book.cover_url} 
                  alt={book.name}
                  className="w-full aspect-[3/4] object-cover rounded-lg shadow-lg mb-4"
                />
              ) : (
                <div className="w-full aspect-[3/4] bg-muted rounded-lg shadow-lg mb-4 flex items-center justify-center">
                  <span className="text-4xl font-serif">{book.name[0]}</span>
                </div>
              )}
            </div>

            <div className="space-y-6">
              <div>
                <h1 className="text-4xl font-bold mb-2">{book.name}</h1>
                {book.owner_id && (
                  <p className="text-muted-foreground">by {book.owner_id}</p>
                )}
              </div>

              <div className="space-y-4">
                {pages.map((page) => (
                  <div 
                    key={page.id}
                    className="flex items-center justify-between py-2 border-b border-border hover:bg-accent/50 rounded px-2 transition-colors"
                  >
                    <span className="text-lg">{page.title || `Untitled Page ${page.page_index + 1}`}</span>
                    <span className="text-sm text-muted-foreground">
                      {page.html_content ? 
                        `${page.html_content.split(' ').length} words` : 
                        '0 words'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BookDetails;