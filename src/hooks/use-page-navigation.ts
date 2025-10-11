import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { SlugService } from '@/utils/slugService';

interface PageListItem {
  id: number;
  title: string;
  page_index: number;
}

interface UsePageNavigationReturn {
  navigateToPage: (index: number) => Promise<void>;
  navigateNext: () => void;
  navigatePrev: () => void;
  navigating: boolean;
}

/**
 * Custom hook to handle page navigation logic
 * Manages URL updates, data fetching, and navigation state
 */
export const usePageNavigation = (
  bookId: string | undefined,
  numericBookId: number,
  allPages: PageListItem[],
  currentIndex: number,
  onNavigationComplete?: (pageData: any) => void
): UsePageNavigationReturn => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [navigating, setNavigating] = useState(false);

  const navigateToPage = useCallback(async (index: number) => {
    if (navigating) return; // Prevent double navigation

    try {
      setNavigating(true);

      const nextPage = allPages.find(p => p.page_index === index);
      if (!nextPage) {
        console.error('Page not found at index:', index);
        return;
      }

      const nextPageId = nextPage.id;

      // Generate slug URL
      const slug = nextPage.title
        ? SlugService.generateSlug(nextPageId, nextPage.title)
        : nextPageId.toString();

      // Update URL (triggers PageView to re-render with new params)
      navigate(`/book/${bookId}/page/${slug}`, { replace: false });

      // Optionally notify parent of navigation completion
      if (onNavigationComplete) {
        const { data: pageData } = await supabase
          .from('pages')
          .select('*')
          .eq('id', nextPageId)
          .eq('book_id', numericBookId)
          .eq('archived', false)
          .maybeSingle();

        if (pageData) {
          onNavigationComplete(pageData);
        }
      }

    } catch (error: unknown) {
      toast({
        variant: 'destructive',
        title: 'Error navigating to page',
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setNavigating(false);
    }
  }, [allPages, bookId, numericBookId, navigate, toast, navigating, onNavigationComplete]);

  const navigateNext = useCallback(() => {
    if (currentIndex < allPages.length - 1) {
      navigateToPage(currentIndex + 1);
    }
  }, [currentIndex, allPages.length, navigateToPage]);

  const navigatePrev = useCallback(() => {
    if (currentIndex > 0) {
      navigateToPage(currentIndex - 1);
    }
  }, [currentIndex, navigateToPage]);

  return {
    navigateToPage,
    navigateNext,
    navigatePrev,
    navigating,
  };
};
