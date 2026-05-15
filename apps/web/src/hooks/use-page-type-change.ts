import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface UsePageTypeChangeProps {
  canEdit: boolean;
  page: any; // The current page object
  numericPageId: number;
  setPage: (updater: (prevPage: any) => any) => void;
  pageTypeRef: React.MutableRefObject<'text' | 'section'>;
}

/**
 * Custom hook for handling page type changes
 * Extracted from PageView for better maintainability
 */
export const usePageTypeChange = ({
  canEdit,
  page,
  numericPageId,
  setPage,
  pageTypeRef
}: UsePageTypeChangeProps) => {
  const { toast } = useToast();

  const handlePageTypeChange = async (newPageType: 'text' | 'section') => {
    if (!canEdit || !page) return;
    
    try {
      const { error } = await supabase
        .from('pages')
        .update({ page_type: newPageType })
        .eq('id', numericPageId);

      if (error) throw error;

      // Update ref immediately to avoid re-renders
      pageTypeRef.current = newPageType;
      
      // Update local state for persistence
      setPage(prevPage =>
        prevPage ? { ...prevPage, page_type: newPageType } : null
      );

      // Manually trigger editor refocus after state update
      // Use a slight delay to ensure DOM has updated
      setTimeout(() => {
        const editorElement = document.querySelector('.ProseMirror') as HTMLElement;
        if (editorElement) {
          editorElement.focus();
        }
      }, 100);

      // Toast removed to prevent cursor loss
    } catch (error) {
      console.error('Error updating page type:', error);
      toast({
        variant: "destructive",
        title: "Failed to update page type",
        description: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };

  return { handlePageTypeChange };
};

