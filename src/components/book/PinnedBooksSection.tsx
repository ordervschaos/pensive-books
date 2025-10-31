import { useNavigate } from 'react-router-dom';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card } from '@/components/ui/card';
import { Pin, PinOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

interface PinnedBook {
  id: number;
  name: string;
  subtitle?: string | null;
  cover_url?: string | null;
  show_text_on_cover?: boolean;
  updated_at: string;
  pinned?: boolean | null;
}

interface PinnedBooksSectionProps {
  pinnedBooks: PinnedBook[];
  onUnpin?: (bookId: number) => void;
}

export function PinnedBooksSection({ pinnedBooks, onUnpin }: PinnedBooksSectionProps) {
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleUnpin = async (bookId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (onUnpin) {
      onUnpin(bookId);
      return;
    }
    
    // Fallback if onUnpin not provided
    try {
      const { error } = await supabase
        .from('books')
        .update({ pinned: false })
        .eq('id', bookId);

      if (error) throw error;

      toast({
        title: 'Book unpinned',
        description: 'Book removed from pinned section',
      });
    } catch (error: any) {
      console.error('Error unpinning book:', error);
      toast({
        variant: 'destructive',
        title: 'Error unpinning book',
        description: error.message || 'Unknown error occurred',
      });
    }
  };

  if (pinnedBooks.length === 0) {
    return null; // Don't show section if no pinned books
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold flex items-center gap-2">
        <Pin className="h-5 w-5" />
        Pinned Books
      </h2>
      <ScrollArea className="w-full">
        <div className="flex gap-4 pb-4">
          {pinnedBooks.map((book) => (
            <div key={book.id} className="flex-shrink-0 relative group">
              <Card
                className="relative cursor-pointer w-48 h-64 overflow-hidden transition-transform hover:scale-105"
                onClick={() => navigate(`/book/${book.id}`)}
              >
                {book.cover_url ? (
                  <div className="relative w-full h-full">
                    <img
                      src={book.cover_url}
                      alt={book.name || 'Book cover'}
                      className="w-full h-full object-cover"
                    />
                    {book.show_text_on_cover && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 p-4">
                        <h3 className="text-sm font-semibold text-white text-center line-clamp-2">
                          {book.name}
                        </h3>
                        {book.subtitle && (
                          <p className="text-xs text-white/80 text-center line-clamp-1 mt-1">
                            {book.subtitle}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-secondary p-4">
                    <h3 className="text-sm font-semibold text-center line-clamp-2">
                      {book.name || 'Untitled'}
                    </h3>
                  </div>
                )}
                
                {/* Pin button overlay */}
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-background/80 hover:bg-background"
                  onClick={(e) => handleUnpin(book.id, e)}
                >
                  <PinOff className="h-4 w-4" />
                </Button>
              </Card>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

