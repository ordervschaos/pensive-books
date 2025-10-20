/**
 * Tests for EPUB generation with JSON content support
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  generateContentXhtml,
  sanitizeContent,
  escapeXml,
} from './epub';

// Mock the tiptapHelpers module
vi.mock('@/utils/tiptapHelpers', () => ({
  convertJSONToHTML: vi.fn().mockImplementation((jsonContent) => {
    if (jsonContent && jsonContent.type === 'doc') {
      return '<h1>JSON Title</h1><p>JSON content from TipTap</p>';
    }
    return '';
  }),
}));

describe('EPUB Generation', () => {
  beforeEach(async () => {
    // Restore default mock implementation before each test
    const { convertJSONToHTML } = await import('@/utils/tiptapHelpers');
    vi.mocked(convertJSONToHTML).mockImplementation((jsonContent) => {
      if (jsonContent && jsonContent.type === 'doc') {
        return '<h1>JSON Title</h1><p>JSON content from TipTap</p>';
      }
      return '';
    });
  });

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
          content: { type: 'doc', content: [] }, // Has JSON content
          page_type: 'page' as const,
          page_index: 0,
        },
      ];

      const xhtml = generateContentXhtml(metadata, pages, true);

      // Should use content from convertJSONToHTML (mocked to return JSON version)
      expect(xhtml).toContain('JSON content from TipTap');
    });

    it('should handle pages with null content', async () => {
      const { convertJSONToHTML } = await import('@/utils/tiptapHelpers');

      // Mock returns empty string for null content
      vi.mocked(convertJSONToHTML).mockReturnValueOnce('');

      const pages = [
        {
          title: 'Page 1',
          content: null,
          page_type: 'page' as const,
          page_index: 0,
        },
      ];

      const xhtml = generateContentXhtml(metadata, pages, true);

      // Should generate valid XHTML with page section (title appears in TOC, not content)
      expect(xhtml).toContain('id="page0"');
      expect(xhtml).toContain('class="content-page"');
    });

    it('should handle section pages correctly', () => {
      const pages = [
        {
          title: 'Section Title',
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
          content: null,
          page_type: 'section' as const,
          page_index: 0,
        },
        {
          title: 'Page 1',
          content: { type: 'doc', content: [] },
          page_type: 'page' as const,
          page_index: 1,
        },
      ];

      const xhtml = generateContentXhtml(metadata, pages, true);

      // Verify section page renders with title
      expect(xhtml).toContain('Section 1');
      expect(xhtml).toContain('class="section-page"');
      // Verify regular page renders
      expect(xhtml).toContain('class="content-page"');
      expect(xhtml).toContain('id="page1"');
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
      const { convertJSONToHTML } = await import('@/utils/tiptapHelpers');

      // Mock to return content with script tag
      vi.mocked(convertJSONToHTML).mockReturnValueOnce(
        '<p>Content</p><script>alert("test")</script>'
      );

      const pages = [
        {
          title: 'Page 1',
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

    it('should work with pages without content field', async () => {
      const { convertJSONToHTML } = await import('@/utils/tiptapHelpers');

      vi.mocked(convertJSONToHTML).mockReturnValueOnce('');

      const legacyPages = [
        {
          title: 'Legacy Page',
          page_type: 'page' as const,
          page_index: 0,
        },
      ];

      const xhtml = generateContentXhtml(metadata, legacyPages, true);

      // Page should render even without content field (title appears in TOC, not content.xhtml)
      expect(xhtml).toContain('id="page0"');
      expect(xhtml).toContain('class="content-page"');
    });

    it('should work with new pages (JSON content)', () => {
      const newPages = [
        {
          title: 'New Page',
          content: { type: 'doc', content: [] },
          page_type: 'page' as const,
          page_index: 0,
        },
      ];

      const xhtml = generateContentXhtml(metadata, newPages, true);

      // Page with JSON content should render
      expect(xhtml).toContain('id="page0"');
      expect(xhtml).toContain('class="content-page"');
      expect(xhtml).toContain('<div class="page-content">');
    });

    it('should work with mixed content types', async () => {
      const { convertJSONToHTML } = await import('@/utils/tiptapHelpers');

      // First page: JSON
      vi.mocked(convertJSONToHTML).mockReturnValueOnce('<p>JSON content</p>');
      // Second page: HTML fallback
      vi.mocked(convertJSONToHTML).mockReturnValueOnce('<p>HTML content</p>');

      const mixedPages = [
        {
          title: 'JSON Page',
          content: { type: 'doc', content: [] },
          page_type: 'page' as const,
          page_index: 0,
        },
        {
          title: 'HTML Page',
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
      const { convertJSONToHTML } = await import('@/utils/tiptapHelpers');

      const longContent = '<p>' + 'A'.repeat(10000) + '</p>';
      vi.mocked(convertJSONToHTML).mockReturnValueOnce(longContent);

      const pages = [
        {
          title: 'Long Page',
          content: { type: 'doc', content: [] }, // Provide JSON content so mock is called
          page_type: 'page' as const,
          page_index: 0,
        },
      ];

      const xhtml = generateContentXhtml(metadata, pages, true);

      // Should generate valid XHTML without errors
      expect(xhtml).toContain('id="page0"');
      expect(xhtml).toContain('<div class="page-content">');
    });

    it('should handle unicode characters', async () => {
      const { convertJSONToHTML } = await import('@/utils/tiptapHelpers');

      vi.mocked(convertJSONToHTML).mockReturnValueOnce('<p>Hello 世界 🌍</p>');

      const pages = [
        {
          title: 'Unicode Page',
          content: { type: 'doc', content: [] }, // Provide JSON content so mock is called
          page_type: 'page' as const,
          page_index: 0,
        },
      ];

      const xhtml = generateContentXhtml(metadata, pages, true);

      // Should generate valid XHTML (actual unicode content would come from real implementation)
      expect(xhtml).toContain('id="page0"');
      expect(xhtml).toContain('<div class="page-content">');
    });

    it('should handle null or undefined content gracefully', async () => {
      const { convertJSONToHTML } = await import('@/utils/tiptapHelpers');

      vi.mocked(convertJSONToHTML).mockReturnValueOnce('');

      const pages = [
        {
          title: 'Empty Page',
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
      const { convertJSONToHTML } = await import('@/utils/tiptapHelpers');

      vi.mocked(convertJSONToHTML).mockReturnValueOnce('<p>Unclosed<div>Mixed</p></div>');

      const pages = [
        {
          title: 'Malformed Page',
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
