import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { SlugService } from '@/utils/slugService';

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
  subtitle?: string;
  published_at?: string;
}

interface PageListItem {
  id: number;
  title: string;
  page_index: number;
}

interface UsePublishedPageDataReturn {
  page: Page | null;
  book: Book | null;
  allPages: PageListItem[];
  currentIndex: number;
  totalPages: number;
  nextPageId: number | null;
  nextPageTitle: string;
  loading: boolean;
  notFound: boolean;
}

/**
 * Custom hook to fetch PUBLISHED content for public readers
 * Fetches from page_versions and book_versions (immutable snapshots)
 */
export const usePublishedPageData = (
  bookId: string | undefined,
  pageId: string | undefined
): UsePublishedPageDataReturn => {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [page, setPage] = useState<Page | null>(null);
  const [book, setBook] = useState<Book | null>(null);
  const [allPages, setAllPages] = useState<PageListItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [nextPageId, setNextPageId] = useState<number | null>(null);
  const [nextPageTitle, setNextPageTitle] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const numericBookId = SlugService.extractId(bookId);
  const numericPageId = SlugService.extractId(pageId);

  // Fetch published book version
  const {
    data: bookData,
    isLoading: bookLoading,
  } = useQuery({
    queryKey: ['published-book', numericBookId],
    queryFn: async () => {
      console.log(`[PublishedPageData] 🌐 Fetching published book ${numericBookId}`);

      // Get book and check if it has a published version
      const { data: bookData, error: bookError } = await supabase
        .from('books')
        .select('id, name, subtitle, author, cover_url, published_version_id, is_public')
        .eq('id', numericBookId)
        .eq('is_archived', false)
        .eq('is_public', true)
        .maybeSingle();

      if (bookError) throw bookError;
      if (!bookData) {
        console.log('Book not found or not public:', numericBookId);
        return null;
      }

      if (!bookData.published_version_id) {
        console.log('Book has no published version:', numericBookId);
        return null;
      }

      // Get published version metadata
      const { data: versionData, error: versionError } = await supabase
        .from('book_versions')
        .select('*')
        .eq('id', bookData.published_version_id)
        .eq('is_published', true)
        .maybeSingle();

      if (versionError) throw versionError;
      if (!versionData) {
        console.log('Published version not found:', bookData.published_version_id);
        return null;
      }

      console.log(`[PublishedPageData] ✓ Found published version ${versionData.version_number}`);

      return {
        book: bookData,
        version: versionData,
      };
    },
    enabled: !!numericBookId,
    staleTime: 5 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  // Fetch published page from page_versions
  const {
    data: pageData,
    isLoading: pageLoading,
  } = useQuery({
    queryKey: ['published-page', numericPageId, numericBookId, bookData?.version?.id],
    queryFn: async () => {
      if (!bookData?.version?.id) return null;

      console.log(`[PublishedPageData] 🌐 Fetching published page ${numericPageId} from version ${bookData.version.id}`);

      const { data, error } = await supabase
        .from('page_versions')
        .select('*')
        .eq('book_version_id', bookData.version.id)
        .eq('page_id', numericPageId)
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        console.log('Page not found in published version:', numericPageId);
        return null;
      }

      console.log(`[PublishedPageData] ✓ Page ${numericPageId} loaded from published version`);
      return data;
    },
    enabled: !!numericPageId && !!bookData?.version?.id,
    staleTime: 10 * 60 * 1000, // Published content can be cached longer
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const fetchPageDetails = useCallback(async () => {
    if (bookLoading || pageLoading) {
      setLoading(true);
      return;
    }

    try {
      // Check if book or page not found
      if (!bookData) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      // Set book data
      setBook({
        id: bookData.book.id,
        name: bookData.version.name,
        subtitle: bookData.version.subtitle,
        author: bookData.version.author,
        cover_url: bookData.version.cover_url,
        published_at: bookData.version.published_at,
      });

      // Fetch all pages in this published version (needed for TOC)
      const { data: pagesData, error: pagesError } = await supabase
        .from('page_versions')
        .select('page_id, title, page_index')
        .eq('book_version_id', bookData.version.id)
        .order('page_index', { ascending: true });

      if (pagesError) throw pagesError;

      const pages = (pagesData || []).map(pv => ({
        id: pv.page_id || 0,
        title: pv.title || 'Untitled',
        page_index: pv.page_index,
      }));

      setAllPages(pages);

      // If no pageId provided, we're just viewing book details
      if (!pageId) {
        setLoading(false);
        return;
      }

      // Check if page not found
      if (!pageData) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      // Set page data (convert from page_versions format to page format)
      setPage({
        id: pageData.page_id || numericPageId,
        title: pageData.title || 'Untitled',
        content: pageData.content,
        page_type: pageData.page_type || 'text',
        updated_at: bookData.version.published_at || bookData.version.committed_at,
      });

      // Auto-redirect to slug URL if needed
      const needsPageSlug = !SlugService.hasSlug(pageId) && pageData.title;
      const needsBookSlug = !SlugService.hasSlug(bookId) && bookData.version.name;

      if (needsPageSlug || needsBookSlug) {
        const bookSlug = needsBookSlug
          ? SlugService.generateSlug(numericBookId, bookData.version.name)
          : bookId;
        const pageSlug = needsPageSlug
          ? SlugService.generateSlug(numericPageId, pageData.title)
          : pageId;

        navigate(`/library/book/${bookSlug}/page/${pageSlug}`, { replace: true });
      }

      // Calculate current position (only when viewing a specific page)
      const currentPageIndex = pages.findIndex(p => p.id === numericPageId);
      setCurrentIndex(currentPageIndex);

      // Get next page info
      if (currentPageIndex < pages.length - 1) {
        const nextPage = pages[currentPageIndex + 1];
        setNextPageTitle(nextPage.title || '');
        setNextPageId(nextPage.id);
      } else {
        setNextPageTitle('');
        setNextPageId(null);
      }

    } catch (error: unknown) {
      console.error('[PublishedPageData] Error:', error);
      toast({
        variant: 'destructive',
        title: 'Error loading published content',
        description: error instanceof Error ? error.message : 'Unknown error',
      });
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [numericBookId, numericPageId, bookId, pageId, navigate, toast, bookData, pageData, bookLoading, pageLoading]);

  useEffect(() => {
    fetchPageDetails();
  }, [fetchPageDetails]);

  return {
    page,
    book,
    allPages,
    currentIndex,
    totalPages: allPages.length,
    nextPageId,
    nextPageTitle,
    loading,
    notFound,
  };
};
