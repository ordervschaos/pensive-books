import { supabase } from "@/integrations/supabase/client";
import { Page, LOCALSTORAGE_BOOKMARKS_KEY } from "./types";
import { toast } from "@/components/ui/use-toast";

export const fetchBookmarkedPage = async (bookId: number): Promise<number | null> => {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    
    if (session) {
      const { data: userData } = await supabase
        .from('user_data')
        .select('bookmarked_pages')
        .eq('user_id', session.user.id)
        .maybeSingle();
      
      const bookmarks = userData?.bookmarked_pages || {};
      return bookmarks[bookId] ?? null;
    } else {
      const storedBookmarks = localStorage.getItem(LOCALSTORAGE_BOOKMARKS_KEY);
      const bookmarks = storedBookmarks ? JSON.parse(storedBookmarks) : {};
      return bookmarks[bookId] ?? null;
    }
  } catch (error) {
    console.error('Error fetching bookmarked page:', error);
    return null;
  }
};

export const handleDeletePage = async (
  pageId: number, 
  bookId: number, 
  pages: Page[],
  onSuccess: (updatedPages: Page[]) => void,
  onError: (error: Error) => void
) => {
  try {
    console.log('Attempting to archive page:', {
      pageId,
      bookId,
      userEmail: (await supabase.auth.getUser()).data.user?.email
    });

    // First archive the page
    const { error: archiveError } = await supabase
      .from('pages')
      .update({ 
        archived: true,
        updated_at: new Date().toISOString()
      })
      .eq('id', pageId);

    if (archiveError) {
      console.error('Error archiving page:', archiveError);
      throw archiveError;
    }

    // Get the remaining pages and update their indices
    const remainingPages = pages.filter(page => page.id !== pageId);
    const updatedPages = remainingPages.map((page, index) => ({
      id: page.id,
      page_index: index,
      book_id: bookId
    }));

    // Update the indices of remaining pages
    const { error: updateError } = await supabase
      .from('pages')
      .upsert(updatedPages);

    if (updateError) {
      console.error('Error updating page indices:', updateError);
      throw updateError;
    }

    // Call success callback with updated pages
    onSuccess(remainingPages);
  } catch (error: any) {
    console.error('Detailed error:', error);
    onError(error);
  }
};

const findAvailablePageIndex = async (bookId: number, startingIndex: number): Promise<number> => {
  let index = startingIndex;
  let maxAttempts = 10; // Limit the number of attempts to avoid infinite loops
  let attemptCount = 0;
  
  while (attemptCount < maxAttempts) {
    // Check if the current index is already taken
    const { data, error } = await supabase
      .from('pages')
      .select('id')
      .eq('book_id', bookId)
      .eq('page_index', index)
      .eq('archived', false);
      
    if (error) {
      console.error('Error checking page index:', error);
      throw error;
    }
    
    // If no page exists with this index, we can use it
    if (!data || data.length === 0) {
      return index;
    }
    
    // Otherwise, try the next index
    index++;
    attemptCount++;
  }
  
  // If we've tried too many times, throw an error
  throw new Error('Unable to find an available page index after multiple attempts');
};

export const createNewPage = async (
  bookId: number,
  pages: Page[],
  pageType: 'text' | 'section' = 'text',
  onSuccess: (newPageId: number) => void,
  onError: (error: Error) => void
) => {
  try {
    // Calculate what should be the next page index
    const maxPageIndex = Math.max(...pages.map(p => p.page_index), -1);
    const nextIndex = maxPageIndex + 1;
    
    // Find an available page index (handles potential duplicates)
    const availableIndex = await findAvailablePageIndex(bookId, nextIndex);
    
    console.log(`Creating new page with index ${availableIndex} (originally attempted ${nextIndex})`);
    
    // Create the page with the available index
    const { data: newPage, error } = await supabase
      .from('pages')
      .insert({
        book_id: bookId,
        page_index: availableIndex,
        content: {},
        html_content: '',
        page_type: pageType
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating new page:', error);
      throw error;
    }

    onSuccess(newPage.id);
  } catch (error: any) {
    console.error('Detailed error during page creation:', error);
    onError(error);
  }
};

export const reorderPages = async (
  bookId: number,
  oldItems: Page[],
  newItems: Page[],
  onSuccess: () => void,
  onError: (error: Error) => void
) => {
  try {
    // First, update all pages to have temporary indices that won't conflict
    const tempUpdates = oldItems.map((page, index) => ({
      id: page.id,
      page_index: -(index + 1000), // Use negative numbers to avoid conflicts
      book_id: bookId
    }));

    let { error: tempError } = await supabase
      .from('pages')
      .upsert(tempUpdates);

    if (tempError) throw tempError;

    // Then, update to the final indices
    const finalUpdates = newItems.map((page, index) => ({
      id: page.id,
      page_index: index,
      book_id: bookId
    }));

    const { error } = await supabase
      .from('pages')
      .upsert(finalUpdates);

    if (error) throw error;

    onSuccess();
  } catch (error: unknown) {
    const err = error as { message: string };
    onError(err as Error);
  }
};
