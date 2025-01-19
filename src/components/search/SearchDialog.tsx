import { useState } from "react";
import { useParams } from "react-router-dom";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface SearchResult {
  page_id: number;
  highlighted_content: string;
  notebook_id: number;
}

interface SearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SearchDialog({ open, onOpenChange }: SearchDialogProps) {
  const { id: bookId } = useParams();
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  const handleSearch = async () => {
    if (!query.trim() || !bookId) return;

    try {
      setLoading(true);
      console.log("Searching for:", query, "in book:", bookId);

      const { data, error } = await supabase
        .rpc('search_book_contents', {
          search_query: query,
          book_id: parseInt(bookId)
        });

      if (error) {
        console.error("Search error:", error);
        throw error;
      }

      console.log("Search results:", data);
      setResults(data || []);

    } catch (error: any) {
      console.error("Search error:", error);
      toast({
        variant: "destructive",
        title: "Search failed",
        description: error.message || "Failed to perform search"
      });
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const navigateToPage = (pageId: number) => {
    window.location.href = `/book/${bookId}/page/${pageId}`;
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogTitle>Search in current book</DialogTitle>
        <div className="flex gap-2 mb-4">
          <Input
            placeholder="Search in current book..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            className="flex-1"
          />
          <Button onClick={handleSearch} disabled={loading}>
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
          </Button>
        </div>

        <ScrollArea className="h-[400px] rounded-md border p-4">
          {results.length === 0 ? (
            <div className="text-center text-muted-foreground p-4">
              {loading ? "Searching..." : "No results found"}
            </div>
          ) : (
            <div className="space-y-4">
              {results.map((result, index) => (
                <div
                  key={`${result.page_id}-${index}`}
                  className="p-4 rounded-lg border hover:bg-accent cursor-pointer"
                  onClick={() => navigateToPage(result.page_id)}
                >
                  <div 
                    className="prose prose-sm dark:prose-invert"
                    dangerouslySetInnerHTML={{ 
                      __html: result.highlighted_content 
                    }} 
                  />
                </div>
              ))}
            </div>
          )}
        </ScrollArea>

        <style>
          {`
            .highlighted_words {
              background-color: #FEF08A;
              color: #1F2937;
              padding: 0.125rem 0.25rem;
              border-radius: 0.25rem;
              margin: 0 -0.125rem;
            }

            .dark .highlighted_words {
              background-color: #FBBF24;
              color: #1F2937;
            }
          `}
        </style>
      </DialogContent>
    </Dialog>
  );
}