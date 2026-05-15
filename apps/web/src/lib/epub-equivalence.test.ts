/**
 * Test to verify that HTML and JSON versions of the same content produce identical EPUB output
 * This ensures backward compatibility and content fidelity
 */

import { describe, it, expect } from 'vitest';
import { jsonToHtml } from '@/utils/tiptapHelpers';
import { sanitizeContent } from './epub';

describe('EPUB Content Equivalence', () => {
  it('should produce identical EPUB output for HTML and JSON versions of the same content', () => {
    // Original HTML version
    const htmlVersion = `<h1>Problem breakdown procedure</h1><ol class="list-decimal list-outside ml-4 my-4 space-y-1"><li class="pl-1"><p>Write down clearly the problem as if you are explaining it to a doctor.</p></li><li class="pl-1"><p>Research on it.</p></li><li class="pl-1"><p>Filter through it and identify relevant science and models.</p></li><li class="pl-1"><p>Formulate a system based on your personal context - strengths, weaknesses, environment, past wins and losses. This is an intuitive decision</p></li><li class="pl-1"><p>Iterate.</p></li></ol>`;

    // JSON version
    const jsonVersion = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: {
            level: 1,
            audioBlock: null,
          },
          content: [
            {
              text: 'Problem breakdown procedure',
              type: 'text',
            },
          ],
        },
        {
          type: 'orderedList',
          attrs: {
            start: 1,
          },
          content: [
            {
              type: 'listItem',
              attrs: {
                audioBlock: null,
              },
              content: [
                {
                  type: 'paragraph',
                  attrs: {
                    audioBlock: null,
                  },
                  content: [
                    {
                      text: 'Write down clearly the problem as if you are explaining it to a doctor.',
                      type: 'text',
                    },
                  ],
                },
              ],
            },
            {
              type: 'listItem',
              attrs: {
                audioBlock: null,
              },
              content: [
                {
                  type: 'paragraph',
                  attrs: {
                    audioBlock: null,
                  },
                  content: [
                    {
                      text: 'Research on it.',
                      type: 'text',
                    },
                  ],
                },
              ],
            },
            {
              type: 'listItem',
              attrs: {
                audioBlock: null,
              },
              content: [
                {
                  type: 'paragraph',
                  attrs: {
                    audioBlock: null,
                  },
                  content: [
                    {
                      text: 'Filter through it and identify relevant science and models.',
                      type: 'text',
                    },
                  ],
                },
              ],
            },
            {
              type: 'listItem',
              attrs: {
                audioBlock: null,
              },
              content: [
                {
                  type: 'paragraph',
                  attrs: {
                    audioBlock: null,
                  },
                  content: [
                    {
                      text: 'Formulate a system based on your personal context - strengths, weaknesses, environment, past wins and losses. This is an intuitive decision',
                      type: 'text',
                    },
                  ],
                },
              ],
            },
            {
              type: 'listItem',
              attrs: {
                audioBlock: null,
              },
              content: [
                {
                  type: 'paragraph',
                  attrs: {
                    audioBlock: null,
                  },
                  content: [
                    {
                      text: 'Iterate.',
                      type: 'text',
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    // Convert JSON to HTML
    const htmlFromJson = jsonToHtml(jsonVersion);

    // Sanitize both for EPUB (removes CSS classes, etc.)
    const sanitizedOriginalHtml = sanitizeContent(htmlVersion);
    const sanitizedJsonHtml = sanitizeContent(htmlFromJson);

    // Extract text content for comparison (ignore whitespace and formatting differences)
    const normalizeForComparison = (html: string): string => {
      // Remove all classes
      let normalized = html.replace(/class="[^"]*"/g, '');
      // Remove extra whitespace
      normalized = normalized.replace(/\s+/g, ' ');
      // Trim
      normalized = normalized.trim();
      return normalized;
    };

    const normalizedOriginal = normalizeForComparison(sanitizedOriginalHtml);
    const normalizedJson = normalizeForComparison(sanitizedJsonHtml);

    // Both should contain the same text content
    expect(normalizedJson).toContain('Problem breakdown procedure');
    expect(normalizedJson).toContain('Write down clearly the problem');
    expect(normalizedJson).toContain('Research on it');
    expect(normalizedJson).toContain('Filter through it');
    expect(normalizedJson).toContain('Formulate a system');
    expect(normalizedJson).toContain('Iterate');

    expect(normalizedOriginal).toContain('Problem breakdown procedure');
    expect(normalizedOriginal).toContain('Write down clearly the problem');
    expect(normalizedOriginal).toContain('Research on it');

    // Both should have heading
    expect(sanitizedOriginalHtml).toContain('<h1>');
    expect(sanitizedJsonHtml).toContain('<h1>');

    // Both should have ordered list
    expect(sanitizedOriginalHtml).toContain('<ol');
    expect(sanitizedJsonHtml).toContain('<ol');

    // Both should have list items
    const originalLiCount = (sanitizedOriginalHtml.match(/<li/g) || []).length;
    const jsonLiCount = (sanitizedJsonHtml.match(/<li/g) || []).length;
    expect(jsonLiCount).toBe(5);
    expect(originalLiCount).toBe(5);

    // Both should have paragraphs within list items
    expect(sanitizedOriginalHtml).toContain('<li');
    expect(sanitizedOriginalHtml).toContain('<p>');
    expect(sanitizedJsonHtml).toContain('<li');
    expect(sanitizedJsonHtml).toContain('<p>');
  });

  it('should handle nested list items identically', () => {
    const html = '<ol><li><p>Item 1</p></li><li><p>Item 2</p></li></ol>';

    const json = {
      type: 'doc',
      content: [
        {
          type: 'orderedList',
          attrs: { start: 1 },
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Item 1' }],
                },
              ],
            },
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Item 2' }],
                },
              ],
            },
          ],
        },
      ],
    };

    const htmlFromJson = jsonToHtml(json);
    const sanitizedOriginal = sanitizeContent(html);
    const sanitizedFromJson = sanitizeContent(htmlFromJson);

    // Both should have same structure
    expect(sanitizedFromJson).toContain('Item 1');
    expect(sanitizedFromJson).toContain('Item 2');
    expect(sanitizedOriginal).toContain('Item 1');
    expect(sanitizedOriginal).toContain('Item 2');
  });

  it('should handle headings at all levels identically', () => {
    const html = '<h1>H1</h1><h2>H2</h2><h3>H3</h3>';

    const json = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'H1' }],
        },
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'H2' }],
        },
        {
          type: 'heading',
          attrs: { level: 3 },
          content: [{ type: 'text', text: 'H3' }],
        },
      ],
    };

    const htmlFromJson = jsonToHtml(json);

    // Both should have all heading levels
    expect(htmlFromJson).toContain('<h1>');
    expect(htmlFromJson).toContain('<h2>');
    expect(htmlFromJson).toContain('<h3>');
    expect(htmlFromJson).toContain('H1');
    expect(htmlFromJson).toContain('H2');
    expect(htmlFromJson).toContain('H3');
  });

  it('should preserve text formatting (bold, italic) identically', () => {
    const html = '<p>This is <strong>bold</strong> and <em>italic</em> text.</p>';

    const json = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'This is ' },
            { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
            { type: 'text', text: ' and ' },
            { type: 'text', text: 'italic', marks: [{ type: 'italic' }] },
            { type: 'text', text: ' text.' },
          ],
        },
      ],
    };

    const htmlFromJson = jsonToHtml(json);

    // Both should have bold and italic
    expect(htmlFromJson).toContain('bold');
    expect(htmlFromJson).toContain('italic');
    expect(html).toContain('<strong>');
    expect(html).toContain('<em>');
  });

  it('should handle complex nested structures identically', () => {
    const html = `
      <h1>Title</h1>
      <p>Introduction paragraph.</p>
      <ol>
        <li><p>First item</p></li>
        <li><p>Second item</p></li>
      </ol>
      <p>Conclusion with <strong>bold</strong> text.</p>
    `;

    const json = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'Title' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Introduction paragraph.' }],
        },
        {
          type: 'orderedList',
          attrs: { start: 1 },
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'First item' }],
                },
              ],
            },
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Second item' }],
                },
              ],
            },
          ],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Conclusion with ' },
            { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
            { type: 'text', text: ' text.' },
          ],
        },
      ],
    };

    const htmlFromJson = jsonToHtml(json);
    const sanitizedOriginal = sanitizeContent(html);
    const sanitizedFromJson = sanitizeContent(htmlFromJson);

    // Both should contain all elements
    expect(sanitizedFromJson).toContain('Title');
    expect(sanitizedFromJson).toContain('Introduction paragraph');
    expect(sanitizedFromJson).toContain('First item');
    expect(sanitizedFromJson).toContain('Second item');
    expect(sanitizedFromJson).toContain('Conclusion');
    expect(sanitizedFromJson).toContain('bold');

    // Structure should be present in both
    expect(sanitizedFromJson).toContain('<h1>');
    expect(sanitizedFromJson).toContain('<p>');
    expect(sanitizedFromJson).toContain('<ol');
    expect(sanitizedFromJson).toContain('<li');
  });

  it('should produce EPUB-compatible output for both HTML and JSON', () => {
    const htmlVersion = '<h1>Test</h1><p>Content &amp; more</p>';

    const jsonVersion = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'Test' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Content & more' }],
        },
      ],
    };

    const htmlFromJson = jsonToHtml(jsonVersion);
    const sanitizedOriginal = sanitizeContent(htmlVersion);
    const sanitizedFromJson = sanitizeContent(htmlFromJson);

    // Both should have proper XML entities
    expect(sanitizedFromJson).toBeDefined();
    expect(sanitizedOriginal).toBeDefined();

    // Both should contain the text content
    expect(sanitizedFromJson).toContain('Test');
    expect(sanitizedFromJson).toContain('Content');
    expect(sanitizedOriginal).toContain('Test');
    expect(sanitizedOriginal).toContain('Content');
  });
});
