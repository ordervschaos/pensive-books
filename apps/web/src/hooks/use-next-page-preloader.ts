import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * Hook to preload the next page(s) in the background for faster navigation
 * Uses React Query to cache the data for instant subsequent loads
 * @param bookId - The ID of the current book
 * @param nextPageId - The ID of the next page to preload
 * @param enabled - Whether preloading is enabled (default: true)
 */
export const useNextPagePreloader = (
  bookId: number | null,
  nextPageId: number | null,
  enabled: boolean = true
) => {
  const queryClient = useQueryClient();
  const preloadedRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    console.log('[Preloader] Hook triggered with:', { bookId, nextPageId, enabled });

    // Skip if disabled or missing required data
    if (!enabled) {
      console.log('[Preloader] Skipped - preloading disabled');
      return;
    }

    if (!bookId) {
      console.log('[Preloader] Skipped - no bookId');
      return;
    }

    if (!nextPageId) {
      console.log('[Preloader] Skipped - no nextPageId (might be last page)');
      return;
    }

    // Skip if already preloaded in this session
    if (preloadedRef.current.has(nextPageId)) {
      console.log(`[Preloader] Skipped - page ${nextPageId} already preloaded in this session`);
      return;
    }

    // Debounce the preload to avoid excessive requests
    const timeoutId = setTimeout(async () => {
      try {
        console.log(`[Preloader] Starting preload for page ${nextPageId}`);

        // Prefetch using React Query - this will cache the data
        await queryClient.prefetchQuery({
          queryKey: ['page', nextPageId, bookId],
          queryFn: async () => {
            const { data, error } = await supabase
              .from('pages')
              .select('*')
              .eq('id', nextPageId)
              .eq('book_id', bookId)
              .eq('archived', false)
              .maybeSingle();

            if (error) throw error;
            return data;
          },
          staleTime: 5 * 60 * 1000, // Cache for 5 minutes
        });

        // Mark as preloaded
        preloadedRef.current.add(nextPageId);
        console.log(`[Preloader] ✓ Successfully preloaded and cached page ${nextPageId}`);
      } catch (error) {
        console.error('[Preloader] Error preloading page:', error);
      }
    }, 300); // 300ms debounce

    return () => {
      clearTimeout(timeoutId);
    };
  }, [bookId, nextPageId, enabled, queryClient]);

  // Cleanup function to clear tracking when component unmounts
  useEffect(() => {
    return () => {
      preloadedRef.current.clear();
    };
  }, []);
};
