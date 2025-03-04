
import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Bookmark } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface SectionPageContentProps {
  bookId: number;
  pageId: number;
  content: string;
  onPageChange?: (pageId: number) => void;
}

const SectionPageContent: React.FC<SectionPageContentProps> = ({
  bookId,
  pageId,
  content,
  onPageChange
}) => {
  const [childPages, setChildPages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    const fetchChildPages = async () => {
      try {
        const { data, error } = await supabase
          .from('pages')
          .select('*')
          .eq('book_id', bookId)
          .eq('parent_id', pageId)
          .order('page_index', { ascending: true });

        if (error) throw error;
        setChildPages(data || []);
      } catch (error) {
        console.error('Error fetching child pages:', error);
        toast({
          title: 'Error',
          description: 'Failed to load section pages',
          variant: 'destructive',
        });
      } finally {
        setLoading(false);
      }
    };

    fetchChildPages();
  }, [bookId, pageId, toast]);

  const handlePageClick = (childPageId: number) => {
    if (onPageChange) {
      onPageChange(childPageId);
    }
  };

  return (
    <div className="space-y-6 mb-10">
      <div className="prose max-w-none dark:prose-invert" dangerouslySetInnerHTML={{ __html: content }} />
      
      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          <h3 className="text-lg font-medium">Pages in this section</h3>
          <div className="grid gap-2">
            {childPages.length > 0 ? (
              childPages.map((page) => (
                <button
                  key={page.id}
                  onClick={() => handlePageClick(page.id)}
                  className="flex items-center gap-2 p-2 hover:bg-accent rounded-md text-left"
                >
                  <Bookmark className="h-4 w-4 text-muted-foreground" />
                  <span>{page.title}</span>
                </button>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">No pages in this section yet.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default SectionPageContent;
