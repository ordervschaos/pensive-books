import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useBookmarkTracking } from './use-bookmark-tracking';

// Mock dependencies
const mockToast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({
    toast: mockToast,
  }),
}));

vi.mock('@/integrations/supabase/client', () => {
  const mockGetSession = vi.fn();
  const mockSelect = vi.fn();
  const mockUpdate = vi.fn();

  return {
    supabase: {
      auth: {
        getSession: mockGetSession,
      },
      from: vi.fn(() => ({
        select: mockSelect,
        update: mockUpdate,
      })),
    },
    // Export mocks for test access
    __mockGetSession: mockGetSession,
    __mockSelect: mockSelect,
    __mockUpdate: mockUpdate,
  };
});

describe('useBookmarkTracking', () => {
  let mockGetSession: any;
  let mockSelect: any;
  let mockUpdate: any;

  beforeEach(async () => {
    const supabaseMock = await import('@/integrations/supabase/client');
    mockGetSession = (supabaseMock as any).__mockGetSession;
    mockSelect = (supabaseMock as any).__mockSelect;
    mockUpdate = (supabaseMock as any).__mockUpdate;

    vi.clearAllMocks();
    // Clear localStorage
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('authenticated user', () => {
    beforeEach(() => {
      mockGetSession.mockResolvedValue({
        data: {
          session: {
            user: { id: 'user-123' },
          },
        },
      });

      mockSelect.mockReturnValue({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(() =>
            Promise.resolve({
              data: { bookmarked_pages: {} },
              error: null,
            })
          ),
        })),
      });

      mockUpdate.mockReturnValue({
        eq: vi.fn(() => Promise.resolve({ error: null })),
      });
    });

    it('should save bookmark to database for authenticated user', async () => {
      const { supabase } = await import('@/integrations/supabase/client');
      renderHook(() => useBookmarkTracking(123, 5));

      await waitFor(() => {
        expect(supabase.from).toHaveBeenCalledWith('user_data');
        expect(mockUpdate).toHaveBeenCalledWith(
          expect.objectContaining({
            bookmarked_pages: { '123': 5 },
          })
        );
      });
    });

    it('should merge with existing bookmarks', async () => {
      mockSelect.mockReturnValueOnce({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(() =>
            Promise.resolve({
              data: { bookmarked_pages: { '100': 2, '200': 3 } },
              error: null,
            })
          ),
        })),
      });

      renderHook(() => useBookmarkTracking(123, 5));

      await waitFor(() => {
        expect(mockUpdate).toHaveBeenCalledWith(
          expect.objectContaining({
            bookmarked_pages: { '100': 2, '200': 3, '123': 5 },
          })
        );
      });
    });

    it('should update existing bookmark for same book', async () => {
      mockSelect.mockReturnValueOnce({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(() =>
            Promise.resolve({
              data: { bookmarked_pages: { '123': 2 } },
              error: null,
            })
          ),
        })),
      });

      renderHook(() => useBookmarkTracking(123, 5));

      await waitFor(() => {
        expect(mockUpdate).toHaveBeenCalledWith(
          expect.objectContaining({
            bookmarked_pages: { '123': 5 },
          })
        );
      });
    });

    it('should handle database errors gracefully', async () => {
      mockSelect.mockReturnValueOnce({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(() =>
            Promise.resolve({
              data: null,
              error: new Error('Database error'),
            })
          ),
        })),
      });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      renderHook(() => useBookmarkTracking(123, 5));

      await waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith('Error updating bookmark:', expect.any(Error));
      });

      consoleSpy.mockRestore();
    });

    it('should update bookmark when pageIndex changes', async () => {
      const { rerender } = renderHook(
        ({ bookId, pageIndex }) => useBookmarkTracking(bookId, pageIndex),
        { initialProps: { bookId: 123, pageIndex: 0 } }
      );

      await waitFor(() => {
        expect(mockUpdate).toHaveBeenCalledWith(
          expect.objectContaining({
            bookmarked_pages: { '123': 0 },
          })
        );
      });

      vi.clearAllMocks();

      rerender({ bookId: 123, pageIndex: 5 });

      await waitFor(() => {
        expect(mockUpdate).toHaveBeenCalledWith(
          expect.objectContaining({
            bookmarked_pages: { '123': 5 },
          })
        );
      });
    });
  });

  describe('anonymous user', () => {
    beforeEach(() => {
      mockGetSession.mockResolvedValue({
        data: { session: null },
      });
    });

    it('should save bookmark to localStorage for anonymous user', async () => {
      renderHook(() => useBookmarkTracking(123, 5));

      await waitFor(() => {
        const stored = localStorage.getItem('bookmarked_pages');
        expect(stored).toBeTruthy();
        const bookmarks = JSON.parse(stored!);
        expect(bookmarks).toEqual({ '123': 5 });
      });
    });

    it('should merge with existing localStorage bookmarks', async () => {
      localStorage.setItem('bookmarked_pages', JSON.stringify({ '100': 2 }));

      renderHook(() => useBookmarkTracking(123, 5));

      await waitFor(() => {
        const stored = localStorage.getItem('bookmarked_pages');
        const bookmarks = JSON.parse(stored!);
        expect(bookmarks).toEqual({ '100': 2, '123': 5 });
      });
    });

    it('should handle corrupted localStorage data', async () => {
      localStorage.setItem('bookmarked_pages', 'invalid-json');

      expect(() => {
        renderHook(() => useBookmarkTracking(123, 5));
      }).not.toThrow();
    });

    it('should not call database for anonymous user', async () => {
      renderHook(() => useBookmarkTracking(123, 5));

      await waitFor(() => {
        expect(localStorage.getItem('bookmarked_pages')).toBeTruthy();
      });

      const { supabase } = await import('@/integrations/supabase/client');
      expect(supabase.from).not.toHaveBeenCalledWith('user_data');
    });
  });

  describe('edge cases', () => {
    it('should not update bookmark for negative page index', async () => {
      mockGetSession.mockResolvedValue({
        data: { session: null },
      });

      renderHook(() => useBookmarkTracking(123, -1));

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(localStorage.getItem('bookmarked_pages')).toBeNull();
    });

    it('should handle bookmark for page index 0', async () => {
      mockGetSession.mockResolvedValue({
        data: { session: null },
      });

      renderHook(() => useBookmarkTracking(123, 0));

      await waitFor(() => {
        const stored = localStorage.getItem('bookmarked_pages');
        const bookmarks = JSON.parse(stored!);
        expect(bookmarks).toEqual({ '123': 0 });
      });
    });

    it('should return updateBookmark function', () => {
      mockGetSession.mockResolvedValue({
        data: { session: null },
      });

      const { result } = renderHook(() => useBookmarkTracking(123, 5));

      expect(result.current.updateBookmark).toBeDefined();
      expect(typeof result.current.updateBookmark).toBe('function');
    });
  });
});
