import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Search, X, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSession } from "@/hooks/use-session";
import { useStudioBooks } from "@/hooks/use-studio-books-query";
import { BookCard, BOOK_GRID_CLASS } from "@pensive/shared/ui/book-card";
import { formatDistanceToNow } from "date-fns";
import { setPageTitle } from "@/utils/pageTitle";

const SEARCH_DEBOUNCE_MS = 300;

export default function StudioDashboardPage() {
  const navigate = useNavigate();
  const { session, isLoading: sessionLoading } = useSession();
  const userId = session?.user.id ?? null;

  useEffect(() => setPageTitle("Studio"), []);

  useEffect(() => {
    if (!sessionLoading && !session) navigate("/auth?returnTo=/studio");
  }, [sessionLoading, session, navigate]);

  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const { data, isLoading } = useStudioBooks({ userId, search: debouncedSearch });
  const books = data?.books ?? [];
  const total = data?.total ?? 0;
  const initializing = sessionLoading || (isLoading && !data);
  const clearSearch = () => setSearchQuery("");

  return (
    <div className="container relative mx-auto max-w-7xl px-6 py-14 md:px-12">
      <header className="flex flex-col items-start justify-between gap-8 md:flex-row md:items-end">
        <div>
          <div className="pv-eyebrow">Studio · books directed with AI</div>
          <h1 className="pv-display mt-3 text-[44px] font-normal italic leading-[1.0] tracking-tight text-foreground md:text-[60px]">
            Your Studio.
          </h1>
          <p className="pv-serif mt-3.5 max-w-[520px] text-[17px] italic leading-snug text-[hsl(var(--pv-text-muted))]">
            Every book grown from a tree — you work expand · choose · edit · lock, the AI does the heavy lifting.
          </p>
        </div>
        <div className="text-left md:text-right">
          <div
            className="pv-display text-[28px] leading-none text-foreground"
            style={{ fontVariantNumeric: "oldstyle-nums" }}
          >
            {data ? total : "—"}
          </div>
          <div className="pv-mono mt-1.5 text-[10.5px] uppercase tracking-[0.15em] text-[hsl(var(--pv-text-faint))]">
            {debouncedSearch ? "matching" : "studio books"}
          </div>
        </div>
      </header>

      {/* Toolbar — a hairline rule anchors it to the grid below so the
          "New" button doesn't float against the first row of covers. */}
      <div className="mt-12 flex flex-col gap-3 border-t border-border pt-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative min-w-0 flex-1 lg:max-w-md">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-[hsl(var(--pv-text-faint))]" />
          <Input
            placeholder="Search studio books…"
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

        <Button
          onClick={() => navigate("/studio/new")}
          size="sm"
          className="pv-serif h-10 flex-shrink-0 rounded-full bg-foreground px-5 text-[14px] font-normal tracking-[0.01em] text-background hover:opacity-90"
        >
          <Plus className="mr-1.5 h-4 w-4" />
          New Studio book
        </Button>
      </div>

      {initializing ? (
        <div className={`mt-10 ${BOOK_GRID_CLASS}`}>
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="flex flex-col">
              <div className="aspect-[4/5] w-full animate-pulse rounded-xl border border-border/50 bg-muted/50" />
              <div className="mt-3 px-0.5">
                <div className="h-3 w-1/2 animate-pulse rounded bg-muted/40" />
              </div>
            </div>
          ))}
        </div>
      ) : books.length === 0 ? (
        <div className="mt-10 flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-[hsl(var(--pv-surface-2))] py-20 text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-border">
            <BookOpen className="h-5 w-5 text-[hsl(var(--pv-text-muted))]" />
          </div>
          <p className="pv-serif text-[15px] italic text-[hsl(var(--pv-text-muted))]">
            {debouncedSearch ? `No studio books match "${debouncedSearch}"` : "No studio books yet."}
          </p>
          {!debouncedSearch && (
            <Button
              variant="link"
              onClick={() => navigate("/studio/new")}
              className="mt-1 h-auto p-0 text-sm"
            >
              Start your first Studio book
            </Button>
          )}
        </div>
      ) : (
        <div className={`mt-10 ${BOOK_GRID_CLASS}`}>
          {books.map((book) => (
            <div
              key={book.id}
              className="group flex cursor-pointer flex-col"
              onClick={() => navigate(`/books/${book.id}/studio/tree`)}
            >
              <BookCard
                book={book}
                metadata={
                  <p className="mt-0 truncate text-[11px] text-muted-foreground/70">
                    Updated{" "}
                    {formatDistanceToNow(new Date(book.updated_at || book.created_at || Date.now()), {
                      addSuffix: true,
                    })}
                  </p>
                }
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
