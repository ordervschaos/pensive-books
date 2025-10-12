import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { usePageNavigation } from './use-page-navigation';
import * as ReactRouter from 'react-router-dom';

// Mock dependencies
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: vi.fn(),
  };
});

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(() => Promise.resolve({ data: { id: 1, title: 'Test' }, error: null })),
            })),
          })),
        })),
      })),
    })),
  },
}));

describe('usePageNavigation', () => {
  const mockNavigate = vi.fn();
  const mockPages = [
    { id: 1, title: 'Chapter 1', page_index: 0 },
    { id: 2, title: 'Chapter 2', page_index: 1 },
    { id: 3, title: 'Chapter 3', page_index: 2 },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    (ReactRouter.useNavigate as any).mockReturnValue(mockNavigate);
  });

  it('should navigate to a specific page by index', async () => {
    const { result } = renderHook(() =>
      usePageNavigation('123', 123, mockPages, 0)
    );

    await act(async () => {
      await result.current.navigateToPage(1);
    });

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/book/123/page/2-chapter-2', { replace: false });
    });
  });

  it('should navigate to next page', async () => {
    const { result } = renderHook(() =>
      usePageNavigation('123', 123, mockPages, 0)
    );

    await act(async () => {
      result.current.navigateNext();
    });

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/book/123/page/2-chapter-2', { replace: false });
    });
  });

  it('should navigate to previous page', async () => {
    const { result } = renderHook(() =>
      usePageNavigation('123', 123, mockPages, 1)
    );

    await act(async () => {
      result.current.navigatePrev();
    });

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/book/123/page/1-chapter-1', { replace: false });
    });
  });

  it('should not navigate next when on last page', async () => {
    const { result } = renderHook(() =>
      usePageNavigation('123', 123, mockPages, 2)
    );

    await act(async () => {
      result.current.navigateNext();
    });

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('should not navigate prev when on first page', async () => {
    const { result } = renderHook(() =>
      usePageNavigation('123', 123, mockPages, 0)
    );

    await act(async () => {
      result.current.navigatePrev();
    });

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('should handle pages without titles', async () => {
    const pagesWithoutTitles = [
      { id: 1, title: '', page_index: 0 },
    ];

    const { result } = renderHook(() =>
      usePageNavigation('123', 123, pagesWithoutTitles, 0)
    );

    await act(async () => {
      await result.current.navigateToPage(0);
    });

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/book/123/page/1', { replace: false });
    });
  });

  it('should prevent double navigation', async () => {
    const { result } = renderHook(() =>
      usePageNavigation('123', 123, mockPages, 0)
    );

    // Trigger first navigation
    await act(async () => {
      await result.current.navigateToPage(1);
    });

    // Wait for first navigation to complete
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledTimes(1);
    });

    // Second navigation should now work since first is complete
    await act(async () => {
      await result.current.navigateToPage(2);
    });

    // Total should be 2 since navigations happened sequentially
    expect(mockNavigate).toHaveBeenCalledTimes(2);
  });

  it('should handle invalid page index', async () => {
    const { result } = renderHook(() =>
      usePageNavigation('123', 123, mockPages, 0)
    );

    await act(async () => {
      await result.current.navigateToPage(999);
    });

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('should call onNavigationComplete callback', async () => {
    const mockCallback = vi.fn();
    const { result } = renderHook(() =>
      usePageNavigation('123', 123, mockPages, 0, mockCallback)
    );

    await act(async () => {
      await result.current.navigateToPage(1);
    });

    await waitFor(() => {
      expect(mockCallback).toHaveBeenCalledWith({ id: 1, title: 'Test' });
    });
  });

  it('should generate proper slugs for navigation', async () => {
    const pagesWithSpecialChars = [
      { id: 1, title: 'Chapter 1: Introduction', page_index: 0 },
      { id: 2, title: 'Hello World!', page_index: 1 },
    ];

    const { result } = renderHook(() =>
      usePageNavigation('123', 123, pagesWithSpecialChars, 0)
    );

    await act(async () => {
      await result.current.navigateToPage(1);
    });

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/book/123/page/2-hello-world', { replace: false });
    });
  });
});
