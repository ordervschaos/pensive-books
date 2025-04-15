import { useEffect } from 'react';
import { usePagePreloader } from '@/hooks/usePagePreloader';

interface PagePreloaderProps {
  bookId: number;
  pageId: number;
  onPreloaded: (pageId: number) => void;
}

export const PagePreloader = ({ bookId, pageId, onPreloaded }: PagePreloaderProps) => {
  const { preloadedData, isPreloading, error, preloadPage } = usePagePreloader(bookId, pageId);

  // Notify parent component when data is preloaded
  useEffect(() => {
    if (preloadedData.page && preloadedData.book) {
      onPreloaded(pageId);
    }
  }, [preloadedData, pageId, onPreloaded]);

  // This component doesn't render anything visible
  return null;
}; 