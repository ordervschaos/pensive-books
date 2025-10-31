import { useState, useMemo, useCallback, useEffect } from 'react';

export type FilterType = 'all' | 'published' | 'private' | 'pinned';
export type SortType = 'recently-updated' | 'recently-created' | 'alphabetical-az' | 'alphabetical-za' | 'most-pages';

interface Book {
  id: number;
  name: string;
  subtitle?: string | null;
  author?: string | null;
  cover_url?: string | null;
  is_public: boolean;
  is_archived: boolean;
  pinned?: boolean | null;
  created_at: string;
  updated_at: string;
  owner_id?: string;
  access_level?: string;
  page_count?: number; // Added for sorting by most pages
}

export function useBookFilters(books: Book[], sharedBooks: Book[] = []) {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');
  const [sortType, setSortType] = useState<SortType>('recently-updated');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Combine all books (owned + shared)
  const allBooks = useMemo(() => {
    return [...books, ...sharedBooks];
  }, [books, sharedBooks]);

  // Apply filters
  const filteredBooks = useMemo(() => {
    let filtered = [...allBooks];

    // Apply filter type
    switch (activeFilter) {
      case 'published':
        filtered = filtered.filter(book => book.is_public === true);
        break;
      case 'private':
        filtered = filtered.filter(book => book.is_public === false && !book.access_level);
        break;
      case 'pinned':
        filtered = filtered.filter(book => book.pinned === true);
        break;
      case 'all':
      default:
        // No filter
        break;
    }

    // Apply search query (case-insensitive)
    if (debouncedSearchQuery.trim()) {
      const query = debouncedSearchQuery.toLowerCase();
      filtered = filtered.filter(book => {
        const name = (book.name || '').toLowerCase();
        const subtitle = (book.subtitle || '').toLowerCase();
        const author = (book.author || '').toLowerCase();
        return name.includes(query) || subtitle.includes(query) || author.includes(query);
      });
    }

    return filtered;
  }, [allBooks, activeFilter, debouncedSearchQuery]);

  // Apply sorting (pinned books always at top, except when filtering by pinned)
  const sortedBooks = useMemo(() => {
    const sorted = [...filteredBooks];

    // Separate pinned and unpinned books (unless filtering by pinned)
    if (activeFilter !== 'pinned') {
      const pinned = sorted.filter(book => book.pinned === true);
      const unpinned = sorted.filter(book => book.pinned !== true);

      // Sort each group separately
      const sortFn = (a: Book, b: Book) => {
        switch (sortType) {
          case 'recently-updated':
            const dateA = new Date(a.updated_at || a.created_at || 0).getTime();
            const dateB = new Date(b.updated_at || b.created_at || 0).getTime();
            return dateB - dateA;
          case 'recently-created':
            const createdA = new Date(a.created_at || 0).getTime();
            const createdB = new Date(b.created_at || 0).getTime();
            return createdB - createdA;
          case 'alphabetical-az':
            const nameA = (a.name || '').toLowerCase();
            const nameB = (b.name || '').toLowerCase();
            return nameA.localeCompare(nameB);
          case 'alphabetical-za':
            const nameZA = (a.name || '').toLowerCase();
            const nameZB = (b.name || '').toLowerCase();
            return nameZB.localeCompare(nameZA);
          case 'most-pages':
            // Sort by page count (descending), fallback to recently updated if page_count not available
            const countA = (a.page_count ?? 0);
            const countB = (b.page_count ?? 0);
            if (countA !== countB) {
              return countB - countA; // Descending order
            }
            // If page counts are equal, sort by recently updated
            const datePA = new Date(a.updated_at || a.created_at || 0).getTime();
            const datePB = new Date(b.updated_at || b.created_at || 0).getTime();
            return datePB - datePA;
          default:
            return 0;
        }
      };

      pinned.sort(sortFn);
      unpinned.sort(sortFn);

      return [...pinned, ...unpinned];
    } else {
      // When filtering by pinned, just sort normally
      switch (sortType) {
        case 'recently-updated':
          sorted.sort((a, b) => {
            const dateA = new Date(a.updated_at || a.created_at || 0).getTime();
            const dateB = new Date(b.updated_at || b.created_at || 0).getTime();
            return dateB - dateA;
          });
          break;
        case 'recently-created':
          sorted.sort((a, b) => {
            const dateA = new Date(a.created_at || 0).getTime();
            const dateB = new Date(b.created_at || 0).getTime();
            return dateB - dateA;
          });
          break;
        case 'alphabetical-az':
          sorted.sort((a, b) => {
            const nameA = (a.name || '').toLowerCase();
            const nameB = (b.name || '').toLowerCase();
            return nameA.localeCompare(nameB);
          });
          break;
        case 'alphabetical-za':
          sorted.sort((a, b) => {
            const nameA = (a.name || '').toLowerCase();
            const nameB = (b.name || '').toLowerCase();
            return nameB.localeCompare(nameA);
          });
          break;
        case 'most-pages':
          // Sort by page count (descending), fallback to recently updated if page_count not available
          sorted.sort((a, b) => {
            const countA = (a.page_count ?? 0);
            const countB = (b.page_count ?? 0);
            if (countA !== countB) {
              return countB - countA; // Descending order
            }
            // If page counts are equal, sort by recently updated
            const dateA = new Date(a.updated_at || a.created_at || 0).getTime();
            const dateB = new Date(b.updated_at || b.created_at || 0).getTime();
            return dateB - dateA;
          });
          break;
      }
    }

    return sorted;
  }, [filteredBooks, sortType, activeFilter]);

  // Get filter counts
  const filterCounts = useMemo(() => {
    const published = allBooks.filter(book => book.is_public === true).length;
    const private_ = allBooks.filter(book => book.is_public === false && !book.access_level).length;
    const pinned = allBooks.filter(book => book.pinned === true).length;

    return { published, private: private_, pinned, all: allBooks.length };
  }, [allBooks]);

  const clearSearch = useCallback(() => {
    setSearchQuery('');
    setDebouncedSearchQuery('');
  }, []);

  return {
    searchQuery,
    setSearchQuery,
    activeFilter,
    setActiveFilter,
    sortType,
    setSortType,
    filteredAndSortedBooks: sortedBooks,
    filterCounts,
    clearSearch,
  };
}

