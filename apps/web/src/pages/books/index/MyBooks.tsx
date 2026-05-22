import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Plus,
  Wand2,
  Search,
  X,
  Pin,
  MoreHorizontal,
  BookOpen,
  Globe2,
  Users,
  Loader2,
  RotateCcw,
  Archive,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { RecentBooksCard } from "./components/RecentBooksCard";
import {
  useInfiniteMyBooks,
  useMyBooksCounts,
  useSharedBooks,
  type FilterType,
  type SortType,
  type OwnedBook,
  type SharedBook,
} from "@/hooks/use-my-books-query";
import { formatDistanceToNow } from "date-fns";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { BookCard, BOOK_GRID_CLASS } from "@pensive/shared/ui/book-card";

const PAGE_SIZE = 24;
const SEARCH_DEBOUNCE_MS = 300;

type BookForCard = OwnedBook | SharedBook;

export default function Index() {
  const [session, setSession] = useState<{
    userId: string;
    email: string | null;
  } | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterType>("all");
  const [sortType, setSortType] = useState<SortType>("recently-updated");

  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let isMounted = true;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!isMounted) return;
      if (!session) {
        navigate("/auth");
        return;
      }
      setSession({ userId: session.user.id, email: session.user.email ?? null });
      setAuthChecked(true);
    });
    return () => {
      isMounted = false;
    };
  }, [navigate]);

  useEffect(() => {
    const timer = setTimeout(
      () => setDebouncedSearch(searchQuery),
      SEARCH_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const userId = session?.userId ?? null;

  const {
    data: infiniteData,
    isLoading: pageLoading,
    isFetching: pageFetching,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    error: pageError,
  } = useInfiniteMyBooks({
    userId,
    filter: activeFilter,
    search: debouncedSearch,
    sort: sortType,
    pageSize: PAGE_SIZE,
  });

  const { data: counts } = useMyBooksCounts(userId);
  const { data: sharedBooks } = useSharedBooks(session?.email ?? null);

  useEffect(() => {
    if (pageError) {
      console.error("Error fetching books:", pageError);
      toast({
        variant: "destructive",
        title: "Error fetching books",
        description:
          pageError instanceof Error ? pageError.message : "Unknown error",
      });
    }
  }, [pageError, toast]);

  const handleRestoreBook = async (bookId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const { error: bookError } = await supabase
        .from("books")
        .update({ is_archived: false })
        .eq("id", bookId);
      if (bookError) throw bookError;

      await supabase
        .from("pages")
        .update({ archived: false })
        .eq("book_id", bookId)
        .eq("archived", true);

      queryClient.invalidateQueries({ queryKey: ["my-books-infinite"] });
      queryClient.invalidateQueries({ queryKey: ["my-books-counts"] });

      toast({
        title: "Book restored",
        description: "The book and its pages have been restored to your desk",
      });
    } catch (error: unknown) {
      toast({
        variant: "destructive",
        title: "Error restoring book",
        description: error instanceof Error ? error.message : "Unknown error occurred",
      });
    }
  };

  const handlePinToggle = async (
    bookId: number,
    currentlyPinned: boolean,
    e: React.MouseEvent,
  ) => {
    e.stopPropagation();

    try {
      const { error } = await supabase
        .from("books")
        .update({ pinned: !currentlyPinned })
        .eq("id", bookId);

      if (error) throw error;

      // Invalidate book queries so counts + grid refresh.
      queryClient.invalidateQueries({ queryKey: ["my-books-infinite"] });
      queryClient.invalidateQueries({ queryKey: ["my-books-counts"] });

      toast({
        title: currentlyPinned ? "Book unpinned" : "Book pinned",
        description: currentlyPinned
          ? "Book removed from pinned section"
          : "Book added to pinned section",
      });
    } catch (error: unknown) {
      console.error("Error toggling pin:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description:
          error instanceof Error ? error.message : "Unknown error occurred",
      });
    }
  };

  const filterOptions: { value: FilterType; label: string; count?: number }[] = [
    { value: "all", label: "All", count: counts?.all },
    { value: "published", label: "Published", count: counts?.published },
    { value: "private", label: "Private", count: counts?.private },
    { value: "pinned", label: "Pinned", count: counts?.pinned },
    { value: "archived", label: "Archived", count: counts?.archived },
  ];

  const sortOptions: { value: SortType; label: string }[] = [
    { value: "recently-updated", label: "Recently updated" },
    { value: "recently-created", label: "Recently created" },
    { value: "alphabetical-az", label: "Alphabetical (A-Z)" },
    { value: "alphabetical-za", label: "Alphabetical (Z-A)" },
  ];

  const totalBooks = counts?.all ?? 0;
  const publishedCount = counts?.published ?? 0;
  const privateCount = counts?.private ?? 0;
  const books = useMemo<OwnedBook[]>(
    () => infiniteData?.pages.flatMap((p) => p.books) ?? [],
    [infiniteData],
  );
  const total = infiniteData?.pages[0]?.total ?? 0;
  const isFirstLoad = pageLoading && !infiniteData;
  const initializing = !authChecked || isFirstLoad;

  const clearSearch = () => setSearchQuery("");

  const todayLabel = new Intl.DateTimeFormat("en", {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date());

  const displayedSharedBooks = useMemo<SharedBook[]>(
    () => sharedBooks ?? [],
    [sharedBooks],
  );

  // Autoload the next page when the sentinel scrolls into view.
  useEffect(() => {
    const node = loadMoreRef.current;
    if (!node || !hasNextPage) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { rootMargin: "400px 0px" },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, books.length]);

  return (
    <div className="relative">
      {(initializing || pageFetching) && (
        <div className="fixed top-0 left-0 right-0 z-50">
          <div className="h-1 bg-primary/20">
            <div
              className="h-full bg-primary animate-pulse"
              style={{ width: "80%" }}
            ></div>
          </div>
        </div>
      )}
      <div className="container relative mx-auto max-w-7xl px-6 py-14 space-y-14 md:px-12">
        {/* Masthead */}
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
                  {counts ? s.n : "—"}
                </div>
                <div className="pv-mono mt-1.5 text-[10.5px] uppercase tracking-[0.15em] text-[hsl(var(--pv-text-faint))]">
                  {s.l}
                </div>
              </div>
            ))}
          </div>
        </header>

        <RecentBooksCard />

        {/* Shared with you — small section, no pagination */}
        {displayedSharedBooks.length > 0 && (
          <div className="space-y-5">
            <div className="flex items-baseline justify-between gap-4">
              <div className="pv-display text-[26px] italic tracking-tight text-foreground md:text-[30px]">
                Shared with you
              </div>
              <span className="pv-mono text-[11px] uppercase tracking-[0.15em] text-[hsl(var(--pv-text-faint))]">
                {displayedSharedBooks.length}{" "}
                {displayedSharedBooks.length === 1 ? "book" : "books"}
              </span>
            </div>
            <div className={BOOK_GRID_CLASS}>
              {displayedSharedBooks.map((book) => (
                <BookGridCard
                  key={book.id}
                  book={book}
                  onPinToggle={handlePinToggle}
                  onClick={() => navigate(`/books/${book.id}`)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Toolbar */}
        <div className="space-y-5">
          <div className="flex items-baseline justify-between gap-4">
            <div className="pv-display text-[26px] italic tracking-tight text-foreground md:text-[30px]">
              Your manuscripts
            </div>
            <span className="pv-mono text-[11px] uppercase tracking-[0.15em] text-[hsl(var(--pv-text-faint))]">
              {counts ? `${totalBooks} ${totalBooks === 1 ? "book" : "books"}` : ""}
            </span>
          </div>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            {/* Search */}
            <div className="relative min-w-0 flex-1 lg:max-w-md">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-[hsl(var(--pv-text-faint))]" />
              <Input
                placeholder="Search books…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pv-serif h-10 rounded-full border-border bg-transparent pl-10 pr-10 text-[14px] italic placeholder:text-[hsl(var(--pv-text-faint))] placeholder:italic transition-colors focus-visible:border-foreground/60 focus-visible:ring-0"
              />
              {searchQuery && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2 rounded-full text-[hsl(var(--pv-text-muted))]"
                  onClick={clearSearch}
                  aria-label="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>

            {/* Sort + Actions */}
            <div className="flex flex-shrink-0 items-center gap-2">
              <Select value={sortType} onValueChange={(value) => setSortType(value as SortType)}>
                <SelectTrigger
                  className="pv-serif h-10 w-full rounded-full border-border bg-transparent px-4 text-[14px] italic text-foreground focus:ring-0 focus:ring-offset-0 data-[placeholder]:text-[hsl(var(--pv-text-faint))] sm:w-[200px]"
                >
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

              <Button
                onClick={() => navigate("/books/new")}
                size="sm"
                className="pv-serif h-10 rounded-full bg-foreground px-5 text-[14px] font-normal tracking-[0.01em] text-background hover:opacity-90"
              >
                <Plus className="mr-1.5 h-4 w-4" />
                Start a new book
              </Button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-10 w-10 rounded-full border-0 bg-transparent text-[hsl(var(--pv-text-muted))] hover:text-foreground"
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
                    <span className="pv-mono ml-auto rounded-full bg-foreground/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-foreground">
                      Beta
                    </span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
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
                      : "border-border bg-transparent text-[hsl(var(--pv-text-muted))] hover:border-foreground/40 hover:text-foreground",
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

        {/* Owned books grid */}
        <div className="space-y-6">
          {initializing ? (
            <div className={BOOK_GRID_CLASS}>
              {Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="flex flex-col">
                  <div className="aspect-[4/5] w-full animate-pulse rounded-xl border border-border/50 bg-muted/50" />
                  <div className="mt-3 min-h-[64px] space-y-1.5 px-0.5">
                    <div className="h-4 w-3/4 animate-pulse rounded bg-muted/60" />
                    <div className="h-3 w-1/2 animate-pulse rounded bg-muted/40" />
                  </div>
                </div>
              ))}
            </div>
          ) : books.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-[hsl(var(--pv-surface-2))] py-20 text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-border">
                <BookOpen className="h-5 w-5 text-[hsl(var(--pv-text-muted))]" />
              </div>
              <p className="pv-serif text-[15px] italic text-[hsl(var(--pv-text-muted))]">
                {debouncedSearch
                  ? `No books match "${debouncedSearch}"`
                  : activeFilter === "archived"
                  ? "No archived books"
                  : "No books here yet"}
              </p>
              {debouncedSearch && (
                <Button
                  variant="link"
                  onClick={clearSearch}
                  className="mt-1 h-auto p-0 text-sm"
                >
                  Clear search
                </Button>
              )}
            </div>
          ) : (
            <>
              <div className={BOOK_GRID_CLASS}>
                {books.map((book) => (
                  <BookGridCard
                    key={book.id}
                    book={book}
                    onPinToggle={handlePinToggle}
                    onClick={activeFilter === "archived" ? undefined : () => navigate(`/books/${book.id}`)}
                    isArchived={activeFilter === "archived"}
                    onRestore={activeFilter === "archived" ? handleRestoreBook : undefined}
                  />
                ))}
              </div>

              {/* Sentinel + status row for infinite scroll */}
              <div
                ref={loadMoreRef}
                aria-live="polite"
                className="flex items-center justify-center pt-6"
              >
                {hasNextPage ? (
                  <span className="pv-mono inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-[hsl(var(--pv-text-faint))]">
                    {isFetchingNextPage ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Loading more…
                      </>
                    ) : (
                      <>{books.length} of {total} {total === 1 ? "book" : "books"}</>
                    )}
                  </span>
                ) : (
                  total > PAGE_SIZE && (
                    <span className="pv-mono text-[11px] uppercase tracking-[0.18em] text-[hsl(var(--pv-text-faint))]">
                      {total} {total === 1 ? "book" : "books"} · end of list
                    </span>
                  )
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function BookGridCard({
  book,
  onPinToggle,
  onClick,
  isArchived = false,
  onRestore,
}: {
  book: BookForCard;
  onPinToggle: (
    bookId: number,
    currentlyPinned: boolean,
    e: React.MouseEvent,
  ) => void;
  onClick?: () => void;
  isArchived?: boolean;
  onRestore?: (bookId: number, e: React.MouseEvent) => void;
}) {
  const isPinned = book.pinned === true;
  const timeAgo = formatDistanceToNow(
    new Date(book.updated_at || book.created_at || Date.now()),
    { addSuffix: true },
  );
  const coverShowsTitle = book.cover_url
    ? Boolean(book.show_text_on_cover)
    : true;
  const accessLevel = "access_level" in book ? book.access_level : undefined;

  return (
    <div
      className={cn("group flex flex-col", onClick ? "cursor-pointer" : "cursor-default")}
      onClick={onClick}
    >
      <BookCard
        book={book}
        topRightOverlay={
          isArchived ? (
            <button
              onClick={(e) => onRestore?.(book.id, e)}
              aria-label="Restore book"
              className="flex items-center gap-1 rounded-full bg-black/60 px-2.5 py-1 text-[10px] font-medium text-white shadow-md opacity-0 transition-all hover:bg-black/80 group-hover:opacity-100"
            >
              <RotateCcw className="h-2.5 w-2.5" />
              Restore
            </button>
          ) : (
            <button
              onClick={(e) => onPinToggle(book.id, isPinned, e)}
              aria-label={isPinned ? "Unpin book" : "Pin book"}
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-full transition-all",
                isPinned
                  ? "bg-white text-black shadow-md opacity-100"
                  : "bg-black/50 text-white opacity-0 hover:bg-black/70 group-hover:opacity-100",
              )}
            >
              <Pin className={cn("h-3.5 w-3.5", isPinned && "fill-current")} />
            </button>
          )
        }
        topLeftOverlay={
          isArchived ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-medium text-white shadow-sm">
              <Archive className="h-2.5 w-2.5" />
              Archived
            </span>
          ) : book.is_public || accessLevel || book.content_tags?.includes('mature') ? (
            <>
              {book.is_public && (
                <span className="inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-medium text-white shadow-sm">
                  <Globe2 className="h-2.5 w-2.5" />
                  Published
                </span>
              )}
              {accessLevel && (
                <span className="inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-medium text-white shadow-sm">
                  <Users className="h-2.5 w-2.5" />
                  {accessLevel}
                </span>
              )}
              {book.content_tags?.includes('mature') && (
                <span className="inline-flex items-center rounded-full bg-red-700/80 px-2 py-0.5 text-[10px] font-medium text-white shadow-sm">
                  18+
                </span>
              )}
            </>
          ) : null
        }
        metadata={
          <p
            className={cn(
              "truncate text-[11px] text-muted-foreground/70",
              coverShowsTitle ? "mt-0" : "mt-1.5",
            )}
          >
            {isArchived ? `Archived · Updated ${timeAgo}` : `Updated ${timeAgo}`}
          </p>
        }
      />
    </div>
  );
}

