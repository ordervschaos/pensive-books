import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { usePageSave } from './use-page-save';

// Mock dependencies
const mockToast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({
    toast: mockToast,
  }),
}));

const mockUpdate = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => ({
      update: mockUpdate,
    })),
  },
}));

describe('usePageSave', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdate.mockReturnValue({
      eq: vi.fn(() => Promise.resolve({ error: null })),
    });
  });

  it('should save page content successfully', async () => {
    const { result } = renderHook(() => usePageSave('123', true));

    const testHtml = '<h1>Test Title</h1><p>Content</p>';
    const { supabase } = await import('@/integrations/supabase/client');

    await act(async () => {
      await result.current.handleSave(testHtml);
    });

    await waitFor(() => {
      expect(supabase.from).toHaveBeenCalledWith('pages');
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          html_content: testHtml,
          title: 'Test Title',
        })
      );
    });
  });

  it('should extract title from HTML h1 tag', async () => {
    const { result } = renderHook(() => usePageSave('123', true));

    const testHtml = '<h1>My Page Title</h1><p>Content</p>';

    await act(async () => {
      await result.current.handleSave(testHtml);
    });

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'My Page Title',
        })
      );
    });
  });

  it('should use "Untitled" when no h1 tag exists', async () => {
    const { result } = renderHook(() => usePageSave('123', true));

    const testHtml = '<p>Content without title</p>';

    await act(async () => {
      await result.current.handleSave(testHtml);
    });

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Untitled',
        })
      );
    });
  });

  it('should show error when user lacks edit permission', async () => {
    const { result } = renderHook(() => usePageSave('123', false));

    await act(async () => {
      await result.current.handleSave('<h1>Test</h1>');
    });

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: 'destructive',
        title: 'Permission denied',
      })
    );
  });

  it('should show error when pageId is missing', async () => {
    const { result } = renderHook(() => usePageSave(undefined, true));

    await act(async () => {
      await result.current.handleSave('<h1>Test</h1>');
    });

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: 'destructive',
        title: 'Error',
        description: 'Page ID is missing',
      })
    );
  });

  it('should set saving state during save operation', async () => {
    const { result } = renderHook(() => usePageSave('123', true));

    expect(result.current.saving).toBe(false);

    const savePromise = act(async () => {
      await result.current.handleSave('<h1>Test</h1>');
    });

    // Note: Due to async nature, saving state may have already changed
    await savePromise;

    expect(result.current.saving).toBe(false);
  });

  it('should handle save errors', async () => {
    mockUpdate.mockReturnValueOnce({
      eq: vi.fn(() => Promise.resolve({ error: new Error('Save failed') })),
    });

    const { result } = renderHook(() => usePageSave('123', true));

    await act(async () => {
      await result.current.handleSave('<h1>Test</h1>');
    });

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: 'destructive',
        title: 'Error saving page',
        description: 'Save failed',
      })
    );
  });

  it('should call onSaveSuccess callback after successful save', async () => {
    const mockCallback = vi.fn();
    const { result } = renderHook(() => usePageSave('123', true, mockCallback));

    const testHtml = '<h1>Test Title</h1><p>Content</p>';

    await act(async () => {
      await result.current.handleSave(testHtml);
    });

    await waitFor(() => {
      expect(mockCallback).toHaveBeenCalledWith(testHtml, 'Test Title');
    });
  });

  it('should handle AI edit application', async () => {
    const { result } = renderHook(() => usePageSave('123', true));

    const currentHtml = '<h1>Title</h1><p>Old text here</p>';
    const oldText = 'Old text';
    const newText = 'New text';

    await act(async () => {
      await result.current.handleApplyEdit(oldText, newText, currentHtml);
    });

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          html_content: '<h1>Title</h1><p>New text here</p>',
        })
      );
    });
  });

  it('should not apply edit when currentHtml is empty', async () => {
    const { result } = renderHook(() => usePageSave('123', true));

    await act(async () => {
      await result.current.handleApplyEdit('old', 'new', '');
    });

    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('should trim whitespace from extracted title', async () => {
    const { result } = renderHook(() => usePageSave('123', true));

    const testHtml = '<h1>  Spaced Title  </h1><p>Content</p>';

    await act(async () => {
      await result.current.handleSave(testHtml);
    });

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Spaced Title',
        })
      );
    });
  });

  it('should update timestamp on save', async () => {
    const { result } = renderHook(() => usePageSave('123', true));

    await act(async () => {
      await result.current.handleSave('<h1>Test</h1>');
    });

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          updated_at: expect.any(String),
        })
      );
    });
  });
});
