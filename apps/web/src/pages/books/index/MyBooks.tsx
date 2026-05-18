import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Wand2, Search, X, Pin, MoreHorizontal, BookOpen, Globe2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { RecentBooksCard } from "./components/RecentBooksCard";
import { useBookFilters, FilterType, SortType } from "@/hooks/use-book-filters";
import { formatDistanceToNow } from "date-fns";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { BookCard, BOOK_GRID_CLASS } from "@pensive/shared/ui/book-card";

interface Book {
  id: number;
  name: string;
  subtitle?: string | null;
  author?: string | null;
  cover_url?: string | null;
  show_text_on_cover?: boolean;
  is_public: boolean;
  is_archived: boolean;
  pinned?: boolean | null;
  created_at: string;
  updated_at: string;
  owner_id?: string;
  access_level?: string;
  page_count?: number;
}

export default function Index() {
  const [books, setBooks] = useState<Book[]>([]);
  const [sharedBooks, setSharedBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const navigate = useNavigate();

  const {
    searchQuery,
    setSearchQuery,
    activeFilter,
    setActiveFilter,
    sortType,
    setSortType,
    filteredAndSortedBooks,
    filterCounts,
    clearSearch,
  } = useBookFilters(books, sharedBooks);

  useEffect(() => {
    const checkAuthAndFetchBooks = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();

        if (!session) {
          navigate("/auth");
          return;
        }

        console.log("Fetching books for user:", session.user.email);

        // STAGE 1: Fetch basic book info FAST (without page counts)
        const [ownedBooksResult, sharedBooksResult] = await Promise.all([
          supabase
            .from("books")
            .select("*")
            .eq('owner_id', session.user.id)
            .eq('is_archived', false)
            .order("updated_at", { ascending: false }),

          supabase
            .from("book_access")
            .select(`
              access_level,
              books!inner (*)
            `)
            .eq('invited_email', session.user.email)
            .eq('status', 'accepted')
            .eq('books.is_archived', false)
        ]);

        if (ownedBooksResult.error) {
          console.error("Error fetching owned books:", ownedBooksResult.error);
          throw ownedBooksResult.error;
        }

        if (sharedBooksResult.error) {
          console.error("Error fetching shared books:", sharedBooksResult.error);
          throw sharedBooksResult.error;
        }

        const ownedBooks = ownedBooksResult.data || [];
        const transformedSharedBooks = sharedBooksResult.data
          ?.filter(item => item.books !== null)
          .map(item => ({
            ...item.books,
            access_level: item.access_level
          })) as unknown as Book[] || [];

        console.log("Basic books fetched successfully:", {
          owned: ownedBooks.length,
          shared: transformedSharedBooks.length
        });

        setBooks(ownedBooks.map(book => ({ ...book, page_count: 0 })) as Book[]);
        setSharedBooks(transformedSharedBooks.map(book => ({ ...book, page_count: 0 })));
        setLoading(false);

        const allBookIds = [...ownedBooks.map(b => b.id), ...transformedSharedBooks.map(b => b.id)];

        if (allBookIds.length > 0) {
          const { data: pageCounts, error: pageCountError } = await supabase
            .from('pages')
            .select('book_id')
            .in('book_id', allBookIds)
            .eq('archived', false);

          if (!pageCountError && pageCounts) {
            const pageCountsMap = new Map<number, number>();
            pageCounts.forEach(page => {
              const count = pageCountsMap.get(page.book_id) || 0;
              pageCountsMap.set(page.book_id, count + 1);
            });

            setBooks(prev => prev.map(book => ({
              ...book,
              page_count: pageCountsMap.get(book.id) || 0
            })));

            setSharedBooks(prev => prev.map(book => ({
              ...book,
              page_count: pageCountsMap.get(book.id) || 0
            })));
          }
        }
      } catch (error: unknown) {
        console.error("Error fetching books:", error);
        toast({
          variant: "destructive",
          title: "Error fetching books",
          description: error instanceof Error ? error.message : "An unknown error occurred",
        });
        setLoading(false);
      }
    };

    checkAuthAndFetchBooks();
  }, [navigate, toast]);

  const handlePinToggle = async (bookId: number, currentlyPinned: boolean, e: React.MouseEvent) => {
    e.stopPropagation();

    try {
      const { error } = await supabase
        .from('books')
        .update({ pinned: !currentlyPinned })
        .eq('id', bookId);

      if (error) throw error;

      setBooks(prev => prev.map(book =>
        book.id === bookId ? { ...book, pinned: !currentlyPinned } : book
      ));

      toast({
        title: currentlyPinned ? 'Book unpinned' : 'Book pinned',
        description: currentlyPinned
          ? 'Book removed from pinned section'
          : 'Book added to pinned section',
      });
    } catch (error: unknown) {
      console.error('Error toggling pin:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error instanceof Error ? error.message : 'Unknown error occurred',
      });
    }
  };

  const filterOptions: { value: FilterType; label: string; count?: number }[] = [
    { value: 'all', label: 'All', count: loading ? undefined : filterCounts.all },
    { value: 'published', label: 'Published', count: loading ? undefined : filterCounts.published },
    { value: 'private', label: 'Private', count: loading ? undefined : filterCounts.private },
    { value: 'pinned', label: 'Pinned', count: loading ? undefined : filterCounts.pinned },
  ];

  const sortOptions: { value: SortType; label: string }[] = [
    { value: 'recently-updated', label: 'Recently updated' },
    { value: 'recently-created', label: 'Recently created' },
    { value: 'alphabetical-az', label: 'Alphabetical (A-Z)' },
    { value: 'alphabetical-za', label: 'Alphabetical (Z-A)' },
    { value: 'most-pages', label: 'Most pages' },
  ];

  const totalBooks = filterCounts.all;
  const publishedCount = filterCounts.published;
  const privateCount = filterCounts.private;

  const todayLabel = new Intl.DateTimeFormat("en", {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date());

  return (
    <div className="relative">
      {loading && (
        <div className="fixed top-0 left-0 right-0 z-50">
          <div className="h-1 bg-primary/20">
            <div className="h-full bg-primary animate-pulse" style={{ width: '80%' }}></div>
          </div>
        </div>
      )}
      <div className="container relative mx-auto max-w-7xl px-6 py-14 space-y-14 md:px-12">
        {/* Masthead — "your desk" */}
        <header className="flex flex-col items-start justify-between gap-8 md:flex-row md:items-end">
          <div>
            <div className="pv-eyebrow">
              The desk · {todayLabel} · private to you
            </div>
            <h1 className="pv-display mt-3 text-[44px] font-normal italic leading-[1.0] tracking-tight text-foreground md:text-[60px]">
              Your desk.
            </h1>
            <p className="pv-serif mt-3.5 max-w-[520px] text-[17px] italic leading-snug text-[hsl(var(--pv-text-muted))]">
              Manuscripts in progress, drafts to return to, and the few you&apos;ve sent off to the Library.
            </p>
          </div>
          <div className="flex flex-row gap-7 md:gap-8">
            {[
              { n: totalBooks, l: "books at the desk" },
              { n: privateCount, l: "private drafts" },
              { n: publishedCount, l: "in the Library" },
            ].map((s) => (
              <div key={s.l} className="text-left md:text-right">
                <div
                  className="pv-display text-[28px] leading-none text-foreground"
                  style={{ fontVariantNumeric: "oldstyle-nums" }}
                >
                  {loading ? "—" : s.n}
                </div>
                <div className="pv-mono mt-1.5 text-[10.5px] uppercase tracking-[0.15em] text-[hsl(var(--pv-text-faint))]">
                  {s.l}
                </div>
              </div>
            ))}
          </div>
        </header>

        {/* Recent Books — top priority */}
        <RecentBooksCard />

        {/* Toolbar */}
        <div className="space-y-5">
          <div className="flex items-baseline justify-between gap-4">
            <div className="pv-display text-[26px] italic tracking-tight text-foreground md:text-[30px]">
              Your manuscripts
            </div>
            <span className="pv-mono text-[11px] uppercase tracking-[0.15em] text-[hsl(var(--pv-text-faint))]">
              {loading ? "" : `${totalBooks} ${totalBooks === 1 ? "book" : "books"}`}
            </span>
          </div>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            {/* Search */}
            <div className="relative min-w-0 flex-1 lg:max-w-md">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search books..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-10 rounded-md border-border/70 bg-transparent pl-10 pr-10 text-sm transition-colors focus-visible:border-border focus-visible:ring-1 focus-visible:ring-ring/40"
              />
              {searchQuery && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2 rounded-full"
                  onClick={clearSearch}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>

            {/* Sort + Actions */}
            <div className="flex flex-shrink-0 items-center gap-2">
              <Select value={sortType} onValueChange={(value) => setSortType(value as SortType)}>
                <SelectTrigger className="h-10 w-full rounded-md border-border/70 bg-transparent px-3 text-sm sm:w-[200px]">
                  <SelectValue placeholder="Sort by" />
                </SelectTrigger>
                <SelectContent>
                  {sortOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-10 w-10 rounded-md border-border/70 bg-transparent"
                    aria-label="More options"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem
                    onClick={() => navigate("/generate-book")}
                    className="flex items-center gap-2"
                  >
                    <Wand2 className="h-4 w-4" />
                    <span>Generate book</span>
                    <span className="ml-auto rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                      Beta
                    </span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <Button
                onClick={() => navigate("/books/new")}
                size="sm"
                className="pv-serif h-10 rounded-full bg-foreground px-5 text-[14px] font-normal tracking-[0.01em] text-background hover:opacity-90"
              >
                <Plus className="mr-1.5 h-4 w-4" />
                Start a new book
              </Button>
            </div>
          </div>

          {/* Filter pills — filled pill on active, constant width across states */}
          <nav className="flex flex-wrap items-center gap-2">
            {filterOptions.map((filter) => {
              const isActive = activeFilter === filter.value;
              return (
                <button
                  key={filter.value}
                  onClick={() => setActiveFilter(filter.value)}
                  className={cn(
                    "pv-serif inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[14px] transition-colors",
                    isActive
                      ? "border-foreground bg-foreground text-background"
                      : "border-border bg-transparent text-[hsl(var(--pv-text-muted))] hover:border-foreground/40 hover:text-foreground"
                  )}
                >
                  <span>{filter.label}</span>
                  <span
                    className={cn(
                      "pv-mono text-[11px] tabular-nums",
                      isActive ? "text-background/70" : "text-[hsl(var(--pv-text-faint))]",
                      filter.count === undefined && "opacity-0",
                    )}
                  >
                    {filter.count ?? 0}
                  </span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Unified Book Grid */}
        <div className="space-y-6">
          {loading ? (
            <div className={BOOK_GRID_CLASS}>
              {Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="flex flex-col">
                  <div className="aspect-[3/4] w-full animate-pulse rounded-xl border border-border/50 bg-muted/50" />
                  <div className="mt-3 min-h-[64px] space-y-1.5 px-0.5">
                    <div className="h-4 w-3/4 animate-pulse rounded bg-muted/60" />
                    <div className="h-3 w-1/2 animate-pulse rounded bg-muted/40" />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredAndSortedBooks.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-[hsl(var(--pv-surface-2))] py-20 text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-border">
                <BookOpen className="h-5 w-5 text-[hsl(var(--pv-text-muted))]" />
              </div>
              <p className="pv-serif text-[15px] italic text-[hsl(var(--pv-text-muted))]">
                {searchQuery ? `No books match "${searchQuery}"` : "No books here yet"}
              </p>
              {searchQuery && (
                <Button variant="link" onClick={clearSearch} className="mt-1 h-auto p-0 text-sm">
                  Clear search
                </Button>
              )}
            </div>
          ) : (
            <div className={BOOK_GRID_CLASS}>
              {filteredAndSortedBooks.map((book) => {
                const isPinned = book.pinned === true;
                const timeAgo = formatDistanceToNow(new Date(book.updated_at || book.created_at || Date.now()), { addSuffix: true });
                const coverShowsTitle = book.cover_url ? Boolean(book.show_text_on_cover) : true;

                return (
                  <div
                    key={book.id}
                    className="group flex cursor-pointer flex-col"
                    onClick={() => navigate(`/books/${book.id}`)}
                  >
                    <BookCard
                      book={book}
                      topRightOverlay={
                        <button
                          onClick={(e) => handlePinToggle(book.id, isPinned, e)}
                          aria-label={isPinned ? 'Unpin book' : 'Pin book'}
                          className={cn(
                            "flex h-7 w-7 items-center justify-center rounded-full transition-all",
                            isPinned
                              ? "bg-white text-black shadow-md opacity-100"
                              : "bg-black/50 text-white opacity-0 hover:bg-black/70 group-hover:opacity-100"
                          )}
                        >
                          <Pin className={cn("h-3.5 w-3.5", isPinned && "fill-current")} />
                        </button>
                      }
                      topLeftOverlay={
                        (book.is_public || book.access_level) ? (
                          <>
                            {book.is_public && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-medium text-white shadow-sm">
                                <Globe2 className="h-2.5 w-2.5" />
                                Published
                              </span>
                            )}
                            {book.access_level && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-medium text-white shadow-sm">
                                <Users className="h-2.5 w-2.5" />
                                {book.access_level}
                              </span>
                            )}
                          </>
                        ) : null
                      }
                      metadata={
                        <p
                          className={cn(
                            "truncate text-[11px] text-muted-foreground/70",
                            coverShowsTitle ? "mt-0" : "mt-1.5"
                          )}
                        >
                          Updated {timeAgo}
                        </p>
                      }
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
