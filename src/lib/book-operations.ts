import { supabase } from '@/integrations/supabase/client';
import { htmlToJson } from '@/utils/tiptapHelpers';
import { Database } from '@/integrations/supabase/types';

type Page = Database['public']['Tables']['pages']['Row'];

export interface BookOperation {
  type: 'add' | 'archive' | 'move' | 'edit';
  pageId?: number;
  newIndex?: number;
  title?: string;
  content?: string;
  oldContent?: string;
  newContent?: string;
}

interface OperationResult {
  success: boolean;
  error?: string;
  pageId?: number;
}

// Type guard to ensure pages have required properties
interface PageWithIndex {
  id: number;
  page_index: number;
  book_id: number;
}

export async function addPage(
  bookId: number,
  afterIndex: number,
  title: string,
  content: string
): Promise<OperationResult> {
  try {
    // Get the next page index
    const { data: pages, error: fetchError } = await supabase
      .from('pages')
      .select('id, page_index')
      .eq('book_id', bookId)
      .eq('archived', false)
      .order('page_index', { ascending: true });

    if (fetchError) throw fetchError;

    // Calculate new page index
    const newPageIndex = afterIndex + 1;

    // Update page indices for pages that come after the new page
    // Use bulk update instead of loop for better performance
    if (pages && pages.length > 0) {
      const pagesToUpdate = pages.filter(p => p.page_index >= newPageIndex);

      if (pagesToUpdate.length > 0) {
        // Batch update using upsert
        const updates = pagesToUpdate.map(page => ({
          id: page.id,
          page_index: page.page_index + 1,
          book_id: bookId
        }));

        const { error: updateError } = await supabase
          .from('pages')
          .upsert(updates);

        if (updateError) throw updateError;
      }
    }

    // Create the new page with JSON content
    const jsonContent = content ? htmlToJson(content) : { type: 'doc', content: [] };

    const { data: newPage, error: insertError } = await supabase
      .from('pages')
      .insert({
        book_id: bookId,
        page_index: newPageIndex,
        title: title,
        content: jsonContent,
        page_type: 'text'
      })
      .select('id')
      .single();

    if (insertError) throw insertError;

    return { success: true, pageId: newPage.id };
  } catch (error) {
    console.error('Error adding page:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to add page' 
    };
  }
}

export async function archivePage(
  pageId: number,
  bookId: number,
  allPages: PageWithIndex[]
): Promise<OperationResult> {
  try {
    // Archive the page
    const { error: archiveError } = await supabase
      .from('pages')
      .update({
        archived: true,
        updated_at: new Date().toISOString()
      })
      .eq('id', pageId);

    if (archiveError) throw archiveError;

    // Get the remaining pages and update their indices (following existing pattern)
    const remainingPages = allPages.filter(page => page.id !== pageId);

    if (remainingPages.length > 0) {
      const updatedPages = remainingPages.map((page, index) => ({
        id: page.id,
        page_index: index,
        book_id: bookId
      }));

      // Update the indices of remaining pages using upsert
      const { error: updateError } = await supabase
        .from('pages')
        .upsert(updatedPages);

      if (updateError) throw updateError;
    }

    return { success: true };
  } catch (error) {
    console.error('Error archiving page:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to archive page'
    };
  }
}

export async function movePage(
  pageId: number,
  newIndex: number,
  bookId: number,
  allPages: PageWithIndex[]
): Promise<OperationResult> {
  try {
    // Find the page to move
    const pageToMove = allPages.find(p => p.id === pageId);
    if (!pageToMove) {
      return { success: false, error: 'Page not found' };
    }

    const currentIndex = pageToMove.page_index;
    if (currentIndex === newIndex) {
      return { success: true }; // No change needed
    }

    // Create new array with the page moved to new position (following existing pattern)
    const newPages = [...allPages];
    const [movedPage] = newPages.splice(currentIndex, 1);
    newPages.splice(newIndex, 0, movedPage);

    // Update all page indices using the two-step upsert approach (like existing reorderPages)
    // First, update all pages to have temporary indices that won't conflict
    const tempUpdates = allPages.map((page, index) => ({
      id: page.id,
      page_index: -(index + 1000), // Use negative numbers to avoid conflicts
      book_id: bookId
    }));

    const { error: tempError } = await supabase
      .from('pages')
      .upsert(tempUpdates);

    if (tempError) throw tempError;

    // Then, update to the final indices
    const finalUpdates = newPages.map((page, index) => ({
      id: page.id,
      page_index: index,
      book_id: bookId
    }));

    const { error } = await supabase
      .from('pages')
      .upsert(finalUpdates);

    if (error) throw error;

    return { success: true };
  } catch (error) {
    console.error('Error moving page:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to move page'
    };
  }
}

export async function editPageContent(
  pageId: number,
  newContent: string
): Promise<OperationResult> {
  try {
    // Convert HTML content to JSON
    const jsonContent = htmlToJson(newContent);

    const { error } = await supabase
      .from('pages')
      .update({
        content: jsonContent,
        updated_at: new Date().toISOString()
      })
      .eq('id', pageId);

    if (error) throw error;

    return { success: true };
  } catch (error) {
    console.error('Error editing page content:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to edit page content'
    };
  }
}

export async function executeBookOperation(
  operation: BookOperation,
  bookId: number,
  allPages: PageWithIndex[] = []
): Promise<OperationResult> {
  switch (operation.type) {
    case 'add':
      if (operation.newIndex === undefined || !operation.title || !operation.content) {
        return { success: false, error: 'Missing required fields for add operation' };
      }
      return await addPage(bookId, operation.newIndex, operation.title, operation.content);

    case 'archive':
      if (!operation.pageId) {
        return { success: false, error: 'Missing pageId for archive operation' };
      }
      return await archivePage(operation.pageId, bookId, allPages);

    case 'move':
      if (!operation.pageId || operation.newIndex === undefined) {
        return { success: false, error: 'Missing required fields for move operation' };
      }
      return await movePage(operation.pageId, operation.newIndex, bookId, allPages);

    case 'edit':
      if (!operation.pageId || !operation.newContent) {
        return { success: false, error: 'Missing required fields for edit operation' };
      }
      return await editPageContent(operation.pageId, operation.newContent);

    default:
      return { success: false, error: 'Unknown operation type' };
  }
}
