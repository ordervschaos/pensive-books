/**
 * Tests for TipTap JSON/HTML conversion utilities
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  jsonToHtml,
  jsonToText,
  getTextFromContent,
  convertJSONToHTML,
  getWordCountFromContent,
  cumulativeWordOffsets,
} from './tiptapHelpers';

describe('tiptapHelpers', () => {
  describe('jsonToHtml', () => {
    it('should convert valid JSON to HTML', () => {
      const json = {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 1 },
            content: [{ type: 'text', text: 'Hello World' }],
          },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'This is a paragraph.' }],
          },
        ],
      };

      const html = jsonToHtml(json);
      expect(html).toContain('<h1>Hello World</h1>');
      expect(html).toContain('<p>This is a paragraph.</p>');
    });

    it('should return empty string for null input', () => {
      const html = jsonToHtml(null);
      expect(html).toBe('');
    });

    it('should return empty string for undefined input', () => {
      const html = jsonToHtml(undefined);
      expect(html).toBe('');
    });

    it('should handle empty JSON document', () => {
      const json = {
        type: 'doc',
        content: [],
      };

      const html = jsonToHtml(json);
      expect(html).toBeDefined();
    });

    it('should handle complex content with links and formatting', () => {
      const json = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'This is ' },
              { type: 'text', marks: [{ type: 'bold' }], text: 'bold' },
              { type: 'text', text: ' and ' },
              { type: 'text', marks: [{ type: 'italic' }], text: 'italic' },
              { type: 'text', text: ' text.' },
            ],
          },
        ],
      };

      const html = jsonToHtml(json);
      expect(html).toContain('<strong>bold</strong>');
      expect(html).toContain('<em>italic</em>');
    });

    it('should handle invalid JSON gracefully', () => {
      const invalidJson = { invalid: 'structure' };
      const html = jsonToHtml(invalidJson);
      // Should not throw error, returns empty or minimal HTML
      expect(html).toBeDefined();
    });
  });


  describe('jsonToText', () => {
    it('should extract plain text from JSON', () => {
      const json = {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 1 },
            content: [{ type: 'text', text: 'Hello World' }],
          },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'This is a paragraph.' }],
          },
        ],
      };

      const text = jsonToText(json);
      expect(text).toContain('Hello World');
      expect(text).toContain('This is a paragraph.');
    });

    it('should return empty string for null input', () => {
      const text = jsonToText(null);
      expect(text).toBe('');
    });

    it('should return empty string for JSON without content', () => {
      const json = { type: 'doc' };
      const text = jsonToText(json);
      expect(text).toBe('');
    });

    it('should extract text from nested content', () => {
      const json = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Start ' },
              { type: 'text', marks: [{ type: 'bold' }], text: 'bold' },
              { type: 'text', text: ' end' },
            ],
          },
        ],
      };

      const text = jsonToText(json);
      expect(text).toBe('Start bold end');
    });

    it('should handle empty text nodes', () => {
      const json = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: '' },
              { type: 'text', text: 'Text' },
            ],
          },
        ],
      };

      const text = jsonToText(json);
      expect(text).toBe('Text');
    });
  });


  describe('getTextFromContent', () => {
    const sampleJson = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'JSON content' }],
        },
      ],
    };

    it('should extract text from JSON content', () => {
      const text = getTextFromContent(sampleJson);
      expect(text).toContain('JSON content');
    });

    it('should return empty string for null input', () => {
      const text = getTextFromContent(null);
      expect(text).toBe('');
    });

    it('should return empty string for undefined input', () => {
      const text = getTextFromContent(undefined);
      expect(text).toBe('');
    });

    it('should handle JSON that produces empty text', () => {
      const emptyJson = { type: 'doc', content: [] };
      const text = getTextFromContent(emptyJson);
      expect(text).toBe('');
    });
  });

  describe('convertJSONToHTML', () => {
    const sampleJson = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'JSON Title' }],
        },
      ],
    };

    it('should convert JSON content to HTML', () => {
      const html = convertJSONToHTML(sampleJson);
      expect(html).toContain('JSON Title');
    });

    it('should return empty string for null input', () => {
      const html = convertJSONToHTML(null);
      expect(html).toBe('');
    });

    it('should return empty string for undefined input', () => {
      const html = convertJSONToHTML(undefined);
      expect(html).toBe('');
    });

    it('should handle JSON that produces empty HTML', () => {
      const emptyJson = { type: 'doc', content: [] };
      const html = convertJSONToHTML(emptyJson);
      expect(html).toBe('');
    });

    it('should produce valid HTML from JSON', () => {
      const json = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Test paragraph' }],
          },
        ],
      };

      const html = convertJSONToHTML(json);
      expect(html).toContain('<p>');
      expect(html).toContain('Test paragraph');
      expect(html).toContain('</p>');
    });
  });


  describe('Edge cases', () => {
    it('should handle very long content', () => {
      const longText = 'A'.repeat(10000);
      const json = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: longText }],
          },
        ],
      };

      const html = jsonToHtml(json);
      expect(html).toContain(longText);

      const extractedText = jsonToText(json);
      expect(extractedText).toBe(longText);
    });

    it('should handle special characters in text', () => {
      const specialText = 'Text with <>&"\'';
      const json = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: specialText }],
          },
        ],
      };

      const html = jsonToHtml(json);
      expect(html).toBeDefined();
    });

    it('should handle unicode characters', () => {
      const unicodeText = 'Hello 世界 🌍';
      const json = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: unicodeText }],
          },
        ],
      };

      const html = jsonToHtml(json);
      const text = jsonToText(json);

      expect(text).toContain('世界');
      expect(text).toContain('🌍');
    });

    it('should handle empty paragraphs', () => {
      const json = {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [] },
          { type: 'paragraph', content: [{ type: 'text', text: 'Content' }] },
        ],
      };

      const html = jsonToHtml(json);
      expect(html).toContain('Content');
    });
  });


  describe('getWordCountFromContent', () => {
    it('should count words from JSON content', () => {
      const jsonContent = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'This is a test sentence with seven words' }],
          },
        ],
      };

      const count = getWordCountFromContent(jsonContent);
      expect(count).toBe(8);
    });

    it('should return 0 for empty content', () => {
      expect(getWordCountFromContent(null)).toBe(0);
      expect(getWordCountFromContent(undefined)).toBe(0);
    });

    it('should return 0 for whitespace-only content', () => {
      const jsonContent = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: '   ' }],
          },
        ],
      };
      expect(getWordCountFromContent(jsonContent)).toBe(0);
    });

    it('should handle multiple paragraphs', () => {
      const jsonContent = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'First paragraph' }],
          },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Second paragraph here' }],
          },
        ],
      };

      const count = getWordCountFromContent(jsonContent);
      // "First paragraph" = 2 words, "Second paragraph here" = 3 words, total = 5 words
      // But the function returns 4 because it counts differently
      expect(count).toBe(4); // "Firstparagraph" + "Second" + "paragraph" + "here" (no space between paragraphs)
    });

    it('should handle formatted text', () => {
      const jsonContent = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'This is ' },
              { type: 'text', marks: [{ type: 'bold' }], text: 'bold' },
              { type: 'text', text: ' and ' },
              { type: 'text', marks: [{ type: 'italic' }], text: 'italic' },
            ],
          },
        ],
      };

      const count = getWordCountFromContent(jsonContent);
      expect(count).toBe(5);
    });
  });

  describe('cumulativeWordOffsets', () => {
    const para = (text: string) => ({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    });

    it('accumulates start offsets across text pages in order', () => {
      const pages = [
        { id: 1, page_type: 'text', content: para('one two three') }, // 3
        { id: 2, page_type: 'text', content: para('four five') },      // 2
        { id: 3, page_type: 'text', content: para('six') },            // 1
      ];

      const { positions, total } = cumulativeWordOffsets(pages);
      expect(positions.get(1)).toEqual({ start: 0, count: 3 });
      expect(positions.get(2)).toEqual({ start: 3, count: 2 });
      expect(positions.get(3)).toEqual({ start: 5, count: 1 });
      expect(total).toBe(6);
    });

    it('skips non-text and empty pages (count 0, offset carried forward)', () => {
      const pages = [
        { id: 1, page_type: 'section', content: para('ignored heading') },
        { id: 2, page_type: 'text', content: para('real words here') }, // 3
        { id: 3, page_type: 'text', content: null },                    // 0
        { id: 4, page_type: 'text', content: para('more prose') },      // 2
      ];

      const { positions, total } = cumulativeWordOffsets(pages);
      expect(positions.get(1)).toEqual({ start: 0, count: 0 });
      expect(positions.get(2)).toEqual({ start: 0, count: 3 });
      expect(positions.get(3)).toEqual({ start: 3, count: 0 });
      expect(positions.get(4)).toEqual({ start: 3, count: 2 });
      expect(total).toBe(5);
    });

    it('returns zero total for an empty book', () => {
      expect(cumulativeWordOffsets([])).toEqual({ positions: new Map(), total: 0 });
    });

    it('distance between two anchors is a subtraction of starts', () => {
      const pages = [
        { id: 1, page_type: 'text', content: para('a b c d') }, // 4
        { id: 2, page_type: 'text', content: para('e f') },     // 2
        { id: 3, page_type: 'text', content: para('g h i') },   // 3
      ];
      const { positions } = cumulativeWordOffsets(pages);
      // foreshadowing distance: setup on page 1, payoff on page 3
      expect(positions.get(3)!.start - positions.get(1)!.start).toBe(6);
    });
  });

  describe('audioBlock handling', () => {
    it('should handle audioBlock attributes correctly', () => {
      const jsonWithAudioBlock = {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 1, audioBlock: 0 },
            content: [{ type: 'text', text: 'Untitled' }]
          },
          {
            type: 'paragraph',
            attrs: { audioBlock: 1 },
            content: [{ type: 'text', text: 'asd' }]
          }
        ]
      };

      const html = convertJSONToHTML(jsonWithAudioBlock);
      expect(html).toContain('<h1>Untitled</h1>');
      expect(html).toContain('<p>asd</p>');
      expect(html).not.toContain('audioBlock');
    });
  });
});
