import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { Clock } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { BookCoverFallback } from '@/components/book/BookCoverFallback';
import { cn } from '@/lib/utils';

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
      <div className="space-y-3">
        <div className="h-3 w-16 animate-pulse rounded bg-muted/60" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Card
              key={i}
              className={`animate-pulse border border-border/40 bg-card/40 p-3 ${i > 2 ? 'hidden lg:block' : ''}`}
            >
              <div className="flex items-start gap-3">
                <div className="h-14 w-10 flex-shrink-0 rounded-[3px] bg-muted" />
                <div className="min-w-0 flex-1">
                  <div className="h-5 w-32 rounded bg-muted" />
                  <div className="mt-1 h-4 w-28 rounded bg-muted" />
                  <div className="mt-1 h-4 w-20 rounded bg-muted/70" />
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (recentBooks.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        Pick up where you left off
      </h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-2 lg:grid-cols-4">
        {recentBooks.map((book, index) => (
          <Card
            key={`${book.bookId}-${book.pageId}`}
            className={cn(
              "group cursor-pointer border border-border/60 bg-transparent p-3 transition-colors hover:border-border hover:bg-card",
              index >= 2 && "hidden lg:block"
            )}
            onClick={() => handleContinue(book)}
          >
            <div className="flex items-start gap-3">
              <div className="h-14 w-10 flex-shrink-0 overflow-hidden rounded-[3px] shadow-sm">
                {book.coverUrl ? (
                  <img
                    src={book.coverUrl}
                    alt={book.bookName || 'Book cover'}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <BookCoverFallback
                    bookId={book.bookId}
                    title={book.bookName}
                    variant="mini"
                  />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <h3 className="line-clamp-1 font-serif text-sm font-semibold tracking-tight text-foreground">
                  {book.bookName || 'Untitled Book'}
                </h3>
                <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3 flex-shrink-0" />
                  <span className="truncate">{book.pageTitle || 'Untitled Page'}</span>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground/70">
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
