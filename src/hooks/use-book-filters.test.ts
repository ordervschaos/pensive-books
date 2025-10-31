import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBookFilters, SortType } from './use-book-filters';

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
  page_count?: number;
}

const mockBooks: Book[] = [
  {
    id: 1,
    name: 'Book One',
    subtitle: 'Subtitle One',
    author: 'Author One',
    is_public: true,
    is_archived: false,
    pinned: true,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-10T00:00:00Z',
    page_count: 10,
  },
  {
    id: 2,
    name: 'Book Two',
    subtitle: 'Subtitle Two',
    author: 'Author Two',
    is_public: false,
    is_archived: false,
    pinned: false,
    created_at: '2024-01-02T00:00:00Z',
    updated_at: '2024-01-09T00:00:00Z',
    page_count: 5,
  },
  {
    id: 3,
    name: 'Published Book',
    subtitle: null,
    author: null,
    is_public: true,
    is_archived: false,
    pinned: false,
    created_at: '2024-01-03T00:00:00Z',
    updated_at: '2024-01-08T00:00:00Z',
    page_count: 15,
  },
  {
    id: 4,
    name: 'Another Book',
    subtitle: 'Different Subtitle',
    author: 'Another Author',
    is_public: false,
    is_archived: false,
    pinned: true,
    created_at: '2024-01-04T00:00:00Z',
    updated_at: '2024-01-11T00:00:00Z',
    page_count: 20,
  },
];

const mockSharedBooks: Book[] = [
  {
    id: 5,
    name: 'Shared Book',
    subtitle: null,
    author: null,
    is_public: false,
    is_archived: false,
    pinned: false,
    created_at: '2024-01-05T00:00:00Z',
    updated_at: '2024-01-07T00:00:00Z',
    access_level: 'edit',
    page_count: 8,
  },
];

