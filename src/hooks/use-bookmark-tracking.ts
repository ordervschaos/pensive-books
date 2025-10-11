import { useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

const LOCALSTORAGE_BOOKMARKS_KEY = 'bookmarked_pages';

/**
 * Custom hook to automatically track and save reading position
 * Works for both authenticated and anonymous users
 */
export const useBookmarkTracking = (
  bookId: number,
  pageIndex: number
) => {
  const { toast } = useToast();

  const updateBookmark = useCallback(async (index: number) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();

      if (session) {
        // Authenticated user - save to database
        const { data: userData, error: fetchError } = await supabase
          .from('user_data')
          .select('bookmarked_pages')
          .eq('user_id', session.user.id)
          .maybeSingle();

        if (fetchError) throw fetchError;

        const bookmarks = (userData?.bookmarked_pages as Record<string, number>) || {};
        const updatedBookmarks = { ...bookmarks, [bookId]: index };

        const { error: updateError } = await supabase
          .from('user_data')
          .update({ bookmarked_pages: updatedBookmarks })
          .eq('user_id', session.user.id);

        if (updateError) throw updateError;
      } else {
        // Anonymous user - save to localStorage
        const storedBookmarks = localStorage.getItem(LOCALSTORAGE_BOOKMARKS_KEY);
        const bookmarks = storedBookmarks ? JSON.parse(storedBookmarks) : {};
        const updatedBookmarks = { ...bookmarks, [bookId]: index };
        localStorage.setItem(LOCALSTORAGE_BOOKMARKS_KEY, JSON.stringify(updatedBookmarks));
      }
    } catch (error: unknown) {
      console.error('Error updating bookmark:', error);
      // Don't show error toast for bookmark failures - not critical
    }
  }, [bookId]);

  // Auto-update bookmark when page index changes
  useEffect(() => {
    if (pageIndex >= 0) {
      updateBookmark(pageIndex);
    }
  }, [pageIndex, updateBookmark]);

  return { updateBookmark };
};
