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
  wasEditing: boolean;
}

interface PageData {
  id: number;
  title: string | null;
  updated_at: string;
  book_id: number;
  page_index: number;
  books: {
    id: number;
    name: string;
    subtitle: string | null;
    cover_url: string | null;
    show_text_on_cover: boolean;
    is_archived: boolean;
  };
}

interface BookData {
  id: number;
  name: string;
  subtitle: string | null;
  cover_url: string | null;
  show_text_on_cover: boolean;
}

interface PageLookup {
  id: number;
  title: string | null;
  book_id: number;
  page_index: number;
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

        // Run both queries in parallel
        const [editedPagesResult, userDataResult] = await Promise.all([
          // 1. Fetch recently edited pages
          supabase
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
            .limit(5),

          // 2. Fetch user bookmarks
          supabase
            .from('user_data')
            .select('bookmarked_pages')
            .eq('user_id', session.user.id)
            .maybeSingle()
        ]);

        // Process edited pages
        if (!editedPagesResult.error && editedPagesResult.data) {
          editedPagesResult.data.forEach((page: PageData) => {
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

        // Process bookmarked pages - OPTIMIZED
        if (!userDataResult.error && userDataResult.data?.bookmarked_pages) {
          const bookmarks = userDataResult.data.bookmarked_pages as Record<string, number | { pageIndex: number; timestamp: string }>;

          // Collect all book IDs and page indices
          const bookmarkEntries: Array<{ bookId: string; pageIndex: number; timestamp: string }> = [];

          for (const [bookId, bookmark] of Object.entries(bookmarks)) {
            let pageIndex: number;
            let timestamp: string;

            if (typeof bookmark === 'number') {
              pageIndex = bookmark;
              timestamp = new Date(0).toISOString();
            } else if (typeof bookmark === 'object' && bookmark.pageIndex !== undefined && bookmark.timestamp) {
              pageIndex = bookmark.pageIndex;
              timestamp = bookmark.timestamp;
            } else {
              continue;
            }

            bookmarkEntries.push({ bookId, pageIndex, timestamp });
          }

          if (bookmarkEntries.length > 0) {
            const bookIds = bookmarkEntries.map(entry => parseInt(entry.bookId));

            // Batch query: Get all books at once
            const { data: booksData, error: booksError } = await supabase
              .from('books')
              .select('id, name, subtitle, cover_url, show_text_on_cover')
              .in('id', bookIds)
              .eq('is_archived', false);

            if (!booksError && booksData) {
              // Batch query: Get all pages for these books at once
              const { data: pagesData, error: pagesError } = await supabase
                .from('pages')
                .select('id, title, book_id, page_index')
                .in('book_id', bookIds)
                .eq('archived', false)
                .order('page_index', { ascending: true });

              if (!pagesError && pagesData) {
                // Create lookup maps for O(1) access
                const bookMap = new Map(booksData.map(book => [book.id, book]));

                // Group pages by book_id for faster lookup
                const pagesByBook = new Map<number, PageLookup[]>();
                pagesData.forEach(page => {
                  if (!pagesByBook.has(page.book_id)) {
                    pagesByBook.set(page.book_id, []);
                  }
                  pagesByBook.get(page.book_id)!.push(page);
                });

                // Process each bookmark using the lookup maps
                bookmarkEntries.forEach(({ bookId, pageIndex, timestamp }) => {
                  const bookIdNum = parseInt(bookId);
                  const book = bookMap.get(bookIdNum);
                  const pages = pagesByBook.get(bookIdNum);

                  if (book && pages) {
                    const targetPage = pages[pageIndex];
                    if (targetPage) {
                      recentItems.push({
                        bookId: bookIdNum,
                        pageId: targetPage.id,
                        bookName: book.name,
                        bookSubtitle: book.subtitle,
                        coverUrl: book.cover_url,
                        showTextOnCover: book.show_text_on_cover,
                        pageTitle: targetPage.title,
                        timestamp: timestamp,
                        wasEditing: false,
                      });
                    }
                  }
                });
              }
            }
          }
        }

        // Deduplicate by bookId (keep most recent), sort by timestamp, and take top 4
        const bookMap = new Map<number, RecentBook>();

        recentItems.forEach(item => {
          const existing = bookMap.get(item.bookId);
          if (!existing || new Date(item.timestamp) > new Date(existing.timestamp)) {
            bookMap.set(item.bookId, item);
          }
        });

        const sortedRecent = Array.from(bookMap.values())
          .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
          .slice(0, 4);

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
    return null;
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
