import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, MoreVertical, Archive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function Index() {
  const [books, setBooks] = useState<any[]>([]);
  const [sharedBooks, setSharedBooks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    const checkAuthAndFetchBooks = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        
        if (!session) {
          navigate("/auth");
          return;
        }

        console.log("Fetching books for user:", session.user.email);
        
        // Fetch user's own books
        const { data: ownedBooks, error: ownedError } = await supabase
          .from("books")
          .select("*")
          .eq('owner_id', session.user.id)
          .eq('is_archived', false)
          .order("created_at", { ascending: false });

        if (ownedError) {
          console.error("Error fetching owned books:", ownedError);
          throw ownedError;
        }

        // Updated query to get shared books - now directly querying the books table
        const { data: sharedBooksAccess, error: sharedError } = await supabase
          .from("book_access")
          .select(`
            access_level,
            books!inner (*)
          `)
          .eq('invited_email', session.user.email)
          .eq('status', 'accepted')
          .eq('books.is_archived', false);

        if (sharedError) {
          console.error("Error fetching shared books:", sharedError);
          throw sharedError;
        }

        // Transform shared books data to include access level
        const transformedSharedBooks = sharedBooksAccess
          ?.filter(item => item.books !== null)
          .map(item => ({
            ...item.books,
            access_level: item.access_level
          })) || [];

        console.log("Books fetched successfully:", {
          owned: ownedBooks?.length || 0,
          shared: transformedSharedBooks?.length || 0
        });

        setBooks(ownedBooks || []);
        setSharedBooks(transformedSharedBooks);
      } catch (error: any) {
        console.error("Error fetching books:", error);
        toast({
          variant: "destructive",
          title: "Error fetching books",
          description: error.message,
        });
      } finally {
        setLoading(false);
      }
    };

    checkAuthAndFetchBooks();
  }, [navigate, toast]);

  const handleCreateBook = () => {
    navigate("/book/new");
  };

  const handleArchiveBook = async (bookId: string) => {
    try {
      const { error } = await supabase
        .from("books")
        .update({ is_archived: true })
        .eq('id', bookId);

      if (error) throw error;

      // Update local state
      setBooks(books.filter(book => book.id !== bookId));
      setSharedBooks(sharedBooks.filter(book => book.id !== bookId));

      toast({
        title: "Book archived",
        description: "The book has been moved to archive",
      });
    } catch (error: any) {
      console.error("Error archiving book:", error);
      toast({
        variant: "destructive",
        title: "Error archiving book",
        description: error.message,
      });
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto p-6">
        <div className="animate-pulse space-y-6">
          <div className="h-8 w-48 bg-muted rounded"></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="aspect-[3/4] bg-muted rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const publishedBooks = books.filter((book) => book.is_public);
  const unpublishedBooks = books.filter((book) => !book.is_public);

  const BookGrid = ({ books, title }: { books: any[], title: string }) => (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold">{title}</h2>
      {books.length === 0 ? (
        <p className="text-muted-foreground">No books found</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {books.map((book) => (
            <div key={book.id} className="flex flex-col sm:block">
              <div className="flex sm:block items-start gap-4 sm:gap-0">
                <Card
                  className="relative cursor-pointer group overflow-hidden w-24 sm:w-full aspect-[3/4]"
                >
                  <div 
                    className="absolute top-2 right-2 z-10"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          className="h-8 w-8 p-0 hover:bg-background/80"
                        >
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => handleArchiveBook(book.id)}
                          className="text-destructive"
                        >
                          <Archive className="mr-2 h-4 w-4" />
                          Archive
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <div 
                    className="w-full h-full"
                    onClick={() => navigate(`/book/${book.id}`)}
                  >
                    {book.cover_url ? (
                      <div className="relative w-full h-full">
                        <img
                          src={book.cover_url}
                          alt={book.name}
                          className="w-full h-full object-cover transition-transform group-hover:scale-105"
                        />
                        {book.show_text_on_cover && (
                          <div className="absolute inset-0 flex flex-col items-center md:justify-center bg-black/30 p-4">
                            <h2 className="text-base sm:text-xl font-semibold text-white text-center mb-1 sm:mb-2">
                              {book.name}
                            </h2>
                            {book.subtitle && (
                              <p className="text-xs sm:text-sm text-white/90 text-center mb-1 sm:mb-2">
                                {book.subtitle}
                              </p>
                            )}
                            {book.author && (
                              <p className="text-xs sm:text-sm text-white/90 text-center">
                                by {book.author}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="absolute inset-0 flex flex-col items-center md:justify-center bg-muted p-4">
                        <h2 className="text-xs md:text-2xl font-semibold text-center text-white break-words line-clamp-3">
                          {book.name}
                        </h2>
                        {book.subtitle && (
                          <p className="text-xs sm:text-sm text-white/90 text-center mb-1 sm:mb-2">
                            {book.subtitle}
                          </p>
                        )}
                        {book.author && (
                          <p className="text-xs sm:text-sm text-white/90 text-center">
                            by {book.author}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </Card>
                <div className="flex-1 sm:mt-2 space-y-1 sm:text-center text-left">
                  <h3 className="text-sm text-muted-foreground font-medium truncate cursor-pointer" onClick={() => navigate(`/book/${book.id}`)}>
                    {book.name}
                  </h3>
                  <div className="flex gap-2 sm:justify-center justify-start">
                    {book.is_public && (
                      <Badge variant="secondary" className="text-xs">
                        Public
                      </Badge>
                    )}
                    {book.access_level && (
                      <Badge variant="outline" className="text-xs">
                        {book.access_level} access
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="container mx-auto p-6">
      <div className="flex justify-end items-center mb-6">
        <Button onClick={() => navigate("/book/new")}>
          <Plus className="mr-2 h-4 w-4" /> New book
        </Button>
      </div>

      <div className="space-y-12">
        {books.filter(book => book.is_public).length > 0 && (
          <BookGrid 
            books={books.filter(book => book.is_public)} 
            title="Published Books" 
          />
        )}
        {sharedBooks.length > 0 && (
          <BookGrid 
            books={sharedBooks} 
            title="Shared with me" 
          />
        )}
        <BookGrid 
          books={books.filter(book => !book.is_public)} 
          title={books.filter(book => book.is_public).length > 0 ? "Other Books" : "All Books"} 
        />
      </div>
    </div>
  );
}
