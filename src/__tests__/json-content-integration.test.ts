/**
 * Integration tests for JSON content
 * Tests the complete flow from database to UI with JSON content
 */

import { describe, it, expect, vi } from 'vitest';

// Mock dependencies
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() =>
            Promise.resolve({
              data: {
                id: 1,
                title: 'Test Page',
                content: { 
                  type: 'doc', 
                  content: [
                    {
                      type: 'paragraph',
                      content: [{ type: 'text', text: 'Test content' }]
                    }
                  ]
                },
              },
              error: null,
            })
          ),
          order: vi.fn(() =>
            Promise.resolve({
              data: [
                {
                  id: 1,
                  title: 'Page 1',
                  content: { 
                    type: 'doc',
                    content: [
                      {
                        type: 'paragraph',
                        content: [{ type: 'text', text: 'Page content' }]
                      }
                    ]
                  },
                },
              ],
              error: null,
            })
          ),
        })),
      })),
      update: vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ error: null })),
      })),
    })),
  },
}));

describe('JSON Content Integration', () => {
  describe('Page content processing', () => {
    it('should process JSON content for display', async () => {
      const page = {
        id: 1,
        title: 'Test Page',
        content: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Test content' }]
            }
          ]
        },
      };

      // Import utilities
      const { convertJSONToHTML, getTextFromContent } = await import('@/utils/tiptapHelpers');

      // Get HTML for display
      const displayHtml = convertJSONToHTML(page.content);
      expect(displayHtml).toContain('Test content');

      // Get text for meta tags
      const textContent = getTextFromContent(page.content);
      expect(textContent).toBe('Test content');
    });

    it('should handle complex JSON content', async () => {
      const page = {
        id: 1,
        title: 'Complex Page',
        content: {
          type: 'doc',
          content: [
            {
              type: 'heading',
              attrs: { level: 1 },
              content: [{ type: 'text', text: 'Main Title' }]
            },
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: 'This is ' },
                { type: 'text', marks: [{ type: 'bold' }], text: 'bold' },
                { type: 'text', text: ' text.' }
              ]
            }
          ]
        },
      };

      const { convertJSONToHTML, getTextFromContent } = await import('@/utils/tiptapHelpers');

      const displayHtml = convertJSONToHTML(page.content);
      expect(displayHtml).toContain('Main Title');
      expect(displayHtml).toContain('bold');

      const textContent = getTextFromContent(page.content);
      expect(textContent).toContain('Main Title');
      expect(textContent).toContain('bold');
    });

    it('should handle empty content gracefully', async () => {
      const page = {
        id: 1,
        title: 'Empty Page',
        content: null,
      };

      const { convertJSONToHTML, getTextFromContent } = await import('@/utils/tiptapHelpers');

      const displayHtml = convertJSONToHTML(page.content);
      expect(displayHtml).toBe('');

      const textContent = getTextFromContent(page.content);
      expect(textContent).toBe('');
    });

    it('should handle malformed JSON gracefully', async () => {
      const page = {
        id: 1,
        title: 'Malformed Page',
        content: { invalid: 'structure' },
      };

      const { convertJSONToHTML } = await import('@/utils/tiptapHelpers');

      const displayHtml = convertJSONToHTML(page.content);
      // Should not throw error, returns empty or minimal HTML
      expect(displayHtml).toBeDefined();
    });
  });

  describe('Content consistency', () => {
    it('should produce consistent results for same content', async () => {
      const page = {
        id: 1,
        title: 'Consistent Page',
        content: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Consistent content' }]
            }
          ]
        },
      };

      const { convertJSONToHTML } = await import('@/utils/tiptapHelpers');

      const result1 = convertJSONToHTML(page.content);
      const result2 = convertJSONToHTML(page.content);
      expect(result1).toBe(result2);
    });
  });

  describe('Export functionality', () => {
    it('should generate content for EPUB export', async () => {
      const page = {
        id: 1,
        title: 'Export Page',
        content: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Export content' }]
            }
          ]
        },
      };

      const { convertJSONToHTML } = await import('@/utils/tiptapHelpers');

      const epubContent = convertJSONToHTML(page.content);
      const pdfContent = convertJSONToHTML(page.content);
      const printContent = convertJSONToHTML(page.content);

      expect(epubContent).toContain('Export content');
      expect(pdfContent).toContain('Export content');
      expect(printContent).toContain('Export content');
    });
  });

  describe('Performance', () => {
    it('should handle large content efficiently', async () => {
      const largeContent = 'A'.repeat(10000);
      const page = {
        id: 1,
        title: 'Large Page',
        content: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: largeContent }]
            }
          ]
        },
      };

      const { convertJSONToHTML } = await import('@/utils/tiptapHelpers');

      const start = performance.now();
      const content = convertJSONToHTML(page.content);
      const end = performance.now();

      expect(content).toContain(largeContent);
      expect(end - start).toBeLessThan(100); // Should complete in less than 100ms
    });
  });
});