describe('useBookFilters', () => {
  beforeEach(() => {
    // Reset timers if needed
  });

  it('should combine owned and shared books', () => {
    const { result } = renderHook(() => useBookFilters(mockBooks, mockSharedBooks));
    
    expect(result.current.filterCounts.all).toBe(5);
    expect(result.current.filteredAndSortedBooks.length).toBe(5);
  });

  it('should filter by published books', () => {
    const { result } = renderHook(() => useBookFilters(mockBooks, mockSharedBooks));
    
    act(() => {
      result.current.setActiveFilter('published');
    });

    expect(result.current.filterCounts.published).toBe(2);
    expect(result.current.filteredAndSortedBooks.every(book => book.is_public)).toBe(true);
  });

  it('should filter by private books', () => {
    const { result } = renderHook(() => useBookFilters(mockBooks, mockSharedBooks));
    
    act(() => {
      result.current.setActiveFilter('private');
    });

    const filtered = result.current.filteredAndSortedBooks;
    expect(filtered.every(book => book.is_public === false && !book.access_level)).toBe(true);
  });


  it('should filter by pinned books', () => {
    const { result } = renderHook(() => useBookFilters(mockBooks, mockSharedBooks));
    
    act(() => {
      result.current.setActiveFilter('pinned');
    });

    expect(result.current.filterCounts.pinned).toBe(2);
    expect(result.current.filteredAndSortedBooks.every(book => book.pinned === true)).toBe(true);
  });

  it('should search books by name', async () => {
    const { result } = renderHook(() => useBookFilters(mockBooks, mockSharedBooks));
    
    act(() => {
      result.current.setSearchQuery('Book One');
    });

    // Wait for debounce
    await new Promise(resolve => setTimeout(resolve, 350));

    expect(result.current.filteredAndSortedBooks.length).toBe(1);
    expect(result.current.filteredAndSortedBooks[0].name).toBe('Book One');
  });

  it('should search books by subtitle', async () => {
    const { result } = renderHook(() => useBookFilters(mockBooks, mockSharedBooks));
    
    act(() => {
      result.current.setSearchQuery('Different');
    });

    await new Promise(resolve => setTimeout(resolve, 350));

    expect(result.current.filteredAndSortedBooks.length).toBe(1);
    expect(result.current.filteredAndSortedBooks[0].subtitle).toBe('Different Subtitle');
  });

  it('should search books by author', async () => {
    const { result } = renderHook(() => useBookFilters(mockBooks, mockSharedBooks));
    
    act(() => {
      result.current.setSearchQuery('Author One');
    });

    await new Promise(resolve => setTimeout(resolve, 350));

    expect(result.current.filteredAndSortedBooks.length).toBe(1);
    expect(result.current.filteredAndSortedBooks[0].author).toBe('Author One');
  });

  it('should handle case-insensitive search', async () => {
    const { result } = renderHook(() => useBookFilters(mockBooks, mockSharedBooks));
    
    act(() => {
      result.current.setSearchQuery('book one');
    });

    await new Promise(resolve => setTimeout(resolve, 350));

    expect(result.current.filteredAndSortedBooks.length).toBe(1);
    expect(result.current.filteredAndSortedBooks[0].name).toBe('Book One');
  });

  it('should clear search', async () => {
    const { result } = renderHook(() => useBookFilters(mockBooks, mockSharedBooks));
    
    act(() => {
      result.current.setSearchQuery('Book One');
    });

    await new Promise(resolve => setTimeout(resolve, 350));
    expect(result.current.filteredAndSortedBooks.length).toBe(1);

    act(() => {
      result.current.clearSearch();
    });

    await new Promise(resolve => setTimeout(resolve, 350));
    expect(result.current.searchQuery).toBe('');
    expect(result.current.filteredAndSortedBooks.length).toBe(5);
  });

  it('should sort by recently updated', () => {
    const { result } = renderHook(() => useBookFilters(mockBooks, mockSharedBooks));
    
    act(() => {
      result.current.setSortType('recently-updated');
    });

    const sorted = result.current.filteredAndSortedBooks;
    // Pinned books should be first
    expect(sorted[0].pinned).toBe(true);
    expect(sorted[1].pinned).toBe(true);
    
    // Then unpinned books sorted by updated_at
    const unpinned = sorted.filter(b => !b.pinned);
    for (let i = 0; i < unpinned.length - 1; i++) {
      const dateA = new Date(unpinned[i].updated_at).getTime();
      const dateB = new Date(unpinned[i + 1].updated_at).getTime();
      expect(dateA).toBeGreaterThanOrEqual(dateB);
    }
  });

  it('should sort by recently created', () => {
    const { result } = renderHook(() => useBookFilters(mockBooks, mockSharedBooks));
    
    act(() => {
      result.current.setSortType('recently-created');
    });

    const sorted = result.current.filteredAndSortedBooks;
    // Pinned books should be first
    const pinned = sorted.filter(b => b.pinned);
    const unpinned = sorted.filter(b => !b.pinned);
    
    // Pinned books sorted by created_at
    for (let i = 0; i < pinned.length - 1; i++) {
      const dateA = new Date(pinned[i].created_at).getTime();
      const dateB = new Date(pinned[i + 1].created_at).getTime();
      expect(dateA).toBeGreaterThanOrEqual(dateB);
    }
  });

  it('should sort alphabetically A-Z', () => {
    const { result } = renderHook(() => useBookFilters(mockBooks, mockSharedBooks));
    
    act(() => {
      result.current.setSortType('alphabetical-az');
    });

    const sorted = result.current.filteredAndSortedBooks;
    // Pinned books should be first
    const pinned = sorted.filter(b => b.pinned);
    const unpinned = sorted.filter(b => !b.pinned);
    
    // Check pinned books are sorted A-Z
    for (let i = 0; i < pinned.length - 1; i++) {
      const nameA = (pinned[i].name || '').toLowerCase();
      const nameB = (pinned[i + 1].name || '').toLowerCase();
      expect(nameA <= nameB).toBe(true);
    }
    
    // Check unpinned books are sorted A-Z
    for (let i = 0; i < unpinned.length - 1; i++) {
      const nameA = (unpinned[i].name || '').toLowerCase();
      const nameB = (unpinned[i + 1].name || '').toLowerCase();
      expect(nameA <= nameB).toBe(true);
    }
  });

  it('should sort by most pages', () => {
    const { result } = renderHook(() => useBookFilters(mockBooks, mockSharedBooks));
    
    act(() => {
      result.current.setSortType('most-pages');
    });

    const sorted = result.current.filteredAndSortedBooks;
    // Pinned books should be first, sorted by page count
    const pinned = sorted.filter(b => b.pinned);
    const unpinned = sorted.filter(b => !b.pinned);
    
    // Check pinned books are sorted by page count (descending)
    expect(pinned[0].page_count).toBeGreaterThanOrEqual(pinned[1]?.page_count ?? 0);
    
    // Check unpinned books are sorted by page count (descending)
    for (let i = 0; i < unpinned.length - 1; i++) {
      const countA = unpinned[i].page_count ?? 0;
      const countB = unpinned[i + 1].page_count ?? 0;
      expect(countA).toBeGreaterThanOrEqual(countB);
    }
  });

  it('should prioritize pinned books at top when not filtering by pinned', () => {
    const { result } = renderHook(() => useBookFilters(mockBooks, mockSharedBooks));
    
    act(() => {
      result.current.setActiveFilter('all');
      result.current.setSortType('recently-updated');
    });

    const sorted = result.current.filteredAndSortedBooks;
    const pinnedCount = sorted.filter(b => b.pinned).length;
    
    // First N books should be pinned
    expect(sorted.slice(0, pinnedCount).every(b => b.pinned)).toBe(true);
    // Remaining books should not be pinned
    expect(sorted.slice(pinnedCount).every(b => !b.pinned)).toBe(true);
  });

  it('should not prioritize pinned books when filtering by pinned', () => {
    const { result } = renderHook(() => useBookFilters(mockBooks, mockSharedBooks));
    
    act(() => {
      result.current.setActiveFilter('pinned');
      result.current.setSortType('recently-updated');
    });

    const sorted = result.current.filteredAndSortedBooks;
    // All books should be pinned
    expect(sorted.every(b => b.pinned)).toBe(true);
    // Should be sorted normally (not double-prioritized)
    expect(sorted.length).toBe(2);
  });

  it('should calculate filter counts correctly', () => {
    const { result } = renderHook(() => useBookFilters(mockBooks, mockSharedBooks));
    
    expect(result.current.filterCounts.all).toBe(5);
    expect(result.current.filterCounts.published).toBe(2);
    expect(result.current.filterCounts.private).toBe(2);
    expect(result.current.filterCounts.pinned).toBe(2);
  });

  it('should combine search and filter', async () => {
    const { result } = renderHook(() => useBookFilters(mockBooks, mockSharedBooks));
    
    act(() => {
      result.current.setActiveFilter('published');
      result.current.setSearchQuery('Book');
    });

    await new Promise(resolve => setTimeout(resolve, 350));

    const filtered = result.current.filteredAndSortedBooks;
    expect(filtered.every(book => book.is_public)).toBe(true);
    expect(filtered.every(book => 
      book.name.toLowerCase().includes('book') ||
      book.subtitle?.toLowerCase().includes('book') ||
      book.author?.toLowerCase().includes('book')
    )).toBe(true);
  });

  it('should include shared books in All filter', () => {
    const { result } = renderHook(() => useBookFilters(mockBooks, mockSharedBooks));
    
    act(() => {
      result.current.setActiveFilter('all');
    });

    const filtered = result.current.filteredAndSortedBooks;
    expect(filtered.length).toBe(5); // All books including shared
    expect(filtered.some(book => book.access_level === 'edit')).toBe(true);
  });
});

