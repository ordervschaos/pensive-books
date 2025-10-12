import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { usePageCreation } from './use-page-creation';
import * as ReactRouter from 'react-router-dom';

// Mock dependencies
const mockToast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({
    toast: mockToast,
  }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: vi.fn(),
  };
});

vi.mock('@/integrations/supabase/client', () => {
  const mockRpc = vi.fn();

  return {
    supabase: {
      rpc: mockRpc,
    },
    __mockRpc: mockRpc,
  };
});

describe('usePageCreation', () => {
  const mockNavigate = vi.fn();
  let mockRpc: any;

  beforeEach(async () => {
    const supabaseMock = await import('@/integrations/supabase/client');
    mockRpc = (supabaseMock as any).__mockRpc;

    vi.clearAllMocks();
    (ReactRouter.useNavigate as any).mockReturnValue(mockNavigate);

    mockRpc.mockReturnValue({
      select: vi.fn(() => ({
        single: vi.fn(() => Promise.resolve({
          data: { id: 456, title: 'New Page' },
          error: null,
        })),
      })),
    });
  });

  it('should create a new page successfully', async () => {
    const { result } = renderHook(() => usePageCreation('123', 123, true));
    const { supabase } = await import('@/integrations/supabase/client');

    await act(async () => {
      await result.current.createNewPage();
    });

    await waitFor(() => {
      expect(supabase.rpc).toHaveBeenCalledWith('create_next_page', {
        p_book_id: 123,
      });
      expect(mockNavigate).toHaveBeenCalledWith('/book/123/page/456?edit=true');
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Page created',
          description: 'Your new page has been created',
        })
      );
    });
  });

  it('should show error when user lacks edit permission', async () => {
    const { result } = renderHook(() => usePageCreation('123', 123, false));

    await act(async () => {
      await result.current.createNewPage();
    });

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: 'destructive',
        title: 'Permission denied',
        description: "You don't have permission to create pages in this book",
      })
    );

    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('should handle RPC errors', async () => {
    mockRpc.mockReturnValueOnce({
      select: vi.fn(() => ({
        single: vi.fn(() => Promise.resolve({
          data: null,
          error: new Error('RPC failed'),
        })),
      })),
    });

    const { result } = renderHook(() => usePageCreation('123', 123, true));

    await act(async () => {
      await result.current.createNewPage();
    });

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: 'destructive',
          title: 'Error creating page',
          description: 'RPC failed',
        })
      );
    });

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('should navigate with edit mode enabled', async () => {
    const { result } = renderHook(() => usePageCreation('123-my-book', 123, true));

    await act(async () => {
      await result.current.createNewPage();
    });

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(
        expect.stringContaining('?edit=true')
      );
    });
  });

  it('should return creating: false', () => {
    const { result } = renderHook(() => usePageCreation('123', 123, true));

    expect(result.current.creating).toBe(false);
  });

  it('should handle missing book ID gracefully', async () => {
    mockRpc.mockReturnValueOnce({
      select: vi.fn(() => ({
        single: vi.fn(() => Promise.resolve({
          data: null,
          error: new Error('Invalid book ID'),
        })),
      })),
    });

    const { result } = renderHook(() => usePageCreation(undefined, 0, true));

    await act(async () => {
      await result.current.createNewPage();
    });

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: 'destructive',
        })
      );
    });
  });

  it('should preserve book slug in navigation', async () => {
    const { result } = renderHook(() =>
      usePageCreation('123-my-awesome-book', 123, true)
    );

    await act(async () => {
      await result.current.createNewPage();
    });

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(
        '/book/123-my-awesome-book/page/456?edit=true'
      );
    });
  });

  it('should call createNewPage function multiple times', async () => {
    mockRpc
      .mockReturnValueOnce({
        select: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve({
            data: { id: 456 },
            error: null,
          })),
        })),
      })
      .mockReturnValueOnce({
        select: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve({
            data: { id: 457 },
            error: null,
          })),
        })),
      });

    const { result } = renderHook(() => usePageCreation('123', 123, true));

    await act(async () => {
      await result.current.createNewPage();
    });

    await act(async () => {
      await result.current.createNewPage();
    });

    expect(mockRpc).toHaveBeenCalledTimes(2);
  });

  it('should handle unknown error types', async () => {
    mockRpc.mockReturnValueOnce({
      select: vi.fn(() => ({
        single: vi.fn(() => Promise.resolve({
          data: null,
          error: 'String error', // Non-Error object
        })),
      })),
    });

    const { result } = renderHook(() => usePageCreation('123', 123, true));

    await act(async () => {
      await result.current.createNewPage();
    });

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'Unknown error',
        })
      );
    });
  });
});
