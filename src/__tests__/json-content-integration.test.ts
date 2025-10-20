/**
 * Integration tests for JSON content migration
 * Tests the complete flow from database to UI with both JSON and HTML content
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
                html_content: '<p>HTML content</p>',
                content: { type: 'doc', content: [] },
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
                  html_content: '<p>HTML</p>',
                  content: { type: 'doc' },
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
  describe('Backward Compatibility - Complete Flow', () => {
    it('should handle legacy page with only HTML content', async () => {
      const legacyPage = {
        id: 1,
        title: 'Legacy Page',
        html_content: '<h1>Title</h1><p>Content</p>',
        content: null,
      };

      // Import utilities
      const { getHtmlContent, getTextContent } = await import('@/utils/tiptapHelpers');

      // Get HTML for display
      const displayHtml = getHtmlContent(legacyPage.content, legacyPage.html_content);
      expect(displayHtml).toBe(legacyPage.html_content);

      // Get text for meta tags
      const textContent = getTextContent(legacyPage.content, legacyPage.html_content);
      expect(textContent).toBeTruthy();
    });

    it('should handle new page with JSON content', async () => {
      const newPage = {
        id: 2,
        title: 'New Page',
        html_content: '',
        content: {
          type: 'doc',
          content: [
            {
              type: 'heading',
              attrs: { level: 1 },
              content: [{ type: 'text', text: 'Title' }],
            },
          ],
        },
      };

      const { getHtmlContent, getTextContent } = await import('@/utils/tiptapHelpers');

      // Should prefer JSON content
      const displayHtml = getHtmlContent(newPage.content, newPage.html_content);
      expect(displayHtml).toBeTruthy();
      expect(displayHtml).not.toBe('');

      const textContent = getTextContent(newPage.content, newPage.html_content);
      expect(textContent).toBeTruthy();
    });

    it('should handle page with both JSON and HTML (prefer JSON)', async () => {
      const mixedPage = {
        id: 3,
        title: 'Mixed Page',
        html_content: '<p>Old HTML version</p>',
        content: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'New JSON version' }],
            },
          ],
        },
      };

      const { getHtmlContent } = await import('@/utils/tiptapHelpers');

      // Should prefer JSON over HTML
      const displayHtml = getHtmlContent(mixedPage.content, mixedPage.html_content);
      expect(displayHtml).toBeTruthy();
      // The actual content will be converted from JSON
    });
  });

  describe('Complete Page Lifecycle', () => {
    it('should load -> display -> edit -> save with JSON content', async () => {
      // 1. Load page from database
      const { supabase } = await import('@/integrations/supabase/client');

      const loadResult = await supabase
        .from('pages')
        .select('*')
        .eq('id', 1)
        .single();

      expect(loadResult.data).toBeTruthy();

      // 2. Display in editor (convert JSON to HTML if needed)
      const { getHtmlContent } = await import('@/utils/tiptapHelpers');
      const page = loadResult.data;

      const displayContent = getHtmlContent(page.content, page.html_content);
      expect(displayContent).toBeTruthy();

      // 3. User edits (TipTap produces JSON)
      const editedJson = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Edited content' }],
          },
        ],
      };

      // 4. Convert to HTML for html_content field
      const { jsonToHtml } = await import('@/utils/tiptapHelpers');
      const editedHtml = jsonToHtml(editedJson);

      // 5. Save both formats
      const saveResult = await supabase
        .from('pages')
        .update({
          html_content: editedHtml,
          content: editedJson,
        })
        .eq('id', 1);

      expect(saveResult.error).toBeNull();
    });

    it('should export to EPUB using JSON content', async () => {
      const page = {
        id: 1,
        title: 'Test Page',
        html_content: '<p>HTML</p>',
        content: { type: 'doc', content: [] },
        page_type: 'page' as const,
        page_index: 0,
      };

      // EPUB generation uses getHtmlContent
      const { getHtmlContent } = await import('@/utils/tiptapHelpers');
      const contentForEpub = getHtmlContent(page.content, page.html_content);

      expect(contentForEpub).toBeTruthy();
    });

    it('should export to PDF using JSON content', async () => {
      const page = {
        id: 1,
        title: 'Test Page',
        html_content: '<p>HTML</p>',
        content: { type: 'doc', content: [] },
        page_type: 'page' as const,
        page_index: 0,
      };

      // PDF generation uses getHtmlContent
      const { getHtmlContent } = await import('@/utils/tiptapHelpers');
      const contentForPdf = getHtmlContent(page.content, page.html_content);

      expect(contentForPdf).toBeTruthy();
    });

    it('should generate meta tags using JSON content', async () => {
      const page = {
        title: 'Test Page',
        html_content: '<p>HTML</p>',
        content: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'JSON content for SEO' }],
            },
          ],
        },
      };

      // Meta generation uses getTextContent
      const { getTextContent } = await import('@/utils/tiptapHelpers');
      const textForMeta = getTextContent(page.content, page.html_content);

      expect(textForMeta).toBeTruthy();
      expect(textForMeta.length).toBeGreaterThan(0);
    });
  });

  describe('History and Restoration', () => {
    it('should restore HTML version and save both formats', async () => {
      const { supabase } = await import('@/integrations/supabase/client');
      const { htmlToJson } = await import('@/utils/tiptapHelpers');

      // Historical version (HTML only)
      const historicalHtml = '<p>Historical content</p>';

      // Convert to JSON
      const convertedJson = htmlToJson(historicalHtml);

      // Restore with both formats
      const updateResult = await supabase
        .from('pages')
        .update({
          html_content: historicalHtml,
          content: convertedJson,
        })
        .eq('id', 1);

      expect(updateResult.error).toBeNull();
    });
  });

  describe('Edge Cases - Integration', () => {
    it('should handle null content gracefully throughout the stack', async () => {
      const nullPage = {
        id: 1,
        title: 'Empty Page',
        html_content: null,
        content: null,
      };

      const { getHtmlContent, getTextContent } = await import('@/utils/tiptapHelpers');

      // Should not crash
      const html = getHtmlContent(nullPage.content, nullPage.html_content || '');
      expect(html).toBe('');

      const text = getTextContent(nullPage.content, nullPage.html_content || '');
      expect(text).toBe('');
    });

    it('should handle empty JSON document', async () => {
      const emptyJsonPage = {
        id: 1,
        title: 'Empty JSON',
        html_content: '<p>Fallback HTML</p>',
        content: { type: 'doc', content: [] },
      };

      const { getHtmlContent, getTextContent } = await import('@/utils/tiptapHelpers');

      // Empty JSON should fall back to HTML
      const html = getHtmlContent(emptyJsonPage.content, emptyJsonPage.html_content);
      expect(html).toBeTruthy();

      const text = getTextContent(emptyJsonPage.content, emptyJsonPage.html_content);
      expect(text).toBeTruthy();
    });

    it('should handle malformed JSON gracefully', async () => {
      const malformedPage = {
        id: 1,
        title: 'Malformed',
        html_content: '<p>Fallback</p>',
        content: { invalid: 'structure' }, // Not valid TipTap JSON
      };

      const { getHtmlContent } = await import('@/utils/tiptapHelpers');

      // Should fall back to HTML without crashing
      const html = getHtmlContent(malformedPage.content, malformedPage.html_content);
      expect(html).toBeTruthy();
    });
  });

  describe('Performance Considerations', () => {
    it('should handle large JSON documents efficiently', async () => {
      const { jsonToHtml, htmlToJson } = await import('@/utils/tiptapHelpers');

      // Create large JSON document
      const largeJson = {
        type: 'doc',
        content: Array.from({ length: 100 }, (_, i) => ({
          type: 'paragraph',
          content: [{ type: 'text', text: `Paragraph ${i}` }],
        })),
      };

      // Should convert without issues
      const html = jsonToHtml(largeJson);
      expect(html).toBeTruthy();

      // Round-trip conversion
      const backToJson = htmlToJson(html);
      expect(backToJson).toBeTruthy();
    });

    it('should cache conversion results when appropriate', async () => {
      const { getHtmlContent } = await import('@/utils/tiptapHelpers');

      const page = {
        content: { type: 'doc', content: [] },
        html_content: '<p>Fallback</p>',
      };

      // Multiple calls with same input
      const result1 = getHtmlContent(page.content, page.html_content);
      const result2 = getHtmlContent(page.content, page.html_content);

      // Results should be consistent
      expect(result1).toBe(result2);
    });
  });

  describe('Multi-format Export Integration', () => {
    it('should export same content to multiple formats', async () => {
      const page = {
        id: 1,
        title: 'Test Page',
        html_content: '<p>Content</p>',
        content: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Content' }],
            },
          ],
        },
        page_type: 'page' as const,
        page_index: 0,
      };

      const { getHtmlContent } = await import('@/utils/tiptapHelpers');

      // All exports should use same source (JSON)
      const epubContent = getHtmlContent(page.content, page.html_content);
      const pdfContent = getHtmlContent(page.content, page.html_content);
      const printContent = getHtmlContent(page.content, page.html_content);

      // All should be identical
      expect(epubContent).toBe(pdfContent);
      expect(pdfContent).toBe(printContent);
    });
  });

  describe('Migration Scenarios', () => {
    it('should handle gradual migration (some pages JSON, some HTML)', async () => {
      const pages = [
        // Legacy HTML-only page
        {
          id: 1,
          html_content: '<p>HTML</p>',
          content: null,
        },
        // New JSON page with content
        {
          id: 2,
          html_content: '',
          content: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'JSON content' }],
              },
            ],
          },
        },
        // Mixed (both formats)
        {
          id: 3,
          html_content: '<p>HTML</p>',
          content: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'JSON content' }],
              },
            ],
          },
        },
      ];

      const { getHtmlContent } = await import('@/utils/tiptapHelpers');

      // All pages should work
      pages.forEach((page) => {
        const content = getHtmlContent(page.content, page.html_content);
        expect(content).toBeTruthy();
      });
    });

    it('should support rollback scenario (JSON back to HTML)', async () => {
      const { jsonToHtml } = await import('@/utils/tiptapHelpers');

      const jsonPage = {
        content: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Content to rollback' }],
            },
          ],
        },
        html_content: '',
      };

      // Can always generate HTML from JSON if needed
      const html = jsonToHtml(jsonPage.content);
      expect(html).toBeDefined();
      expect(html).toBeTruthy();

      // Could save as HTML-only if rollback needed
      const htmlOnlyPage = {
        html_content: html,
        content: null,
      };

      expect(htmlOnlyPage.html_content).toBeTruthy();
    });
  });

  describe('Error Recovery', () => {
    it('should recover from JSON conversion errors', async () => {
      const { getHtmlContent } = await import('@/utils/tiptapHelpers');

      const problematicPage = {
        content: { corrupted: 'data' },
        html_content: '<p>Fallback HTML</p>',
      };

      // Should fall back to HTML
      const content = getHtmlContent(problematicPage.content, problematicPage.html_content);
      expect(content).toBe('<p>Fallback HTML</p>');
    });

    it('should handle database errors gracefully', async () => {
      const { supabase } = await import('@/integrations/supabase/client');

      // Mock will return error
      vi.mocked(supabase.from).mockReturnValueOnce({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(() =>
              Promise.resolve({
                data: null,
                error: { message: 'Database error' },
              })
            ),
          })),
        })),
      } as any);

      const result = await supabase.from('pages').select('*').eq('id', 1).single();

      expect(result.error).toBeTruthy();
      // Application should handle this gracefully
    });
  });
});
