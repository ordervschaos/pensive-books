import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { SlugService } from '@/utils/slugService';

interface Page {
  id: number;
  title: string;
  html_content: string;
  page_type: string;
  updated_at: string;
}

interface Book {
  id: number;
  name: string;
  cover_url?: string;
  author?: string;
  published_at?: string;
}

interface PageListItem {
  id: number;
  title: string;
  page_index: number;
}

interface UsePageViewDataReturn {
  page: Page | null;
  setPage: React.Dispatch<React.SetStateAction<Page | null>>;
  book: Book | null;
  allPages: PageListItem[];
  currentIndex: number;
  totalPages: number;
  nextPageId: number | null;
  nextPageTitle: string;
  loading: boolean;
  refetch: () => Promise<void>;
}

/**
 * Custom hook to fetch all data needed for PageView component
 * Handles: page data, book data, all pages list, navigation info
 */
export const usePageViewData = (
  bookId: string | undefined,
  pageId: string | undefined
): UsePageViewDataReturn => {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [page, setPage] = useState<Page | null>(null);
  const [book, setBook] = useState<Book | null>(null);
  const [allPages, setAllPages] = useState<PageListItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [nextPageId, setNextPageId] = useState<number | null>(null);
  const [nextPageTitle, setNextPageTitle] = useState<string>('');
  const [loading, setLoading] = useState(true);

  const numericBookId = SlugService.extractId(bookId);
  const numericPageId = SlugService.extractId(pageId);

  const fetchPageDetails = useCallback(async () => {
    try {
      setLoading(true);

      // 1. Fetch current page data
      const { data: pageData, error: pageError } = await supabase
        .from('pages')
        .select('*')
        .eq('id', numericPageId)
        .eq('book_id', numericBookId)
        .eq('archived', false)
        .maybeSingle();

      if (pageError) throw pageError;
      if (!pageData) {
        console.log('Page not found:', numericPageId);
        return;
      }

      // Auto-redirect to slug URL if needed
      if (pageData && !SlugService.hasSlug(pageId) && pageData.title) {
        const slug = SlugService.generateSlug(numericPageId, pageData.title);
        navigate(`/book/${bookId}/page/${slug}`, { replace: true });
      }

      setPage(pageData);

      // 2. Fetch parent book data
      const { data: bookData, error: bookError } = await supabase
        .from('books')
        .select('*')
        .eq('id', numericBookId)
        .eq('is_archived', false)
        .maybeSingle();

      if (bookError) throw bookError;
      if (!bookData) {
        console.log('Book not found:', numericBookId);
        return;
      }

      // Auto-redirect book to slug URL if needed
      if (bookData && !SlugService.hasSlug(bookId) && bookData.name) {
        const slug = SlugService.generateSlug(numericBookId, bookData.name);
        navigate(`/book/${slug}/page/${pageId}`, { replace: true });
      }

      setBook(bookData);

      // 3. Fetch all pages for navigation
      const { data: pagesData, error: pagesError } = await supabase
        .from('pages')
        .select('id, title, page_index')
        .eq('book_id', numericBookId)
        .eq('archived', false)
        .order('page_index', { ascending: true });

      if (pagesError) throw pagesError;

      setAllPages(pagesData || []);

      // 4. Calculate current position
      const currentPageIndex = pagesData.findIndex(p => p.id === numericPageId);
      setCurrentIndex(currentPageIndex);

      // 5. Get next page info
      if (currentPageIndex < pagesData.length - 1) {
        const nextPage = pagesData[currentPageIndex + 1];
        setNextPageTitle(nextPage.title || '');
        setNextPageId(nextPage.id);
      } else {
        setNextPageTitle('');
        setNextPageId(null);
      }

    } catch (error: unknown) {
      toast({
        variant: 'destructive',
        title: 'Error fetching page details',
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setLoading(false);
    }
  }, [numericBookId, numericPageId, bookId, pageId, navigate, toast]);

  // Fetch data when book/page IDs change
  useEffect(() => {
    fetchPageDetails();
  }, [fetchPageDetails]);

  return {
    page,
    setPage,
    book,
    allPages,
    currentIndex,
    totalPages: allPages.length,
    nextPageId,
    nextPageTitle,
    loading,
    refetch: fetchPageDetails,
  };
};
