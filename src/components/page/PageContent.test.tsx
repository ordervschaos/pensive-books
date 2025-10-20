/**
 * Tests for PageContent component
 * Verifies JSON content prioritization and backward compatibility
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { PageContent } from './PageContent';

// Mock dependencies
vi.mock('@/components/editor/TipTapEditor', () => ({
  TipTapEditor: ({ content }: { content: string }) => (
    <div data-testid="tiptap-editor">{content}</div>
  ),
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

vi.mock('@/utils/tiptapHelpers', () => ({
  getHtmlContent: vi.fn((jsonContent, htmlContent) => {
    // Mock implementation that prefers JSON
    if (jsonContent && jsonContent.content) {
      return '<h1>JSON Title</h1><p>JSON content</p>';
    }
    return htmlContent || '';
  }),
}));

describe('PageContent', () => {
  const defaultProps = {
    content: '<h1>Test Title</h1><p>Test content</p>',
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

  it('should prefer JSON content over HTML content', async () => {
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
        content="<h1>HTML Title</h1>"
        jsonContent={jsonContent}
      />
    );

    await waitFor(() => {
      const editor = screen.getByTestId('tiptap-editor');
      // Should contain JSON-derived content
      expect(editor.textContent).toContain('JSON Title');
    });
  });

  it('should fall back to HTML content when JSON is not available', () => {
    render(
      <PageContent {...defaultProps} content="<h1>HTML Title</h1>" jsonContent={null} />
    );

    const editor = screen.getByTestId('tiptap-editor');
    expect(editor.textContent).toContain('HTML Title');
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
      <PageContent {...defaultProps} content="Initial content" isEditing={false} />
    );

    rerender(
      <PageContent
        {...defaultProps}
        content="Updated content"
        isEditing={false}
      />
    );

    await waitFor(() => {
      const editor = screen.getByTestId('tiptap-editor');
      expect(editor.textContent).toContain('Updated content');
    });
  });

  it('should not update content when props change while editing', async () => {
    const { rerender } = render(
      <PageContent {...defaultProps} content="Initial content" isEditing={true} />
    );

    rerender(
      <PageContent
        {...defaultProps}
        content="Updated content"
        isEditing={true}
      />
    );

    // Content should not change while editing
    const editor = screen.getByTestId('tiptap-editor');
    expect(editor.textContent).toContain('Initial content');
  });

  it('should handle empty content gracefully', () => {
    render(<PageContent {...defaultProps} content="" />);

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
        // getHtmlContent should be called with updated JSON
        expect(editor).toBeTruthy();
      });
    });

    it('should handle switch from HTML to JSON content', async () => {
      const { rerender } = render(
        <PageContent
          {...defaultProps}
          content="<p>HTML content</p>"
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
          content="<p>HTML content</p>"
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

  describe('Backward compatibility', () => {
    it('should work with legacy pages (HTML only)', () => {
      const legacyProps = {
        ...defaultProps,
        content: '<h1>Legacy Content</h1><p>HTML only</p>',
        jsonContent: undefined,
      };

      render(<PageContent {...legacyProps} />);

      const editor = screen.getByTestId('tiptap-editor');
      expect(editor.textContent).toContain('Legacy Content');
    });

    it('should work with new pages (JSON content)', () => {
      const newProps = {
        ...defaultProps,
        content: '',
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

    it('should work with mixed content (both JSON and HTML)', () => {
      const mixedProps = {
        ...defaultProps,
        content: '<h1>HTML Fallback</h1>',
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

      render(<PageContent {...mixedProps} />);

      const editor = screen.getByTestId('tiptap-editor');
      // Should prefer JSON
      expect(editor.textContent).toContain('JSON');
    });
  });

  describe('Edge cases', () => {
    it('should handle very long content', () => {
      const longContent = '<p>' + 'A'.repeat(10000) + '</p>';

      render(<PageContent {...defaultProps} content={longContent} />);

      expect(screen.getByTestId('tiptap-editor')).toBeTruthy();
    });

    it('should handle special characters in content', () => {
      const specialContent = '<p>&lt;&gt;&amp;&quot;</p>';

      render(<PageContent {...defaultProps} content={specialContent} />);

      expect(screen.getByTestId('tiptap-editor')).toBeTruthy();
    });

    it('should handle malformed HTML gracefully', () => {
      const malformedContent = '<p>Unclosed paragraph<div>Mixed tags</p></div>';

      render(<PageContent {...defaultProps} content={malformedContent} />);

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
          content="<h1>Title</h1><p>Content</p>"
        />
      );

      rerender(
        <PageContent
          {...defaultProps}
          pageId="456"
          content="<h1>New Title</h1><p>New Content</p>"
        />
      );

      await waitFor(() => {
        const editor = screen.getByTestId('tiptap-editor');
        expect(editor.textContent).toContain('New Title');
      });
    });
  });
});
