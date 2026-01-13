import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { Clock } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface RecentBook {
  bookId: number;
  pageId: number;
  bookName: string;
  bookSubtitle: string | null;
  coverUrl: string | null;
  showTextOnCover: boolean;
  pageTitle: string | null;
  timestamp: string;
  wasEditing: boolean; // Track if user was editing vs just reading
}

export function RecentBooksCard() {
  const [recentBooks, setRecentBooks] = useState<RecentBook[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchRecentActivity = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

        const recentItems: RecentBook[] = [];

        // 1. Fetch recently edited pages (from pages table)
        const { data: editedPages, error: editError } = await supabase
          .from('pages')
          .select(`
            id,
            title,
            updated_at,
            book_id,
            books!inner (
              id,
              name,
              subtitle,
              cover_url,
              show_text_on_cover,
              is_archived
            )
          `)
          .eq('owner_id', session.user.id)
          .eq('archived', false)
          .eq('books.is_archived', false)
          .order('updated_at', { ascending: false })
          .limit(5); // Get top 5 edited pages

        if (editError) {
          console.error('Error fetching edited pages:', editError);
        } else if (editedPages) {
          editedPages.forEach((page: any) => {
            recentItems.push({
              bookId: page.books.id,
              pageId: page.id,
              bookName: page.books.name,
              bookSubtitle: page.books.subtitle,
              coverUrl: page.books.cover_url,
              showTextOnCover: page.books.show_text_on_cover,
              pageTitle: page.title,
              timestamp: page.updated_at,
              wasEditing: true,
            });
          });
        }

        // 2. Fetch recently read books (from user_data.bookmarked_pages)
        const { data: userData, error: userError } = await supabase
          .from('user_data')
          .select('bookmarked_pages')
          .eq('user_id', session.user.id)
          .maybeSingle();

        if (userError) {
          console.error('Error fetching user data:', userError);
        } else if (userData?.bookmarked_pages) {
          const bookmarks = userData.bookmarked_pages as Record<string, any>;

          // Process each bookmark
          for (const [bookId, bookmark] of Object.entries(bookmarks)) {
            let pageIndex: number;
            let timestamp: string;

            // Handle both old and new bookmark formats
            if (typeof bookmark === 'number') {
              pageIndex = bookmark;
              timestamp = new Date(0).toISOString();
            } else if (typeof bookmark === 'object' && bookmark.pageIndex !== undefined && bookmark.timestamp) {
              pageIndex = bookmark.pageIndex;
              timestamp = bookmark.timestamp;
            } else {
              continue;
            }

            // Fetch book details
            const { data: bookData, error: bookError } = await supabase
              .from('books')
              .select('id, name, subtitle, cover_url, show_text_on_cover')
              .eq('id', bookId)
              .eq('is_archived', false)
              .maybeSingle();

            if (bookError || !bookData) continue;

            // Fetch the specific page
            const { data: pagesData, error: pagesError } = await supabase
              .from('pages')
              .select('id, title')
              .eq('book_id', bookId)
              .eq('archived', false)
              .order('page_index', { ascending: true });

            if (pagesError || !pagesData) continue;

            const targetPage = pagesData[pageIndex];
            if (targetPage) {
              recentItems.push({
                bookId: parseInt(bookId),
                pageId: targetPage.id,
                bookName: bookData.name,
                bookSubtitle: bookData.subtitle,
                coverUrl: bookData.cover_url,
                showTextOnCover: bookData.show_text_on_cover,
                pageTitle: targetPage.title,
                timestamp: timestamp,
                wasEditing: false,
              });
            }
          }
        }

        // 3. Deduplicate by bookId (keep most recent), sort by timestamp, and take top 4
        const bookMap = new Map<number, RecentBook>();

        recentItems.forEach(item => {
          const existing = bookMap.get(item.bookId);
          if (!existing || new Date(item.timestamp) > new Date(existing.timestamp)) {
            bookMap.set(item.bookId, item);
          }
        });

        const sortedRecent = Array.from(bookMap.values())
          .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
          .slice(0, 4); // Show top 4 most recent books

        setRecentBooks(sortedRecent);
      } catch (error) {
        console.error('Error fetching recent activity:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchRecentActivity();
  }, []);

  const handleContinue = (book: RecentBook) => {
    const url = book.wasEditing
      ? `/books/${book.bookId}/pages/${book.pageId}?edit=true`
      : `/books/${book.bookId}/pages/${book.pageId}`;
    navigate(url);
  };

  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <Card
            key={i}
            className={`p-4 animate-pulse border-2 ${i > 2 ? 'hidden lg:block' : ''}`}
          >
            <div className="flex gap-3">
              <div className="w-12 h-16 bg-muted rounded-md"></div>
              <div className="flex-1 space-y-2">
                <div className="h-4 w-32 bg-muted rounded"></div>
                <div className="h-3 w-24 bg-muted rounded"></div>
              </div>
            </div>
          </Card>
        ))}
      </div>
    );
  }

  if (recentBooks.length === 0) {
    return null; // Don't show anything if no recent activity
  }

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
        Recent
      </h2>
      <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {recentBooks.map((book, index) => (
          <Card
            key={`${book.bookId}-${book.pageId}`}
            className={`p-4 hover:shadow-lg hover:border-primary/50 transition-all border-2 cursor-pointer group ${
              index >= 2 ? 'hidden lg:block' : ''
            }`}
            onClick={() => handleContinue(book)}
          >
            <div className="flex gap-3 items-start">
              {/* Book Cover */}
              <div className="w-12 h-16 flex-shrink-0">
                {book.coverUrl ? (
                  <img
                    src={book.coverUrl}
                    alt={book.bookName || 'Book cover'}
                    className="w-full h-full object-cover rounded-md shadow-sm"
                  />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-muted to-muted/50 rounded-md flex items-center justify-center border">
                    <span className="text-[9px] text-muted-foreground text-center px-1 line-clamp-2 font-medium">
                      {book.bookName || 'Book'}
                    </span>
                  </div>
                )}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold mb-1 line-clamp-1">
                  {book.bookName || 'Untitled Book'}
                </h3>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
                  <Clock className="h-3 w-3 flex-shrink-0" />
                  <span className="truncate font-medium">{book.pageTitle || 'Untitled Page'}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(book.timestamp), { addSuffix: true })}
                </p>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
