import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { PenTool, Plus, Clock, BookOpen } from 'lucide-react';
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

interface LastReadBook {
  book_id: number;
  page_id: number;
  timestamp: string;
  page_title: string | null;
  book: {
    id: number;
    name: string;
    subtitle: string | null;
    cover_url: string | null;
    show_text_on_cover: boolean;
  };
}

export function ContinueWritingCard() {
  const [lastPage, setLastPage] = useState<LastWrittenPage | null>(null);
  const [lastReadBook, setLastReadBook] = useState<LastReadBook | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    const fetchLastActivity = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

        // Fetch last written page
        const { data: lastWrittenData, error: writtenError } = await supabase
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
          .maybeSingle();

        if (writtenError && writtenError.code !== 'PGRST116') {
          console.error('Error fetching last written page:', writtenError);
        }

        if (lastWrittenData) {
          setLastPage(lastWrittenData as LastWrittenPage);
        }

        // Fetch last read book from user_data.bookmarked_pages
        const { data: userData, error: userError } = await supabase
          .from('user_data')
          .select('bookmarked_pages')
          .eq('user_id', session.user.id)
          .maybeSingle();

        if (userError) {
          console.error('Error fetching user data:', userError);
        }

        if (userData?.bookmarked_pages) {
          const bookmarks = userData.bookmarked_pages as Record<string, any>;
          
          console.log('🔍 All bookmarks:', bookmarks);
          
          // Find the most recent bookmark
          let mostRecentBookmark: { bookId: string; pageIndex: number; timestamp: string } | null = null;
          
          for (const [bookId, bookmark] of Object.entries(bookmarks)) {
            // Handle both old format (just number) and new format (object with pageIndex and timestamp)
            let pageIndex: number;
            let timestamp: string;
            
            if (typeof bookmark === 'number') {
              // Old format - convert to new format with current time
              pageIndex = bookmark;
              timestamp = new Date(0).toISOString(); // Use epoch time for old bookmarks so they're deprioritized
              console.log(`📖 Book ${bookId} (old format):`, { pageIndex, timestamp });
            } else if (typeof bookmark === 'object' && bookmark.pageIndex !== undefined && bookmark.timestamp) {
              // New format
              pageIndex = bookmark.pageIndex;
              timestamp = bookmark.timestamp;
              console.log(`📖 Book ${bookId} (new format):`, { pageIndex, timestamp });
            } else {
              console.log(`⚠️ Book ${bookId}: Invalid bookmark format`, bookmark);
              continue;
            }
            
            if (!mostRecentBookmark || new Date(timestamp) > new Date(mostRecentBookmark.timestamp)) {
              mostRecentBookmark = {
                bookId,
                pageIndex,
                timestamp,
              };
            }
          }

          console.log('✅ Most recent bookmark:', mostRecentBookmark);

          if (mostRecentBookmark) {
            // Fetch the book details and find the page by index
            const { data: bookData, error: bookError } = await supabase
              .from('books')
              .select('id, name, subtitle, cover_url, show_text_on_cover')
              .eq('id', mostRecentBookmark.bookId)
              .eq('is_archived', false)
              .maybeSingle();

            if (bookError) {
              console.error('Error fetching book:', bookError);
            }

            if (bookData) {
              // Fetch pages ordered by page_index to find the correct page
              const { data: pagesData, error: pagesError } = await supabase
                .from('pages')
                .select('id, title')
                .eq('book_id', mostRecentBookmark.bookId)
                .eq('archived', false)
                .order('page_index', { ascending: true });

              if (pagesError) {
                console.error('Error fetching pages:', pagesError);
              }

              let pageId: number | null = null;
              let pageTitle: string | null = null;

              if (pagesData && pagesData[mostRecentBookmark.pageIndex]) {
                const targetPage = pagesData[mostRecentBookmark.pageIndex];
                pageId = targetPage.id;
                pageTitle = targetPage.title;
                console.log('📄 Found page:', { pageId, pageTitle, index: mostRecentBookmark.pageIndex });
              } else {
                console.error('⚠️ Page not found at index:', mostRecentBookmark.pageIndex);
              }

              if (pageId) {
                setLastReadBook({
                  book_id: parseInt(mostRecentBookmark.bookId),
                  page_id: pageId,
                  timestamp: mostRecentBookmark.timestamp,
                  page_title: pageTitle,
                  book: bookData,
                });
              }
            }
          }
        }
      } catch (error) {
        console.error('Error fetching last activity:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchLastActivity();
  }, []);

  const handleContinueWriting = () => {
    if (!lastPage) return;
    navigate(`/book/${lastPage.book_id}/page/${lastPage.id}`);
  };

  const handleContinueReading = () => {
    if (!lastReadBook) return;
    navigate(`/book/${lastReadBook.book_id}/page/${lastReadBook.page_id}`);
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
    } catch (error: unknown) {
      console.error('Error creating page:', error);
      toast({
        variant: 'destructive',
        title: 'Error creating page',
        description: error instanceof Error ? error.message : 'Unknown error occurred',
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

  if (!lastPage && !lastReadBook) {
    return null; // Don't show anything if no activity exists
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* Continue Writing Card */}
      {lastPage && (
        <Card className="p-5 hover:shadow-md transition-shadow border-2 relative">
          <div className="absolute top-3 right-3">
            <span className="text-xs text-muted-foreground font-medium">Last edited</span>
          </div>
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
                <h3 className="text-base font-semibold mb-0.5 line-clamp-1 pr-20">
                  {lastPage.books.name || 'Untitled Book'}
                </h3>
                {lastPage.books.subtitle && (
                  <p className="text-xs text-muted-foreground mb-2 line-clamp-1">
                    {lastPage.books.subtitle}
                  </p>
                )}
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  <span className="truncate">{lastPage.title || 'Untitled Page'}</span>
                  <span className="text-muted-foreground/70">•</span>
                  <span>{formatDistanceToNow(new Date(lastPage.updated_at), { addSuffix: true })}</span>
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
      )}

      {/* Continue Reading Card */}
      {lastReadBook && (
        <Card className="p-5 hover:shadow-md transition-shadow border-2 relative">
          <div className="absolute top-3 right-3">
            <span className="text-xs text-muted-foreground font-medium">Last read</span>
          </div>
          <div className="flex gap-4 items-start">
            {/* Book Cover */}
            <div className="w-16 h-20 flex-shrink-0">
              {lastReadBook.book.cover_url ? (
                <img
                  src={lastReadBook.book.cover_url}
                  alt={lastReadBook.book.name || 'Book cover'}
                  className="w-full h-full object-cover rounded-md shadow-sm"
                />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-muted to-muted/50 rounded-md flex items-center justify-center border">
                  <span className="text-[10px] text-muted-foreground text-center px-1.5 line-clamp-2 font-medium">
                    {lastReadBook.book.name || 'Book'}
                  </span>
                </div>
              )}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0 flex flex-col justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold mb-0.5 line-clamp-1 pr-20">
                  {lastReadBook.book.name || 'Untitled Book'}
                </h3>
                {lastReadBook.book.subtitle && (
                  <p className="text-xs text-muted-foreground mb-2 line-clamp-1">
                    {lastReadBook.book.subtitle}
                  </p>
                )}
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  <span className="truncate">{lastReadBook.page_title || 'Untitled Page'}</span>
                  <span className="text-muted-foreground/70">•</span>
                  <span>{formatDistanceToNow(new Date(lastReadBook.timestamp), { addSuffix: true })}</span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2">
                <Button
                  onClick={handleContinueReading}
                  size="sm"
                  className="h-8 px-4"
                >
                  <BookOpen className="h-3.5 w-3.5 mr-1.5" />
                  Continue reading
                </Button>
              </div>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

