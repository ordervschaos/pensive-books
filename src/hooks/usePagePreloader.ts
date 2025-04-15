import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface Page {
  id: number;
  title: string;
  html_content: string;
  page_index: number;
  book_id: number;
  archived: boolean;
}

interface Book {
  id: number;
  name: string;
  is_archived: boolean;
}

interface PreloadedData {
  page: Page | null;
  book: Book | null;
}

export const usePagePreloader = (bookId: number, pageId: number) => {
  const [preloadedData, setPreloadedData] = useState<PreloadedData>({ page: null, book: null });
  const [isPreloading, setIsPreloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preloadPage = async (targetBookId: number, targetPageId: number) => {
    if (isPreloading) return;
    
    try {
      setIsPreloading(true);
      setError(null);
      
      // Fetch page data
      const { data: pageData, error: pageError } = await supabase
        .from("pages")
        .select("*")
        .eq("id", targetPageId)
        .eq("book_id", targetBookId)
        .eq("archived", false)
        .maybeSingle();

      if (pageError) throw pageError;
      if (!pageData) {
        setError("Page not found");
        return;
      }
      
      // Fetch book data
      const { data: bookData, error: bookError } = await supabase
        .from("books")
        .select("*")
        .eq("id", targetBookId)
        .eq("is_archived", false)
        .maybeSingle();

      if (bookError) throw bookError;
      if (!bookData) {
        setError("Book not found");
        return;
      }
      
      setPreloadedData({
        page: pageData,
        book: bookData
      });
    } catch (err: any) {
      setError(err.message || "Error preloading page");
    } finally {
      setIsPreloading(false);
    }
  };

  // Preload the specified page
  useEffect(() => {
    if (bookId && pageId) {
      preloadPage(bookId, pageId);
    }
  }, [bookId, pageId]);

  return {
    preloadedData,
    isPreloading,
    error,
    preloadPage
  };
}; 