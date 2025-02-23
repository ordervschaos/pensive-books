import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useNavigate } from "react-router-dom";

interface Book {
  id: number;
  name: string;
  subtitle?: string | null;
  author?: string | null;
  cover_url?: string | null;
  show_text_on_cover?: boolean;
  is_public?: boolean;
  access_level?: string;
}

interface BookGridProps {
  books: Book[];
  title?: string;
  showBadges?: boolean;
}

export const BookGrid = ({ books, title, showBadges = false }: BookGridProps) => {
  const navigate = useNavigate();

  return (
    <div className="space-y-6">
      {title && (
        <div className="flex items-center gap-2">
          <h2 className="text-2xl font-semibold">{title}</h2>
        </div>
      )}
      {books.length === 0 ? (
        <p className="text-muted-foreground">No books found</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {books.map((book) => (
            <div key={book.id} className="flex flex-col sm:block">
              <div className="flex sm:block items-start gap-4 sm:gap-0">
                <Card
                  className="relative cursor-pointer group overflow-hidden w-24 sm:w-full aspect-[3/4]"
                  onClick={() => navigate(`/book/${book.id}`)}
                >
                  <div className="w-full h-full">
                    {book.cover_url ? (
                      <div className="relative w-full h-full">
                        <img
                          src={book.cover_url}
                          alt={book.name}
                          className="w-full h-full object-cover transition-transform group-hover:scale-105"
                        />
                        {book.show_text_on_cover && (
                          <div className="absolute inset-0  flex-col items-center justify-center bg-black/30 p-4">
                            <h2 className="text-base sm:text-xl font-semibold text-white text-center mb-1 sm:mb-2">
                              {book.name}
                            </h2>
                            <div className="hidden sm:flex flex-col">
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
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="absolute inset-0 flex flex-col items-center justify-center bg-muted p-4">
                        <h2 className="text-xs md:text-2xl font-semibold text-center text-white break-words line-clamp-3">
                          {book.name}
                        </h2>
                        {book.subtitle && (
                          <p className="hidden sm:block text-xs sm:text-sm text-white/90 text-center mb-1 sm:mb-2">
                            {book.subtitle}
                          </p>
                        )}
                        {book.author && (
                          <p className="hidden sm:block text-xs sm:text-sm text-white/90 text-center">
                            by {book.author}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
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
                  {showBadges && (
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
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}; 