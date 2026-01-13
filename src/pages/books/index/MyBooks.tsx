import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Wand2, Search, X, Pin, PinOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RecentBooksCard } from "./components/RecentBooksCard";
import { useBookFilters, FilterType, SortType } from "@/hooks/use-book-filters";
import { formatDistanceToNow } from "date-fns";

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
  page_count?: number; // Added for sorting by most pages
}

export default function Index() {
  const [books, setBooks] = useState<Book[]>([]);
  const [sharedBooks, setSharedBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingDetails, setLoadingDetails] = useState(true);
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
          })) as Book[] || [];

        console.log("Basic books fetched successfully:", {
          owned: ownedBooks.length,
          shared: transformedSharedBooks.length
        });

        // Show books immediately with page_count = 0
        setBooks(ownedBooks.map(book => ({ ...book, page_count: 0 })) as Book[]);
        setSharedBooks(transformedSharedBooks.map(book => ({ ...book, page_count: 0 })));
        setLoading(false);

        // STAGE 2: Fetch page counts in background
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

            // Update books with page counts
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

        setLoadingDetails(false);
      } catch (error: unknown) {
        console.error("Error fetching books:", error);
        toast({
          variant: "destructive",
          title: "Error fetching books",
          description: error instanceof Error ? error.message : "An unknown error occurred",
        });
        setLoading(false);
        setLoadingDetails(false);
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

      // Optimistic update
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

  if (loading) {
    return (
      <div className="container mx-auto p-6">
        <div className="fixed top-0 left-0 right-0 z-50">
          <div className="h-1 bg-primary/20">
            <div className="h-full bg-primary animate-pulse" style={{ width: '80%' }}></div>
          </div>
        </div>
        <div className="opacity-60">
          <div className="space-y-3">
            <div className="h-6 w-32 bg-muted rounded animate-pulse"></div>
            <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className={`h-24 bg-muted rounded animate-pulse ${i > 2 ? 'hidden lg:block' : ''}`}></div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const filterOptions: { value: FilterType; label: string; count?: number }[] = [
    { value: 'all', label: 'All', count: filterCounts.all },
    { value: 'published', label: 'Published', count: filterCounts.published },
    { value: 'private', label: 'Private', count: filterCounts.private },
    { value: 'pinned', label: 'Pinned', count: filterCounts.pinned },
  ];

  const sortOptions: { value: SortType; label: string }[] = [
    { value: 'recently-updated', label: 'Recently updated' },
    { value: 'recently-created', label: 'Recently created' },
    { value: 'alphabetical-az', label: 'Alphabetical (A-Z)' },
    { value: 'alphabetical-za', label: 'Alphabetical (Z-A)' },
    { value: 'most-pages', label: 'Most pages' },
  ];

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Recent Books - Top Priority */}
      <RecentBooksCard />

      {/* Header with Search, Filters, Sort */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
          {/* Search Bar */}
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-2.5 top-1/2 transform -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search books..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 pr-8 h-9 text-sm"
            />
            {searchQuery && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-0.5 top-1/2 transform -translate-y-1/2 h-7 w-7"
                onClick={clearSearch}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>

          {/* Sort Dropdown */}
          <Select value={sortType} onValueChange={(value) => setSortType(value as SortType)}>
            <SelectTrigger className="w-full sm:w-[180px] h-9 text-sm">
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

          {/* Action Buttons */}
          <div className="flex gap-2 flex-shrink-0">
            <Button 
              variant="outline" 
              onClick={() => navigate("/generate-book")} 
              size="sm"
              className="h-9 px-3 text-sm"
            >
              <Wand2 className="h-3.5 w-3.5 mr-1.5" />
              Generate
              <Badge variant="secondary" className="ml-1.5 text-[10px] px-1 py-0">BETA</Badge>
            </Button>
            <Button
              onClick={() => navigate("/books/new")}
              size="sm"
              className="h-9 px-3 text-sm"
            >
              <Plus className="h-3.5 w-3.5 mr-1.5" /> 
              New book
            </Button>
          </div>
        </div>

        {/* Filter Chips */}
        <div className="flex flex-wrap gap-1.5">
          {filterOptions.map((filter) => (
            <Button
              key={filter.value}
              variant={activeFilter === filter.value ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveFilter(filter.value)}
              className="h-8 px-3 text-xs font-medium"
            >
              {filter.label}
              {filter.count !== undefined && filter.count > 0 && (
                <Badge 
                  variant={activeFilter === filter.value ? "secondary" : "outline"} 
                  className="ml-1.5 text-[10px] px-1.5 py-0 h-4 min-w-[18px]"
                >
                  {filter.count}
                </Badge>
              )}
            </Button>
          ))}
        </div>
      </div>

      {/* Unified Book Grid */}
      <div className="space-y-6">
        {filteredAndSortedBooks.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground">
              {searchQuery ? `No books match "${searchQuery}"` : "No books found"}
            </p>
            {searchQuery && (
              <Button variant="link" onClick={clearSearch} className="mt-2">
                Clear search
              </Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {filteredAndSortedBooks.map((book) => {
              const isPinned = book.pinned === true;
              const timeAgo = formatDistanceToNow(new Date(book.updated_at || book.created_at || Date.now()), { addSuffix: true });

              return (
                <div key={book.id} className="flex flex-col sm:block group">
                  <div className="flex sm:block items-start gap-4 sm:gap-0">
                    <Card
                      className="relative cursor-pointer overflow-hidden w-24 sm:w-full aspect-[3/4]"
                      onClick={() => navigate(`/books/${book.id}`)}
                    >
                      {/* Published Badge */}
                      {book.is_public && (
                        <Badge 
                          variant="secondary" 
                          className="absolute top-1.5 right-1.5 z-10 text-[10px] sm:text-xs px-1.5 py-0.5"
                        >
                          Published
                        </Badge>
                      )}

                      {/* Pin Button */}
                      <Button
                        variant="ghost"
                        size="icon"
                        className={`absolute top-1.5 left-1.5 z-10 opacity-0 sm:group-hover:opacity-100 transition-opacity bg-background/80 hover:bg-background h-7 w-7 sm:h-8 sm:w-8 ${
                          isPinned ? 'opacity-100' : ''
                        }`}
                        onClick={(e) => handlePinToggle(book.id, isPinned, e)}
                      >
                        {isPinned ? (
                          <Pin className="h-3 w-3 sm:h-4 sm:w-4 fill-current" />
                        ) : (
                          <PinOff className="h-3 w-3 sm:h-4 sm:w-4" />
                        )}
                      </Button>

                      <div className="w-full h-full">
                        {book.cover_url ? (
                          <div className="relative w-full h-full">
                            <img
                              src={book.cover_url}
                              alt={book.name || 'Book cover'}
                              className="w-full h-full object-cover transition-transform group-hover:scale-105"
                            />
                            {book.show_text_on_cover && (
                              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/30 p-4">
                                <h2 className="text-base sm:text-xl font-semibold text-image-overlay text-center mb-1 sm:mb-2 line-clamp-3 break-words">
                                  {book.name}
                                </h2>
                                {book.subtitle && (
                                  <p className="text-xs hidden sm:block sm:text-sm text-image-overlay-muted text-center mb-1 sm:mb-2 line-clamp-2 break-words">
                                    {book.subtitle}
                                  </p>
                                )}
                                {book.author && (
                                  <p className="text-xs hidden sm:block sm:text-sm text-image-overlay-muted text-center line-clamp-1 break-words">
                                    by {book.author}
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="absolute inset-0 flex flex-col items-center md:justify-center bg-secondary p-4">
                            <h2 className="text-xs md:text-2xl font-semibold text-center text-secondary-foreground break-words line-clamp-3">
                              {book.name}
                            </h2>
                            {book.subtitle && (
                              <p className="text-xs hidden sm:block sm:text-sm text-muted-foreground text-center mb-1 sm:mb-2 line-clamp-2 break-words">
                                {book.subtitle}
                              </p>
                            )}
                            {book.author && (
                              <p className="text-xs hidden sm:block sm:text-sm text-muted-foreground text-center line-clamp-1 break-words">
                                by {book.author}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    </Card>
                    <div className="flex-1 sm:mt-2 space-y-1 sm:text-center text-left">
                      <h3 
                        className="text-sm text-muted-foreground font-medium line-clamp-2 break-words cursor-pointer" 
                        onClick={() => navigate(`/books/${book.id}`)}
                      >
                        {book.name}
                      </h3>
                      {book.subtitle && (
                        <p className="text-xs text-muted-foreground line-clamp-2 break-words sm:hidden">
                          {book.subtitle}
                        </p>
                      )}
                      {book.author && (
                        <p className="text-xs text-muted-foreground line-clamp-1 break-words sm:hidden">
                          by {book.author}
                        </p>
                      )}
                      <div className="flex flex-col gap-1 sm:gap-2 sm:items-center">
                        <div className="flex gap-2 sm:justify-center justify-start flex-wrap">
                          {book.is_public && (
                            <Badge variant="secondary" className="text-xs">
                              Published
                            </Badge>
                          )}
                          {book.access_level && (
                            <Badge variant="outline" className="text-xs">
                              {book.access_level} access
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Updated {timeAgo}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
