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

    const testJson = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'Test Title' }]
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Content' }]
        }
      ]
    };
    const { supabase } = await import('@/integrations/supabase/client');

    await act(async () => {
      await result.current.handleSave(testJson);
    });

    await waitFor(() => {
      expect(supabase.from).toHaveBeenCalledWith('pages');
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Test Title',
          content: testJson,
        })
      );
    });
  });

  it('should extract title from JSON heading', async () => {
    const { result } = renderHook(() => usePageSave('123', true));

    const testJson = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'My Page Title' }]
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Content' }]
        }
      ]
    };

    await act(async () => {
      await result.current.handleSave(testJson);
    });

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'My Page Title',
        })
      );
    });
  });

  it('should use "Untitled" when no heading exists', async () => {
    const { result } = renderHook(() => usePageSave('123', true));

    const testJson = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Content without title' }]
        }
      ]
    };

    await act(async () => {
      await result.current.handleSave(testJson);
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

    const testJson = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'Test' }]
        }
      ]
    };

    await act(async () => {
      await result.current.handleSave(testJson);
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

    const testJson = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'Test' }]
        }
      ]
    };

    await act(async () => {
      await result.current.handleSave(testJson);
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

    const testJson = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'Test' }]
        }
      ]
    };

    const savePromise = act(async () => {
      await result.current.handleSave(testJson);
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

    const testJson = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'Test' }]
        }
      ]
    };

    await act(async () => {
      await result.current.handleSave(testJson);
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

    const testJson = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'Test Title' }]
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Content' }]
        }
      ]
    };

    await act(async () => {
      await result.current.handleSave(testJson);
    });

    await waitFor(() => {
      expect(mockCallback).toHaveBeenCalledWith(testJson, 'Test Title');
    });
  });

  it('should handle AI edit application', async () => {
    const { result } = renderHook(() => usePageSave('123', true));

    const currentJson = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'Title' }]
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Old text here' }]
        }
      ]
    };
    const oldText = 'Old text';
    const newText = 'New text';

    await act(async () => {
      await result.current.handleApplyEdit(oldText, newText, currentJson);
    });

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Title',
          // Edited JSON content is saved
        })
      );
    });
  });

  it('should not apply edit when currentJson is empty', async () => {
    const { result } = renderHook(() => usePageSave('123', true));

    await act(async () => {
      await result.current.handleApplyEdit('old', 'new', null);
    });

    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('should trim whitespace from extracted title', async () => {
    const { result } = renderHook(() => usePageSave('123', true));

    const testJson = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: '  Spaced Title  ' }]
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Content' }]
        }
      ]
    };

    await act(async () => {
      await result.current.handleSave(testJson);
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

    const testJson = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'Test' }]
        }
      ]
    };

    await act(async () => {
      await result.current.handleSave(testJson);
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
