import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface Page {
  id: number;
  page_index: number;
}

interface UsePageDeletionProps {
  bookId: string;
  numericBookId: number;
  numericPageId: number;
  allPages: Page[];
  currentIndex: number;
  canEdit: boolean;
}

/**
 * Custom hook for handling page deletion with smart navigation
 * Extracted from PageView for better maintainability
 */
export const usePageDeletion = ({
  bookId,
  numericBookId,
  numericPageId,
  allPages,
  currentIndex,
  canEdit
}: UsePageDeletionProps) => {
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleDeletePage = async () => {
    if (!canEdit) {
      toast({
        variant: "destructive",
        title: "Permission denied",
        description: "You don't have permission to delete this page"
      });
      return;
    }

    try {
      // Archive the page
      const { error: archiveError } = await supabase
        .from('pages')
        .update({ 
          archived: true,
          updated_at: new Date().toISOString()
        })
        .eq('id', numericPageId);

      if (archiveError) throw archiveError;

      // Get remaining pages and update their indices
      const remainingPages = allPages.filter(p => p.id !== numericPageId);
      const updatedPages = remainingPages.map((page, index) => ({
        id: page.id,
        page_index: index,
        book_id: numericBookId
      }));

      // Update the indices of remaining pages
      const { error: updateError } = await supabase
        .from('pages')
        .upsert(updatedPages);

      if (updateError) throw updateError;

      toast({
        title: "Page deleted",
        description: "The page has been archived successfully"
      });

      // Smart navigation after deletion
      if (remainingPages.length === 0) {
        // No pages left, go to book details (table of contents)
        navigate(`/books/${bookId}`);
      } else if (currentIndex < remainingPages.length) {
        // Not the last page, go to the next page (which now has the same index)
        const nextPage = remainingPages[currentIndex];
        navigate(`/books/${bookId}/pages/${nextPage.id}`);
      } else {
        // Was the last page, go to the previous page (now the new last page)
        const prevPage = remainingPages[remainingPages.length - 1];
        navigate(`/books/${bookId}/pages/${prevPage.id}`);
      }
    } catch (error) {
      console.error('Error deleting page:', error);
      toast({
        variant: "destructive",
        title: "Error deleting page",
        description: error instanceof Error ? error.message : "Failed to delete page"
      });
    }
  };

  return { handleDeletePage };
};

