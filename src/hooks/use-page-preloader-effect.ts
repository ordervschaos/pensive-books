import { useEffect } from 'react';
import { preloadPages } from '@/utils/pagePreloader';

/**
 * Custom hook to automatically preload next pages for better performance
 * Runs as a side effect whenever the next page ID changes
 */
export const usePagePreloaderEffect = (
  bookId: number,
  nextPageId: number | null,
  loading: boolean
) => {
  useEffect(() => {
    if (!loading && nextPageId) {
      preloadPages(bookId, [nextPageId]).catch(error => {
        console.error('Error preloading next page:', error);
      });
    }
  }, [nextPageId, bookId, loading]);
};
