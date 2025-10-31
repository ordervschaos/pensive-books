import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { PenTool, Plus, Clock } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface LastWrittenPage {
  id: number;
  title: string | null;
  updated_at: string;
  book_id: number;
  books: {
    id: number;
    name: string;
    subtitle: string | null;
    cover_url: string | null;
    show_text_on_cover: boolean;
  };
}

export function ContinueWritingCard() {
  const [lastPage, setLastPage] = useState<LastWrittenPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    const fetchLastWrittenPage = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

        const { data, error } = await supabase
          .from('pages')
          .select(`
            id,
            title,
            updated_at,
            book_id,
            books (
              id,
              name,
              subtitle,
              cover_url,
              show_text_on_cover
            )
          `)
          .eq('owner_id', session.user.id)
          .eq('archived', false)
          .eq('books.is_archived', false)
          .order('updated_at', { ascending: false })
          .limit(1)
          .single();

        if (error && error.code !== 'PGRST116') { // PGRST116 is "not found"
          console.error('Error fetching last written page:', error);
          throw error;
        }

        if (data) {
          setLastPage(data as LastWrittenPage);
        }
      } catch (error) {
        console.error('Error fetching last written page:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchLastWrittenPage();
  }, []);

  const handleContinueWriting = () => {
    if (!lastPage) return;
    navigate(`/book/${lastPage.book_id}/page/${lastPage.id}`);
  };

  const handleAddNewPage = async () => {
    if (!lastPage) return;

    try {
      setCreating(true);

      // Use the RPC function to create next page
      const { data: newPage, error } = await supabase
        .rpc('create_next_page', {
          p_book_id: lastPage.book_id,
        })
        .select()
        .single();

      if (error) throw error;

      // Navigate to the new page with edit mode enabled
      navigate(`/book/${lastPage.book_id}/page/${newPage.id}?edit=true`);

      toast({
        title: 'Page created',
        description: 'Your new page has been created',
      });
    } catch (error: any) {
      console.error('Error creating page:', error);
      toast({
        variant: 'destructive',
        title: 'Error creating page',
        description: error.message || 'Unknown error occurred',
      });
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return (
      <Card className="p-5 animate-pulse border-2">
        <div className="flex gap-4">
          <div className="w-16 h-20 bg-muted rounded-md"></div>
          <div className="flex-1 space-y-2">
            <div className="h-4 w-48 bg-muted rounded"></div>
            <div className="h-3 w-32 bg-muted rounded"></div>
          </div>
        </div>
      </Card>
    );
  }

  if (!lastPage) {
    return null; // Don't show anything if no pages exist
  }

  const timeAgo = formatDistanceToNow(new Date(lastPage.updated_at), { addSuffix: true });
  const pageTitle = lastPage.title || 'Untitled Page';

  return (
    <Card className="p-5 hover:shadow-md transition-shadow border-2">
      <div className="flex gap-4 items-start">
        {/* Book Cover */}
        <div className="w-16 h-20 flex-shrink-0">
          {lastPage.books.cover_url ? (
            <img
              src={lastPage.books.cover_url}
              alt={lastPage.books.name || 'Book cover'}
              className="w-full h-full object-cover rounded-md shadow-sm"
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-muted to-muted/50 rounded-md flex items-center justify-center border">
              <span className="text-[10px] text-muted-foreground text-center px-1.5 line-clamp-2 font-medium">
                {lastPage.books.name || 'Book'}
              </span>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 flex flex-col justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold mb-0.5 line-clamp-1">
              {lastPage.books.name || 'Untitled Book'}
            </h3>
            {lastPage.books.subtitle && (
              <p className="text-xs text-muted-foreground mb-2 line-clamp-1">
                {lastPage.books.subtitle}
              </p>
            )}
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              <span className="truncate">{pageTitle}</span>
              <span className="text-muted-foreground/70">•</span>
              <span>{timeAgo}</span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <Button
              onClick={handleContinueWriting}
              size="sm"
              className="h-8 px-4"
            >
              <PenTool className="h-3.5 w-3.5 mr-1.5" />
              Continue writing
            </Button>
            <Button
              onClick={handleAddNewPage}
              disabled={creating}
              variant="outline"
              size="sm"
              className="h-8 px-3"
            >
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              {creating ? 'Creating...' : 'New page'}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

