import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, ExternalLink, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface Book {
  id: number;
  name: string;
  subtitle?: string | null;
  author?: string | null;
  cover_url?: string | null;
  show_text_on_cover?: boolean;
  is_public: boolean;
  is_archived: boolean;
  created_at: string;
  owner_id?: string;
  access_level?: string;
}

export default function Index() {
  const [books, setBooks] = useState<Book[]>([]);
  const [sharedBooks, setSharedBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState<string | null>(null);
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

        // Fetch user's username
        const { data: userData } = await supabase
          .from('user_data')
          .select('username')
          .eq('user_id', session.user.id)
          .single();
        
        setUsername(userData?.username || null);

        console.log("Fetching books for user:", session.user.email);
        
        // Fetch user's own books
        const { data: ownedBooks, error: ownedError } = await supabase
          .from("books")
          .select("*")
          .eq('owner_id', session.user.id)
          .eq('is_archived', false)
          .order("updated_at", { ascending: false });

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
      } catch (error: unknown) {
        console.error("Error fetching books:", error);
        toast({
          variant: "destructive",
          title: "Error fetching books",
          description: error instanceof Error ? error.message : "An unknown error occurred",
        });
      } finally {
        setLoading(false);
      }
    };

    checkAuthAndFetchBooks();
  }, [navigate, toast]);

  const handleViewProfile = () => {
    if (!username) {
      navigate("/set-username");
      return;
    }
    window.open(`/@${username}`, '_blank');
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

  const BookGrid = ({ books, title }: { books: Book[], title: string }) => (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <h2 className="text-2xl font-semibold">{title}</h2>
        {title === "Published Books" && (
          <button 
            onClick={handleViewProfile}
            className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
          >
            View public profile <ExternalLink className="ml-1 h-3 w-3" />
          </button>
        )}
      </div>
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
                          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/30 p-4">
                            <h2 className="text-base sm:text-xl font-semibold text-slate-50 text-center mb-1 sm:mb-2 line-clamp-3 break-words">
                              {book.name}
                            </h2>
                            {book.subtitle && (
                              <p className="text-xs hidden sm:block sm:text-sm text-slate-100 text-center mb-1 sm:mb-2 line-clamp-2 break-words">
                                {book.subtitle}
                              </p>
                            )}
                            {book.author && (
                              <p className="text-xs hidden sm:block sm:text-sm text-slate-100 text-center line-clamp-1 break-words">
                                by {book.author}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="absolute inset-0 flex flex-col items-center md:justify-center bg-slate-800 p-4">
                        <h2 className="text-xs md:text-2xl font-semibold text-center text-slate-50 break-words line-clamp-3">
                          {book.name}
                        </h2>
                        {book.subtitle && (
                          <p className="text-xs hidden sm:block sm:text-sm text-slate-100 text-center mb-1 sm:mb-2 line-clamp-2 break-words">
                            {book.subtitle}
                          </p>
                        )}
                        {book.author && (
                          <p className="text-xs hidden sm:block sm:text-sm text-slate-100 text-center line-clamp-1 break-words">
                            by {book.author}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </Card>
                <div className="flex-1 sm:mt-2 space-y-1 sm:text-center text-left">
                  <h3 className="text-sm text-muted-foreground font-medium line-clamp-2 break-words cursor-pointer" onClick={() => navigate(`/book/${book.id}`)}>
                    {book.name}
                  </h3>
                  {book.subtitle && (
                    <p className="text-xs text-muted-foreground line-clamp-2 break-words sm:hidden">
                      {book.subtitle}
                    </p>
                  )}
                  {book.author && (
                    <p className="text-xs text-muted-foreground line-clamp-1 break-words sm:hidden">
                      by {book.author}
                    </p>
                  )}
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
      <div className="flex justify-end items-center mb-6 gap-2">
        <Button 
          variant="outline" 
          onClick={() => navigate("/generate-book")} 
          className="text-xs sm:text-base h-8 sm:h-10 px-2 sm:px-4"
        >
          <Wand2 className="h-3 w-3 sm:h-3.5 sm:w-3.5 mr-1 sm:mr-2" />
          Generate a book
          <Badge variant="secondary" className="ml-1 sm:ml-2 text-[10px] sm:text-xs">BETA</Badge>
        </Button>
        <Button 
          onClick={() => navigate("/book/new")} 
          className="text-xs sm:text-base h-8 sm:h-10 px-2 sm:px-4"
        >
          <Plus className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" /> 
          New book
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
