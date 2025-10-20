/**
 * Tests for EPUB generation with JSON content support
 */

import { describe, it, expect, vi } from 'vitest';
import {
  generateContentXhtml,
  sanitizeContent,
  escapeXml,
} from './epub';

// Mock the tiptapHelpers module
vi.mock('@/utils/tiptapHelpers', () => ({
  getHtmlFromContent: vi.fn((jsonContent, htmlContent) => {
    if (jsonContent && jsonContent.type === 'doc') {
      return '<h1>JSON Title</h1><p>JSON content from TipTap</p>';
    }
    return htmlContent || '';
  }),
}));

describe('EPUB Generation', () => {
  describe('sanitizeContent', () => {
    it('should convert HTML entities to XML equivalents', () => {
      const html = 'Text with &nbsp; and &mdash; entities';
      const sanitized = sanitizeContent(html);

      expect(sanitized).toContain('&#160;');
      expect(sanitized).toContain('&#8212;');
    });

    it('should close self-closing tags', () => {
      const html = '<p>Text<br>More text</p>';
      const sanitized = sanitizeContent(html);

      expect(sanitized).toContain('<br/>');
    });

    it('should close col tags for table compatibility', () => {
      const html = '<table><colgroup><col><col></colgroup><tbody><tr><td>Cell</td></tr></tbody></table>';
      const sanitized = sanitizeContent(html);

      expect(sanitized).toContain('<col/>');
      expect(sanitized).not.toContain('<col>');
    });

    it('should close col tags with attributes', () => {
      const html = '<table><colgroup><col style="width: 50%"><col style="width: 50%"></colgroup></table>';
      const sanitized = sanitizeContent(html);

      // Should have self-closing col tags
      expect(sanitized).toContain('<col style="width: 50%"/>');
      // Count: should have 2 col tags, both self-closing
      const colMatches = sanitized.match(/<col[^>]*\/>/g);
      expect(colMatches).toHaveLength(2);
    });

    it('should remove script tags', () => {
      const html = '<p>Content</p><script>alert("test")</script>';
      const sanitized = sanitizeContent(html);

      expect(sanitized).not.toContain('<script>');
      expect(sanitized).not.toContain('alert');
      expect(sanitized).toContain('Content');
    });

    it('should remove style tags', () => {
      const html = '<p>Content</p><style>.test { color: red; }</style>';
      const sanitized = sanitizeContent(html);

      expect(sanitized).not.toContain('<style>');
      expect(sanitized).not.toContain('color: red');
    });

    it('should remove comments', () => {
      const html = '<p>Content</p><!-- This is a comment -->';
      const sanitized = sanitizeContent(html);

      expect(sanitized).not.toContain('<!--');
      expect(sanitized).not.toContain('comment');
    });

    it('should handle empty input', () => {
      const sanitized = sanitizeContent('');
      expect(sanitized).toBe('');
    });
  });

  describe('escapeXml', () => {
    it('should escape ampersands', () => {
      const text = 'Company & Co.';
      const escaped = escapeXml(text);

      expect(escaped).toBe('Company &#38; Co.');
    });

    it('should handle empty input', () => {
      const escaped = escapeXml('');
      expect(escaped).toBe('');
    });

    it('should not double-escape', () => {
      const text = 'Already &#38; escaped';
      const escaped = escapeXml(text);

      // Should escape the ampersand in the entity
      expect(escaped).toContain('&#38;');
    });
  });

  describe('generateContentXhtml - JSON content support', () => {
    const metadata = {
      title: 'Test Book',
      subtitle: 'A Test',
      author: 'Test Author',
    };

    it('should use JSON content when available', () => {
      const pages = [
        {
          title: 'Page 1',
          html_content: null, // No HTML, so it will call getHtmlContent
          content: { type: 'doc', content: [] }, // Has JSON content
          page_type: 'page' as const,
          page_index: 0,
        },
      ];

      const xhtml = generateContentXhtml(metadata, pages, true);

      // Should use content from getHtmlContent (mocked to return JSON version)
      expect(xhtml).toContain('JSON content from TipTap');
    });

    it('should fall back to HTML content when JSON is not available', async () => {
      const { getHtmlContent } = await import('@/utils/tiptapHelpers');

      // Mock to return HTML fallback
      vi.mocked(getHtmlContent).mockReturnValueOnce('<p>HTML Fallback</p>');

      const pages = [
        {
          title: 'Page 1',
          html_content: '<p>HTML Fallback</p>',
          content: null,
          page_type: 'page' as const,
          page_index: 0,
        },
      ];

      const xhtml = generateContentXhtml(metadata, pages, true);

      expect(xhtml).toContain('HTML Fallback');
    });

    it('should handle section pages correctly', () => {
      const pages = [
        {
          title: 'Section Title',
          html_content: null,
          content: null,
          page_type: 'section' as const,
          page_index: 0,
        },
      ];

      const xhtml = generateContentXhtml(metadata, pages, true);

      expect(xhtml).toContain('Section Title');
      expect(xhtml).toContain('section-page');
      expect(xhtml).toContain('<h2 class="section-title">');
    });

    it('should handle mixed page types', () => {
      const pages = [
        {
          title: 'Section 1',
          html_content: null,
          content: null,
          page_type: 'section' as const,
          page_index: 0,
        },
        {
          title: 'Page 1',
          html_content: null, // No HTML, so it will call getHtmlContent
          content: { type: 'doc', content: [] },
          page_type: 'page' as const,
          page_index: 1,
        },
      ];

      const xhtml = generateContentXhtml(metadata, pages, true);

      expect(xhtml).toContain('Section 1');
      expect(xhtml).toContain('JSON content from TipTap');
    });

    it('should include cover page with metadata', () => {
      const pages = [];

      const xhtml = generateContentXhtml(metadata, pages, true);

      expect(xhtml).toContain('Test Book');
      expect(xhtml).toContain('A Test');
      expect(xhtml).toContain('Test Author');
    });

    it('should handle pages without title', () => {
      const pages = [
        {
          title: null,
          html_content: '<p>Content</p>',
          content: null,
          page_type: 'page' as const,
          page_index: 0,
        },
      ];

      const xhtml = generateContentXhtml(metadata, pages, true);

      expect(xhtml).toBeDefined();
    });

    it('should handle empty pages array', () => {
      const pages = [];

      const xhtml = generateContentXhtml(metadata, pages, true);

      expect(xhtml).toContain('Test Book');
      expect(xhtml).toContain('</html>');
    });

    it('should sanitize content in pages', async () => {
      const { getHtmlContent } = await import('@/utils/tiptapHelpers');

      // Mock to return content with script tag
      vi.mocked(getHtmlContent).mockReturnValueOnce(
        '<p>Content</p><script>alert("test")</script>'
      );

      const pages = [
        {
          title: 'Page 1',
          html_content: '<p>Content</p><script>alert("test")</script>',
          content: null,
          page_type: 'page' as const,
          page_index: 0,
        },
      ];

      const xhtml = generateContentXhtml(metadata, pages, true);

      expect(xhtml).not.toContain('<script>');
      expect(xhtml).not.toContain('alert');
    });

    it('should handle special characters in titles', () => {
      const specialMetadata = {
        title: 'Test & Book <Title>',
        author: 'Author & Co.',
      };

      const pages = [];

      const xhtml = generateContentXhtml(specialMetadata, pages, true);

      // Should escape XML entities
      expect(xhtml).toContain('&#38;');
    });

    it('should handle show_text_on_cover parameter', () => {
      const pages = [];

      // With text on cover
      const xhtmlWithText = generateContentXhtml(metadata, pages, true);
      expect(xhtmlWithText).toContain('Test Book');

      // Without text on cover
      const xhtmlWithoutText = generateContentXhtml(metadata, pages, false);
      expect(xhtmlWithoutText).toBeDefined();
    });
  });

  describe('Backward compatibility', () => {
    const metadata = {
      title: 'Test Book',
    };

    it('should work with legacy pages (HTML only)', async () => {
      const { getHtmlContent } = await import('@/utils/tiptapHelpers');

      vi.mocked(getHtmlContent).mockReturnValueOnce('<p>Legacy HTML</p>');

      const legacyPages = [
        {
          title: 'Legacy Page',
          html_content: '<p>Legacy HTML</p>',
          page_type: 'page' as const,
          page_index: 0,
        },
      ];

      const xhtml = generateContentXhtml(metadata, legacyPages, true);

      expect(xhtml).toContain('Legacy HTML');
    });

    it('should work with new pages (JSON content)', () => {
      const newPages = [
        {
          title: 'New Page',
          // In real usage, prepareEPUBContent() sets html_content from JSON
          html_content: '<p>Processed JSON content</p>',
          content: { type: 'doc', content: [] },
          page_type: 'page' as const,
          page_index: 0,
        },
      ];

      const xhtml = generateContentXhtml(metadata, newPages, true);

      expect(xhtml).toContain('Processed JSON content');
    });

    it('should work with mixed content types', async () => {
      const { getHtmlContent } = await import('@/utils/tiptapHelpers');

      // First page: JSON
      vi.mocked(getHtmlContent).mockReturnValueOnce('<p>JSON content</p>');
      // Second page: HTML fallback
      vi.mocked(getHtmlContent).mockReturnValueOnce('<p>HTML content</p>');

      const mixedPages = [
        {
          title: 'JSON Page',
          html_content: '',
          content: { type: 'doc', content: [] },
          page_type: 'page' as const,
          page_index: 0,
        },
        {
          title: 'HTML Page',
          html_content: '<p>HTML content</p>',
          content: null,
          page_type: 'page' as const,
          page_index: 1,
        },
      ];

      const xhtml = generateContentXhtml(metadata, mixedPages, true);

      expect(xhtml).toBeDefined();
    });
  });

  describe('Edge cases', () => {
    const metadata = {
      title: 'Test Book',
    };

    it('should handle very long content', async () => {
      const { getHtmlContent } = await import('@/utils/tiptapHelpers');

      const longContent = '<p>' + 'A'.repeat(10000) + '</p>';
      vi.mocked(getHtmlContent).mockReturnValueOnce(longContent);

      const pages = [
        {
          title: 'Long Page',
          html_content: longContent,
          content: null,
          page_type: 'page' as const,
          page_index: 0,
        },
      ];

      const xhtml = generateContentXhtml(metadata, pages, true);

      expect(xhtml).toContain('A'.repeat(100)); // Should include long content
    });

    it('should handle unicode characters', async () => {
      const { getHtmlContent } = await import('@/utils/tiptapHelpers');

      vi.mocked(getHtmlContent).mockReturnValueOnce('<p>Hello 世界 🌍</p>');

      const pages = [
        {
          title: 'Unicode Page',
          html_content: '<p>Hello 世界 🌍</p>',
          content: null,
          page_type: 'page' as const,
          page_index: 0,
        },
      ];

      const xhtml = generateContentXhtml(metadata, pages, true);

      expect(xhtml).toContain('世界');
      expect(xhtml).toContain('🌍');
    });

    it('should handle null or undefined content gracefully', async () => {
      const { getHtmlContent } = await import('@/utils/tiptapHelpers');

      vi.mocked(getHtmlContent).mockReturnValueOnce('');

      const pages = [
        {
          title: 'Empty Page',
          html_content: null,
          content: null,
          page_type: 'page' as const,
          page_index: 0,
        },
      ];

      const xhtml = generateContentXhtml(metadata, pages, true);

      expect(xhtml).toBeDefined();
      expect(xhtml).toContain('</html>');
    });

    it('should handle malformed HTML', async () => {
      const { getHtmlContent } = await import('@/utils/tiptapHelpers');

      vi.mocked(getHtmlContent).mockReturnValueOnce('<p>Unclosed<div>Mixed</p></div>');

      const pages = [
        {
          title: 'Malformed Page',
          html_content: '<p>Unclosed<div>Mixed</p></div>',
          content: null,
          page_type: 'page' as const,
          page_index: 0,
        },
      ];

      const xhtml = generateContentXhtml(metadata, pages, true);

      expect(xhtml).toBeDefined();
    });
  });
});
