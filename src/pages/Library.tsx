import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TopNav } from "@/components/TopNav";

export default function Library() {
  const [books, setBooks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchPublishedBooks = async () => {
      try {
        const { data, error } = await supabase
          .from("books")
          .select("*")
          .eq("is_public", true)
          .eq("is_archived", false)
          .order("created_at", { ascending: false });

        if (error) throw error;
        setBooks(data || []);
      } catch (error: any) {
        console.error("Error fetching published books:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchPublishedBooks();
  }, []);

  if (loading) {
    return (
      <>
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
      </>
    );
  }

  return (
    <>
      <div className="container mx-auto p-6">        
        {books.length === 0 ? (
          <p className="text-muted-foreground">No published books found</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {books.map((book) => (
              <div key={book.id} className="flex flex-col sm:block">
                <div className="flex sm:block items-start gap-4 sm:gap-0">
                  <Card
                    className="relative cursor-pointer group overflow-hidden w-24 sm:w-full aspect-[3/4]"
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
                            <h2 className="text-base sm:text-xl font-semibold text-white text-center mb-1 sm:mb-2">
                              {book.name}
                            </h2>

                            {book.subtitle && (
                              <p className="text-xs hidden sm:block sm:text-sm text-white/90 text-center mb-1 sm:mb-2">
                                {book.subtitle}
                              </p>
                            )}
                            {book.author && (
                              <p className="text-xs hidden sm:block sm:text-sm text-white/90 text-center">
                                by {book.author}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="w-full h-full bg-muted flex items-center justify-center p-4">
                        <h2 className="text-xs md:text-2xl font-semibold text-center text-muted-foreground break-words line-clamp-3">
                          {book.name}
                        </h2>
                      </div>
                    )}
                  </Card>
                  <div className="flex-1 sm:mt-2 space-y-1 sm:text-center text-left">
                    <h3 
                      className="text-sm text-muted-foreground font-medium truncate cursor-pointer"
                      onClick={() => navigate(`/book/${book.id}`)}
                    >
                      {book.name}
                    </h3>
                    {book.subtitle && (
                      <p className="text-xs text-muted-foreground truncate sm:hidden">
                        {book.subtitle}
                      </p>
                    )}
                    {book.author && (
                      <p className="text-xs text-muted-foreground truncate sm:hidden">
                        by {book.author}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
