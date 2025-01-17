import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { TopNav } from "@/components/TopNav";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, BookOpen, Calendar, Clock, Globe, Lock } from "lucide-react";

const BookDetails = () => {
  const { id } = useParams();
  const navigate = useNavigate();
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
        .eq("id", id)
        .single();

      if (bookError) throw bookError;
      setBook(bookData);

      const { data: pagesData, error: pagesError } = await supabase
        .from("pages")
        .select("*")
        .eq("book_id", id)
        .order("page_index", { ascending: true });

      if (pagesError) throw pagesError;
      setPages(pagesData || []);
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
        .eq("id", id);

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
          <Button onClick={() => navigate("/")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Notebooks
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <TopNav />
      <div className="container mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={() => navigate("/")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Notebooks
          </Button>
          <Button
            onClick={togglePublish}
            disabled={publishing}
            variant={book.is_public ? "destructive" : "default"}
          >
            {book.is_public ? (
              <>
                <Lock className="mr-2 h-4 w-4" />
                Make Private
              </>
            ) : (
              <>
                <Globe className="mr-2 h-4 w-4" />
                Publish
              </>
            )}
          </Button>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-2xl">{book.name}</CardTitle>
              {book.is_public && (
                <span className="text-sm text-muted-foreground flex items-center">
                  <Globe className="mr-1 h-4 w-4" />
                  Public
                </span>
              )}
            </div>
            <div className="flex space-x-4 text-sm text-muted-foreground">
              <div className="flex items-center">
                <Calendar className="mr-1 h-4 w-4" />
                Created {new Date(book.created_at).toLocaleDateString()}
              </div>
              <div className="flex items-center">
                <Clock className="mr-1 h-4 w-4" />
                Last updated {new Date(book.updated_at).toLocaleDateString()}
              </div>
              {book.published_at && (
                <div className="flex items-center">
                  <Globe className="mr-1 h-4 w-4" />
                  Published {new Date(book.published_at).toLocaleDateString()}
                </div>
              )}
            </div>
          </CardHeader>
        </Card>

        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Pages</h2>
          {pages.length === 0 ? (
            <Card>
              <CardContent className="text-center py-6">
                <BookOpen className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">No pages yet</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {pages.map((page) => (
                <Card 
                  key={page.id} 
                  className="hover:shadow-md transition-shadow cursor-pointer"
                  onClick={() => navigate(`/book/${book.id}/page/${page.id}`)}
                >
                  <CardHeader>
                    <CardTitle className="text-lg">
                      Page {page.page_index + 1}
                    </CardTitle>
                    <p className="text-sm text-muted-foreground">
                      Last modified {new Date(page.updated_at).toLocaleDateString()}
                    </p>
                  </CardHeader>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BookDetails;