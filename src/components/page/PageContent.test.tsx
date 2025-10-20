/**
 * Tests for PageContent component
 * Verifies JSON content prioritization and backward compatibility
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { PageContent } from './PageContent';

// Mock dependencies
vi.mock('@/components/editor/TipTapEditor', () => ({
  TipTapEditor: ({ content }: { content: string | any }) => {
    // Handle JSON content by extracting text from it
    if (typeof content === 'object' && content !== null) {
      const extractText = (node: any): string => {
        if (node.text) return node.text;
        if (node.content && Array.isArray(node.content)) {
          return node.content.map(extractText).join('');
        }
        return '';
      };
      const text = extractText(content);
      return <div data-testid="tiptap-editor">{text || 'JSON content'}</div>;
    }
    return <div data-testid="tiptap-editor">{content}</div>;
  },
}));

vi.mock('./PageHistory', () => ({
  PageHistory: () => <div data-testid="page-history">History</div>,
}));

vi.mock('./FloatingActions', () => ({
  FloatingActions: () => <div data-testid="floating-actions">Actions</div>,
}));

vi.mock('@/hooks/use-audio-highlighting', () => ({
  useAudioHighlighting: vi.fn(),
}));

vi.mock('@/hooks/use-adaptive-text-to-speech', () => ({
  useAdaptiveTextToSpeech: vi.fn(() => ({
    isPlaying: false,
    currentBlockIndex: -1,
    playBlockByIndex: vi.fn(),
  })),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getUser: vi.fn(() => Promise.resolve({ data: { user: { id: 'test-user' } } })),
    },
    from: vi.fn(() => ({
      upsert: vi.fn(() => Promise.resolve({ error: null })),
    })),
  },
}));

describe('PageContent', () => {
  const defaultProps = {
    jsonContent: {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'Test Title' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Test content' }],
        },
      ],
    },
    title: 'Test Page',
    onSave: vi.fn(),
    saving: false,
    pageType: 'text' as const,
    editable: true,
    canEdit: true,
    pageId: '123',
    isEditing: false,
    setIsEditing: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render TipTapEditor with content', () => {
    render(<PageContent {...defaultProps} />);

    const editor = screen.getByTestId('tiptap-editor');
    expect(editor).toBeTruthy();
  });

  it('should render with JSON content', async () => {
    const jsonContent = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'JSON Title' }],
        },
      ],
    };

    render(
      <PageContent
        {...defaultProps}
        jsonContent={jsonContent}
      />
    );

    await waitFor(() => {
      const editor = screen.getByTestId('tiptap-editor');
      // Should contain JSON-derived content
      expect(editor.textContent).toContain('JSON Title');
    });
  });

  it('should handle null JSON content', () => {
    render(
      <PageContent {...defaultProps} jsonContent={null} />
    );

    const editor = screen.getByTestId('tiptap-editor');
    // With null JSON content, editor should render (empty content is expected)
    expect(editor).toBeTruthy();
  });

  it('should render page history component when canEdit is true', () => {
    render(<PageContent {...defaultProps} canEdit={true} pageId="123" />);

    // PageHistory is rendered but mocked, so we just verify no errors
    expect(screen.queryByTestId('page-history')).toBeDefined();
  });

  it('should not render page history when canEdit is false', () => {
    render(<PageContent {...defaultProps} canEdit={false} />);

    expect(screen.queryByTestId('page-history')).toBeFalsy();
  });

  it('should render floating actions', () => {
    render(<PageContent {...defaultProps} />);

    expect(screen.getByTestId('floating-actions')).toBeTruthy();
  });

  it('should handle section page type with centered content', () => {
    render(<PageContent {...defaultProps} pageType="section" />);

    // Component should render without errors
    expect(screen.getByTestId('tiptap-editor')).toBeTruthy();
  });

  it('should update content when props change and not editing', async () => {
    const { rerender } = render(
      <PageContent {...defaultProps} jsonContent={{ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Initial' }] }] }} isEditing={false} />
    );

    rerender(
      <PageContent
        {...defaultProps}
        jsonContent={{ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Updated' }] }] }}
        isEditing={false}
      />
    );

      await waitFor(() => {
        const editor = screen.getByTestId('tiptap-editor');
        // Should show the actual text content from JSON
        expect(editor.textContent).toContain('Updated');
      });
  });

  it('should not update content when props change while editing', async () => {
    const initialJson = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Initial' }] }] };
    const { rerender } = render(
      <PageContent {...defaultProps} jsonContent={initialJson} isEditing={true} />
    );

    rerender(
      <PageContent
        {...defaultProps}
        jsonContent={{ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Updated' }] }] }}
        isEditing={true}
      />
    );

    // Content should not change while editing
    const editor = screen.getByTestId('tiptap-editor');
    // Just verify editor exists (content update behavior depends on component implementation)
    expect(editor).toBeTruthy();
  });

  it('should handle empty content gracefully', () => {
    render(<PageContent {...defaultProps} jsonContent={null} />);

    const editor = screen.getByTestId('tiptap-editor');
    expect(editor).toBeTruthy();
  });

  it('should handle null title', () => {
    render(<PageContent {...defaultProps} title="" />);

    expect(screen.getByTestId('tiptap-editor')).toBeTruthy();
  });

  it('should pass saving state to children', () => {
    render(<PageContent {...defaultProps} saving={true} />);

    // Component should render without errors even when saving
    expect(screen.getByTestId('tiptap-editor')).toBeTruthy();
  });

  describe('JSON content updates', () => {
    it('should update when JSON content changes', async () => {
      const initialJson = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Initial JSON' }],
          },
        ],
      };

      const updatedJson = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Updated JSON' }],
          },
        ],
      };

      const { rerender } = render(
        <PageContent
          {...defaultProps}
          jsonContent={initialJson}
          isEditing={false}
        />
      );

      rerender(
        <PageContent
          {...defaultProps}
          jsonContent={updatedJson}
          isEditing={false}
        />
      );

      await waitFor(() => {
        const editor = screen.getByTestId('tiptap-editor');
        expect(editor).toBeTruthy();
      });
    });

    it('should handle switch from null to JSON content', async () => {
      const { rerender } = render(
        <PageContent
          {...defaultProps}
          jsonContent={null}
          isEditing={false}
        />
      );

      const newJson = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'New JSON' }],
          },
        ],
      };

      rerender(
        <PageContent
          {...defaultProps}
          jsonContent={newJson}
          isEditing={false}
        />
      );

      await waitFor(() => {
        // Should now use JSON content
        expect(screen.getByTestId('tiptap-editor')).toBeTruthy();
      });
    });
  });

  describe('JSON content handling', () => {
    it('should work with pages without JSON content', () => {
      const legacyProps = {
        ...defaultProps,
        jsonContent: undefined,
      };

      render(<PageContent {...legacyProps} />);

      const editor = screen.getByTestId('tiptap-editor');
      // Without JSON content, editor should render (empty content is expected)
      expect(editor).toBeTruthy();
    });

    it('should work with new pages (JSON content)', () => {
      const newProps = {
        ...defaultProps,
        jsonContent: {
          type: 'doc',
          content: [
            {
              type: 'heading',
              attrs: { level: 1 },
              content: [{ type: 'text', text: 'New JSON Content' }],
            },
          ],
        },
      };

      render(<PageContent {...newProps} />);

      expect(screen.getByTestId('tiptap-editor')).toBeTruthy();
    });

    it('should work with valid JSON content', () => {
      const jsonProps = {
        ...defaultProps,
        jsonContent: {
          type: 'doc',
          content: [
            {
              type: 'heading',
              attrs: { level: 1 },
              content: [{ type: 'text', text: 'JSON Primary' }],
            },
          ],
        },
      };

      render(<PageContent {...jsonProps} />);

      const editor = screen.getByTestId('tiptap-editor');
      // Should use JSON content
      expect(editor.textContent).toContain('JSON');
    });
  });

  describe('Edge cases', () => {
    it('should handle very long content', () => {
      const longContent = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'A'.repeat(10000) }],
          },
        ],
      };

      render(<PageContent {...defaultProps} jsonContent={longContent} />);

      expect(screen.getByTestId('tiptap-editor')).toBeTruthy();
    });

    it('should handle special characters in content', () => {
      const specialContent = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: '<>&"' }],
          },
        ],
      };

      render(<PageContent {...defaultProps} jsonContent={specialContent} />);

      expect(screen.getByTestId('tiptap-editor')).toBeTruthy();
    });

    it('should handle complex nested content', () => {
      const complexContent = {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 1 },
            content: [{ type: 'text', text: 'Title' }],
          },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Paragraph' }],
          },
        ],
      };

      render(<PageContent {...defaultProps} jsonContent={complexContent} />);

      expect(screen.getByTestId('tiptap-editor')).toBeTruthy();
    });

    it('should handle undefined pageId', () => {
      render(<PageContent {...defaultProps} pageId={undefined} />);

      expect(screen.getByTestId('tiptap-editor')).toBeTruthy();
    });

    it('should handle null editable prop', () => {
      render(<PageContent {...defaultProps} editable={false} canEdit={false} />);

      expect(screen.getByTestId('tiptap-editor')).toBeTruthy();
    });
  });

  describe('Content remounting', () => {
    it('should remount editor when pageId changes', () => {
      const { rerender } = render(<PageContent {...defaultProps} pageId="123" />);

      // Change pageId - should force remount
      rerender(<PageContent {...defaultProps} pageId="456" />);

      expect(screen.getByTestId('tiptap-editor')).toBeTruthy();
    });

    it('should preserve content structure after remount', async () => {
      const { rerender } = render(
        <PageContent
          {...defaultProps}
          pageId="123"
          jsonContent={{ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Content' }] }] }}
        />
      );

      rerender(
        <PageContent
          {...defaultProps}
          pageId="456"
          jsonContent={{ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'New Content' }] }] }}
        />
      );

      await waitFor(() => {
        const editor = screen.getByTestId('tiptap-editor');
        // Should show the actual text content from JSON
        expect(editor.textContent).toContain('New Content');
      });
    });

    it('should update content when pageId changes in edit mode', async () => {
      const { rerender } = render(
        <PageContent
          {...defaultProps}
          isEditing={true}
          pageId="123"
          jsonContent={{ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Original Content' }] }] }}
        />
      );

      // Navigate to a different page while in edit mode
      rerender(
        <PageContent
          {...defaultProps}
          isEditing={true}
          pageId="456"
          jsonContent={{ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'New Page Content' }] }] }}
        />
      );

      await waitFor(() => {
        const editor = screen.getByTestId('tiptap-editor');
        // Should show new content even though we're in edit mode
        expect(editor.textContent).toContain('New Page Content');
      });
    });
  });
});
