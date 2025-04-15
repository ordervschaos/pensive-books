import { pageCache } from '@/services/PageCache';
import { supabase } from '@/integrations/supabase/client';

/**
 * Preloads multiple pages in a book
 * @param bookId The ID of the book
 * @param pageIds Array of page IDs to preload
 * @returns Promise that resolves when all pages are preloaded
 */
export const preloadPages = async (bookId: number, pageIds: number[]): Promise<void> => {
  if (!bookId || !pageIds.length) return;
  
  try {
    // Fetch book data once
    const { data: bookData, error: bookError } = await supabase
      .from("books")
      .select("*")
      .eq("id", bookId)
      .eq("is_archived", false)
      .maybeSingle();
      
    if (bookError || !bookData) {
      console.error("Error fetching book data for preloading:", bookError);
      return;
    }
    
    // Fetch all pages in a single query
    const { data: pagesData, error: pagesError } = await supabase
      .from("pages")
      .select("*")
      .in("id", pageIds)
      .eq("book_id", bookId)
      .eq("archived", false);
      
    if (pagesError || !pagesData) {
      console.error("Error fetching pages for preloading:", pagesError);
      return;
    }
    
    // Cache each page
    pagesData.forEach(page => {
      pageCache.set(bookId, page.id, page, bookData);
    });
    
    console.log(`Preloaded ${pagesData.length} pages for book ${bookId}`);
  } catch (error) {
    console.error("Error preloading pages:", error);
  }
};

/**
 * Gets the next N page IDs after the current page
 * @param bookId The ID of the book
 * @param currentPageId The ID of the current page
 * @param count Number of pages to get
 * @returns Promise that resolves with an array of page IDs
 */
export const getNextPageIds = async (
  bookId: number, 
  currentPageId: number, 
  count: number = 3
): Promise<number[]> => {
  try {
    // Get all pages in the book
    const { data: pagesData, error } = await supabase
      .from("pages")
      .select("id, page_index")
      .eq("book_id", bookId)
      .eq("archived", false)
      .order("page_index", { ascending: true });
      
    if (error || !pagesData) {
      console.error("Error fetching pages:", error);
      return [];
    }
    
    // Find the current page index
    const currentIndex = pagesData.findIndex(p => p.id === currentPageId);
    if (currentIndex === -1) return [];
    
    // Get the next N page IDs
    const nextPageIds = pagesData
      .slice(currentIndex + 1, currentIndex + 1 + count)
      .map(p => p.id);
      
    return nextPageIds;
  } catch (error) {
    console.error("Error getting next page IDs:", error);
    return [];
  }
}; 