import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { SlugService } from '@/utils/slugService';
import { READER_PAGE_COLUMNS } from '@/lib/pageColumns';

interface Page {
  id: number;
  title: string;
  content: any; // TipTap JSON content
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
  page_type?: 'text' | 'section';
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
      const { data, error } = await supabase
        .from('pages')
        .select(READER_PAGE_COLUMNS) // excludes author-only `metadata`; fetched separately when canEdit
        .eq('id', numericPageId)
        .eq('book_id', numericBookId)
        .eq('archived', false)
        .maybeSingle();

      if (error) throw error;
      if (!data) return null;

      return data;
    },
    enabled: !!numericPageId && !!numericBookId,
    staleTime: 5 * 60 * 1000, // Match preloader cache time
    refetchOnMount: false, // Don't refetch if data is in cache
    refetchOnWindowFocus: false, // Don't refetch when window regains focus
    refetchOnReconnect: false, // Don't refetch on reconnect
    refetchInterval: false, // CRITICAL: Disable automatic background refetching to prevent editor remounts
  });

  // Set page data as soon as it's available
  useEffect(() => {
    if (pageData) {
      setPage(pageData);
    }
  }, [numericPageId, pageData, isFetching, dataUpdatedAt, pageLoading]);

  const fetchPageDetails = useCallback(async () => {
    // CRITICAL: pageData is from closure and might be stale, so we need to check it
    // The useEffect checks pageData before calling this, but the closure value might differ
    // We use optional chaining when accessing pageData properties to be safe


    try {
      // Fetch parent book data. Explicit column list keeps the author-only
      // `brief` column off the wire on the reader path.
      const { data: bookData, error: bookError } = await supabase
        .from('books')
        .select('id, name, slug, cover_url, author, subtitle, published_at, is_public, is_archived, owner_id, show_text_on_cover')
        .eq('id', numericBookId)
        .eq('is_archived', false)
        .maybeSingle();

      if (bookError) throw bookError;
      if (!bookData) return;

      setBook(bookData);

      // Auto-redirect to slug URL if needed (do it once with both slugs)
      // Note: pageData is from closure, so we need to check if it exists
      const needsPageSlug = !SlugService.hasSlug(pageId) && pageData?.title;
      const needsBookSlug = !SlugService.hasSlug(bookId) && bookData.name;

      if (needsPageSlug || needsBookSlug) {
        const bookSlug = needsBookSlug
          ? SlugService.generateSlug(numericBookId, bookData.name)
          : bookId;
        const pageSlug = needsPageSlug && pageData?.title
          ? SlugService.generateSlug(numericPageId, pageData.title)
          : pageId;

        // Preserve query params (like ?edit=true)
        const searchParams = new URLSearchParams(window.location.search);
        const queryString = searchParams.toString();
        const fullPath = `/books/${bookSlug}/pages/${pageSlug}${queryString ? `?${queryString}` : ''}`;

        navigate(fullPath, { replace: true });
      }

      // Fetch all pages for navigation
      const { data: pagesData, error: pagesError } = await supabase
        .from('pages')
        .select('id, title, page_index, page_type')
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
    // CRITICAL FIX: Remove pageData and pageLoading from dependencies
    // They are checked inside the function, but including them as dependencies
    // causes infinite loop: pageData changes -> callback recreates -> useEffect triggers -> loop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numericBookId, numericPageId, bookId, pageId, navigate, toast]);

  // Fetch data when book/page IDs change OR when pageData becomes available
  // Include pageData here (not in fetchPageDetails dependencies) to trigger when data arrives
  // but prevent infinite loop by keeping it out of the callback dependencies
  useEffect(() => {
    if (!pageData) return;
    fetchPageDetails();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numericBookId, numericPageId, pageData]);

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
