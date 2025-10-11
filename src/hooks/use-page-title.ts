import { useEffect } from 'react';
import { setPageTitle } from '@/utils/pageTitle';

/**
 * Custom hook to automatically update browser tab title
 * Updates whenever page or book title changes
 */
export const usePageTitle = (pageTitle?: string, bookName?: string) => {
  useEffect(() => {
    if (pageTitle && bookName) {
      setPageTitle(`${pageTitle} - ${bookName}`);
    }
  }, [pageTitle, bookName]);
};
