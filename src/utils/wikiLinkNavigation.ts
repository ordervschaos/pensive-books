import { supabase } from '@/integrations/supabase/client';
import { SlugService } from './slugService';

export interface WikiLinkNavigationOptions {
  bookId: number;
  onNavigate: (pageId: string) => void;
  onError?: (message: string) => void;
}

/**
 * Looks up a page by title within a book and navigates to it
 */
export async function navigateToPageByTitle(
  pageTitle: string,
  options: WikiLinkNavigationOptions
): Promise<void> {
  const { bookId, onNavigate, onError } = options;

  try {
    // Query for the page with this title in the current book
    const { data: pages, error } = await supabase
      .from('pages')
      .select('id, title, slug')
      .eq('book_id', bookId)
      .eq('archived', false)
      .ilike('title', pageTitle.trim()) // Case-insensitive match
      .limit(1);

    if (error) {
      console.error('Error looking up wiki-link page:', error);
      onError?.(`Failed to find page: ${pageTitle}`);
      return;
    }

    if (!pages || pages.length === 0) {
      onError?.(`Page not found: "${pageTitle}"`);
      return;
    }

    const page = pages[0];
    // Create a slug-based ID for the URL
    const slugBasedId = SlugService.createSlugId(page.id, page.slug || page.title);
    onNavigate(slugBasedId);
  } catch (err) {
    console.error('Error in wiki-link navigation:', err);
    onError?.(`Error navigating to page: ${pageTitle}`);
  }
}

/**
 * Creates a wiki-link navigation handler for the TipTap editor
 */
export function createWikiLinkNavigationHandler(
  bookId: number,
  navigate: (pageId: string) => void,
  showToast: (options: { title: string; description?: string; variant?: 'default' | 'destructive' }) => void
) {
  return (pageTitle: string, _bookId: number) => {
    navigateToPageByTitle(pageTitle, {
      bookId,
      onNavigate: navigate,
      onError: (message) => {
        showToast({
          title: 'Page not found',
          description: message,
          variant: 'destructive',
        });
      },
    });
  };
}
