
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { AspectRatio } from "@/components/ui/aspect-ratio";
import { PlusCircle, Lock, Globe } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

export default function MyBooks() {
  const [books, setBooks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    const fetchBooks = async () => {
      try {
        setLoading(true);
        const { data, error } = await supabase
          .from("books")
          .select("*")
          .eq("is_archived", false)
          .order("updated_at", { ascending: false });

        if (error) throw error;
        setBooks(data || []);
      } catch (error: any) {
        console.error("Error fetching books:", error);
        toast({
          title: "Error",
          description: "Failed to load books.",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    };

    fetchBooks();
  }, [toast]);

  return (
    <div className="container max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">My Books</h1>
        <Button onClick={() => navigate("/book/new")}>
          <PlusCircle className="w-4 h-4 mr-2" />
          New Book
        </Button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {[...Array(4)].map((_, index) => (
            <Card key={index} className="overflow-hidden">
              <div>
                <Skeleton className="h-[240px]" />
              </div>
              <CardContent className="p-4">
                <Skeleton className="h-4 w-full mb-2" />
                <Skeleton className="h-3 w-2/3" />
              </CardContent>
              <CardFooter className="p-4 pt-0">
                <Skeleton className="h-9 w-full" />
              </CardFooter>
            </Card>
          ))}
        </div>
      ) : books.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground mb-4">You don't have any books yet.</p>
          <Button onClick={() => navigate("/book/new")}>
            <PlusCircle className="w-4 h-4 mr-2" />
            Create Your First Book
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {books.map((book) => (
            <Card key={book.id} className="overflow-hidden flex flex-col">
              <Link to={`/book/${book.id}`} className="flex-1">
                <AspectRatio ratio={3/4} className="bg-muted">
                  <div className="relative w-full h-full">
                    {book.cover_url ? (
                      <div className="relative w-full h-full">
                        <img
                          src={book.cover_url}
                          alt={book.name}
                          className="w-full h-full object-cover"
                        />
                        {book.show_text_on_cover && (
                          <div className="absolute inset-0 bg-black/30 flex flex-col justify-center items-center p-4">
                            <h2 className="text-white text-xl font-bold text-center">{book.name}</h2>
                            {book.author && (
                              <p className="text-white text-sm mt-1">{book.author}</p>
                            )}
                          </div>
                        )}
                        
                        {/* Photographer attribution */}
                        {book.photographer && (
                          <div className="absolute bottom-2 right-2 text-white text-xs bg-black/50 px-2 py-1 rounded">
                            Photo by{" "}
                            <a 
                              href={`https://unsplash.com/@${book.photographer_username}?utm_source=pensive&utm_medium=referral`} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="underline"
                            >
                              {book.photographer}
                            </a>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="h-full w-full flex flex-col justify-center items-center bg-slate-200 dark:bg-slate-800 p-4">
                        <span className="text-xl font-bold text-center">{book.name}</span>
                        {book.author && <span className="text-sm mt-1">{book.author}</span>}
                      </div>
                    )}
                  </div>
                </AspectRatio>
              </Link>
              <CardContent className="p-4">
                <div className="flex justify-between items-center">
                  <h3 className="font-semibold truncate">{book.name}</h3>
                  {book.is_public ? (
                    <Globe className="h-4 w-4 text-green-500" />
                  ) : (
                    <Lock className="h-4 w-4 text-gray-500" />
                  )}
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  {new Date(book.updated_at).toLocaleDateString()}
                </p>
              </CardContent>
              <CardFooter className="p-4 pt-0">
                <Button asChild variant="secondary" className="w-full">
                  <Link to={`/book/${book.id}`}>View Book</Link>
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
