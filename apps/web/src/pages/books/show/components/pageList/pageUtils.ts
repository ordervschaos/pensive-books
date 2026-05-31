import { supabase } from "@/integrations/supabase/client";
import { Page, LOCALSTORAGE_BOOKMARKS_KEY } from "./types";
import { toast } from "@/components/ui/use-toast";
import { getWordCountFromContent } from "@/utils/tiptapHelpers";

export type PageStatus = "written" | "objective" | "blank";

// Body text excluding the leading title heading — so a page that's only a title still
// reads as "not written" (mirrors WriteAllPages / BuildWithAI).
function bodyText(content: unknown): string {
  if (!content || typeof content !== "object")
    return typeof content === "string" ? content : "";
  const doc = content as { content?: Array<Record<string, unknown>> };
  if (!Array.isArray(doc.content)) return "";
  const nodes = doc.content[0]?.type === "heading" ? doc.content.slice(1) : doc.content;
  const walk = (n: Record<string, unknown>): string =>
    n.type === "text"
      ? String(n.text ?? "")
      : ((n.content as Array<Record<string, unknown>>) ?? []).map(walk).join("");
  return nodes.map(walk).join("").trim();
}

/** The stage a text page is at: blank → objective set → written. */
export const getPageStatus = (page: Page): PageStatus => {
  if (bodyText(page.content)) return "written";
  if (page.metadata?.objective) return "objective";
  return "blank";
};

/** Word count shown for a page — only counts once there's real prose, else 0. */
export const getPageWords = (page: Page): number =>
  bodyText(page.content) ? getWordCountFromContent(page.content) : 0;

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
      const bookmarkData = bookmarks[bookId];
      
      // Handle both old format (just number) and new format ({ pageIndex, timestamp })
      if (typeof bookmarkData === 'number') {
        return bookmarkData;
      } else if (bookmarkData && typeof bookmarkData === 'object') {
        return bookmarkData.pageIndex ?? null;
      }
      return null;
    } else {
      const storedBookmarks = localStorage.getItem(LOCALSTORAGE_BOOKMARKS_KEY);
      const bookmarks = storedBookmarks ? JSON.parse(storedBookmarks) : {};
      const bookmarkData = bookmarks[bookId];
      
      // Handle both old format (just number) and new format ({ pageIndex, timestamp })
      if (typeof bookmarkData === 'number') {
        return bookmarkData;
      } else if (bookmarkData && typeof bookmarkData === 'object') {
        return bookmarkData.pageIndex ?? null;
      }
      return null;
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
  const maxAttempts = 10;
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
        content: { type: 'doc', content: [] },  // Empty TipTap document
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

    const { error: tempError } = await supabase
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
