import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface UsePageCreationReturn {
  createNewPage: () => Promise<void>;
  creating: boolean;
}

/**
 * Custom hook to handle page creation logic
 * Includes permission checks, database operations, navigation, and error handling
 */
export const usePageCreation = (
  bookId: string | undefined,
  numericBookId: number,
  canEdit: boolean
): UsePageCreationReturn => {
  const navigate = useNavigate();
  const { toast } = useToast();

  const createNewPage = useCallback(async () => {
    if (!canEdit) {
      toast({
        variant: 'destructive',
        title: 'Permission denied',
        description: "You don't have permission to create pages in this book",
      });
      return;
    }

    try {
      const { data: newPage, error } = await supabase
        .rpc('create_next_page', {
          p_book_id: numericBookId,
        })
        .select()
        .single();

      if (error) throw error;

      // Navigate to the new page with edit mode enabled
      navigate(`/book/${bookId}/page/${newPage.id}?edit=true`);

      toast({
        title: 'Page created',
        description: 'Your new page has been created',
      });
    } catch (error: unknown) {
      toast({
        variant: 'destructive',
        title: 'Error creating page',
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }, [canEdit, numericBookId, bookId, navigate, toast]);

  return { createNewPage, creating: false };
};
