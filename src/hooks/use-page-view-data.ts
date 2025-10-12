import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { SlugService } from '@/utils/slugService';

interface Page {
  id: number;
  title: string;
  html_content: string;
  content?: any; // TipTap JSON content
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

  // Use React Query to fetch page data (will use preloaded cache if available)
  const {
    data: pageData,
    isLoading: pageLoading,
    dataUpdatedAt,
    isFetching
  } = useQuery({
    queryKey: ['page', numericPageId, numericBookId],
    queryFn: async () => {
      console.log(`[PageViewData] 🌐 NETWORK REQUEST - Fetching page ${numericPageId} from Supabase`);
      const { data, error } = await supabase
        .from('pages')
        .select('*')
        .eq('id', numericPageId)
        .eq('book_id', numericBookId)
        .eq('archived', false)
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        console.log('Page not found:', numericPageId);
        return null;
      }

      console.log(`[PageViewData] ✓ Page ${numericPageId} fetched from network`);
      return data;
    },
    enabled: !!numericPageId && !!numericBookId,
    staleTime: 5 * 60 * 1000, // Match preloader cache time
    refetchOnMount: false, // Don't refetch if data is in cache
    refetchOnWindowFocus: false, // Don't refetch when window regains focus
    refetchOnReconnect: false, // Don't refetch on reconnect
  });

  // Log cache hit/miss and set page immediately if cached
  useEffect(() => {
    if (pageData && !isFetching) {
      console.log(`[PageViewData] ⚡ CACHE HIT - Page ${numericPageId} loaded instantly from cache!`);
      setPage(pageData);
      setLoading(false); // Clear loading state immediately for cached page
    }
  }, [numericPageId, pageData, isFetching]);

  const fetchPageDetails = useCallback(async () => {
    if (!pageData || pageLoading) return;

    try {
      // Only show loading if we're actually fetching
      if (isFetching) {
        setLoading(true);
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

      setBook(bookData);

      // Auto-redirect to slug URL if needed (do it once with both slugs)
      const needsPageSlug = !SlugService.hasSlug(pageId) && pageData.title;
      const needsBookSlug = !SlugService.hasSlug(bookId) && bookData.name;

      if (needsPageSlug || needsBookSlug) {
        const bookSlug = needsBookSlug
          ? SlugService.generateSlug(numericBookId, bookData.name)
          : bookId;
        const pageSlug = needsPageSlug
          ? SlugService.generateSlug(numericPageId, pageData.title)
          : pageId;

        // Preserve query params (like ?edit=true)
        const searchParams = new URLSearchParams(window.location.search);
        const queryString = searchParams.toString();
        const fullPath = `/book/${bookSlug}/page/${pageSlug}${queryString ? `?${queryString}` : ''}`;

        navigate(fullPath, { replace: true });
      }

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
  }, [numericBookId, numericPageId, bookId, pageId, navigate, toast, pageData, pageLoading]);

  // Fetch data when book/page IDs change OR when pageData becomes available
  useEffect(() => {
    fetchPageDetails();
  }, [fetchPageDetails]);

  // Update loading state based on query loading
  useEffect(() => {
    if (pageLoading) {
      setLoading(true);
    }
  }, [pageLoading]);

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
