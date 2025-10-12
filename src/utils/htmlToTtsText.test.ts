import { describe, it, expect } from 'vitest';
import { htmlToTtsText } from './htmlToTtsText';

describe('htmlToTtsText', () => {
  describe('Basic HTML structure removal with SSML', () => {
    it('should handle h1 with classes and add emphasis', () => {
      const html = '<h1 class="text-4xl font-bold text-center">Published</h1>';
      const result = htmlToTtsText(html);
      expect(result).toContain('emphasis level="strong"');
      expect(result).toContain('Published');
      expect(result).toContain('break time="0.5s"');
    });

    it('should handle nested strong in h2 with emphasis', () => {
      const html = '<h2><strong>Chapitre 2 – Le Basculement</strong></h2>';
      const result = htmlToTtsText(html);
      expect(result).toContain('emphasis level="strong"');
      expect(result).toContain('Chapitre 2 – Le Basculement');
      expect(result).toContain('break time="0.5s"');
    });

    it('should handle h1 with empty paragraph', () => {
      const html = '<h1>Untitled</h1><p></p>';
      const result = htmlToTtsText(html);
      expect(result).toContain('Untitled');
      expect(result).toContain('emphasis level="strong"');
    });

    it('should handle multiple paragraphs with pauses', () => {
      const html = '<p>First paragraph.</p><p>Second paragraph.</p>';
      const result = htmlToTtsText(html);
      expect(result).toContain('First paragraph.');
      expect(result).toContain('Second paragraph.');
      expect(result).toContain('break time="0.3s"');
    });
  });

  describe('Script and style tag removal', () => {
    it('should strip script tags', () => {
      const html = '<p>Before</p><script>alert("bad")</script><p>After</p>';
      const result = htmlToTtsText(html);
      expect(result).toContain('Before');
      expect(result).toContain('After');
      expect(result).not.toContain('alert');
      expect(result).not.toContain('bad');
    });

    it('should strip style tags', () => {
      const html = '<p>Content</p><style>body { color: red; }</style>';
      const result = htmlToTtsText(html);
      expect(result).toContain('Content');
      expect(result).not.toContain('color');
      expect(result).not.toContain('body');
    });

    it('should handle inline script tags', () => {
      const html = '<p>Text <script>var x = 1;</script> more text</p>';
      const result = htmlToTtsText(html);
      expect(result).toContain('Text');
      expect(result).toContain('more text');
      expect(result).not.toContain('var x');
    });
  });

  describe('Inline formatting', () => {
    it('should handle inline formatting', () => {
      const html = '<p>This is <strong>bold</strong> and <em>italic</em> text.</p>';
      const result = htmlToTtsText(html);
      expect(result).toContain('This is bold and italic text.');
    });

    it('should handle links', () => {
      const html = '<p>Check out <a href="https://example.com">this link</a> for more.</p>';
      const result = htmlToTtsText(html);
      expect(result).toContain('Check out this link for more.');
    });

    it('should handle code inline', () => {
      const html = '<p>Use the <code>console.log()</code> function.</p>';
      const result = htmlToTtsText(html);
      expect(result).toContain('Use the console.log() function.');
    });
  });

  describe('Lists with pauses', () => {
    it('should handle unordered lists with pauses', () => {
      const html = '<ul><li>First item</li><li>Second item</li></ul>';
      const result = htmlToTtsText(html);
      expect(result).toContain('First item');
      expect(result).toContain('Second item');
      expect(result).toContain('break time="0.3s"');
    });

    it('should handle ordered lists with pauses', () => {
      const html = '<ol><li>First</li><li>Second</li><li>Third</li></ol>';
      const result = htmlToTtsText(html);
      expect(result).toContain('First');
      expect(result).toContain('Second');
      expect(result).toContain('Third');
      expect(result).toContain('break time="0.3s"');
    });

    it('should handle nested lists with pauses', () => {
      const html = '<ul><li>Item 1<ul><li>Sub 1</li><li>Sub 2</li></ul></li><li>Item 2</li></ul>';
      const result = htmlToTtsText(html);
      expect(result).toContain('Item 1');
      expect(result).toContain('Sub 1');
      expect(result).toContain('Sub 2');
      expect(result).toContain('Item 2');
      expect(result).toContain('break time="0.3s"');
    });
  });

  describe('Complex structures with SSML', () => {
    it('should handle complex nested structure with emphasis and pauses', () => {
      const html = `
        <div class="container">
          <h1>Title</h1>
          <p>Paragraph with <strong>bold</strong> text.</p>
          <ul>
            <li>Item 1</li>
            <li>Item 2</li>
          </ul>
        </div>
      `;
      const result = htmlToTtsText(html);
      expect(result).toContain('Title');
      expect(result).toContain('Paragraph with bold text.');
      expect(result).toContain('Item 1');
      expect(result).toContain('Item 2');
      expect(result).toContain('emphasis level="strong"');
      expect(result).toContain('break time');
    });

    it('should handle blockquotes with pauses', () => {
      const html = '<blockquote>This is a quote</blockquote>';
      const result = htmlToTtsText(html);
      expect(result).toContain('This is a quote');
      expect(result).toContain('break time="0.3s"');
    });

    it('should handle code blocks', () => {
      const html = '<pre><code>const x = 5;</code></pre>';
      const result = htmlToTtsText(html);
      expect(result).toContain('const x = 5;');
    });

    it('should handle tables', () => {
      const html = `
        <table>
          <tr><th>Header 1</th><th>Header 2</th></tr>
          <tr><td>Cell 1</td><td>Cell 2</td></tr>
        </table>
      `;
      const result = htmlToTtsText(html);
      expect(result).toBe('Header 1 Header 2 Cell 1 Cell 2');
    });
  });

  describe('HTML entities', () => {
    it('should decode common HTML entities', () => {
      const html = '<p>Text with &amp; ampersand &lt; less than &gt; greater than</p>';
      const result = htmlToTtsText(html);
      expect(result).toContain('Text with & ampersand < less than > greater than');
    });

    it('should decode quotes', () => {
      const html = '<p>&quot;Quote&quot; and &#39;apostrophe&#39;</p>';
      const result = htmlToTtsText(html);
      expect(result).toContain('"Quote" and \'apostrophe\'');
    });

    it('should decode special characters', () => {
      const html = '<p>&copy; &reg; &trade; &euro; &pound; &yen;</p>';
      const result = htmlToTtsText(html);
      expect(result).toContain('© ® ™ € £ ¥');
    });

    it('should decode numeric entities', () => {
      const html = '<p>Em dash &#8212; and en dash &#8211;</p>';
      const result = htmlToTtsText(html);
      expect(result).toContain('Em dash — and en dash –');
    });

    it('should decode hex entities', () => {
      const html = '<p>Hex entity: &#x2022; bullet</p>';
      const result = htmlToTtsText(html);
      expect(result).toContain('Hex entity: • bullet');
    });

    it('should decode non-breaking space', () => {
      const html = '<p>Word&nbsp;with&nbsp;nbsp</p>';
      const result = htmlToTtsText(html);
      expect(result).toContain('Word with nbsp');
    });
  });

  describe('Whitespace handling', () => {
    it('should handle empty string', () => {
      const html = '';
      const result = htmlToTtsText(html);
      expect(result).toBe('');
    });

    it('should normalize whitespace', () => {
      const html = '<p>Text   with    multiple     spaces</p>';
      const result = htmlToTtsText(html);
      expect(result).toContain('Text with multiple spaces');
    });

    it('should handle br tags with pauses', () => {
      const html = '<p>Line 1<br>Line 2<br/>Line 3</p>';
      const result = htmlToTtsText(html);
      expect(result).toContain('Line 1');
      expect(result).toContain('Line 2');
      expect(result).toContain('Line 3');
      expect(result).toContain('break time="0.3s"');
    });

    it('should normalize newlines and tabs', () => {
      const html = '<p>Line 1\n\nLine 2\t\tLine 3</p>';
      const result = htmlToTtsText(html);
      expect(result).toContain('Line 1 Line 2 Line 3');
    });

    it('should trim leading and trailing whitespace', () => {
      const html = '  <p>  Content  </p>  ';
      const result = htmlToTtsText(html);
      expect(result).toContain('Content');
    });
  });

  describe('Edge cases', () => {
    it('should handle mixed heading levels with appropriate emphasis', () => {
      const html = '<h1>Main Title</h1><h2>Subtitle</h2><h3>Section</h3><p>Content</p>';
      const result = htmlToTtsText(html);
      expect(result).toContain('Main Title');
      expect(result).toContain('Subtitle');
      expect(result).toContain('Section');
      expect(result).toContain('Content');
      expect(result).toContain('emphasis level="strong"'); // h1 and h2
      expect(result).toContain('emphasis level="moderate"'); // h3
      expect(result).toContain('break time');
    });

    it('should handle Unicode characters', () => {
      const html = '<p>Café, naïve, résumé, 日本語, 中文, العربية</p>';
      const result = htmlToTtsText(html);
      expect(result).toContain('Café, naïve, résumé, 日本語, 中文, العربية');
      expect(result).toContain('break time="0.3s"'); // paragraph pause
    });

    it('should handle self-closing tags', () => {
      const html = '<p>Before<hr/>After</p>';
      const result = htmlToTtsText(html);
      expect(result).toContain('Before');
      expect(result).toContain('After');
    });

    it('should handle image tags without extracting alt', () => {
      const html = '<p>Before <img src="image.jpg" alt="Description"> After</p>';
      const result = htmlToTtsText(html);
      // Note: We don't extract alt text in this simple implementation
      expect(result).toContain('Before');
      expect(result).toContain('After');
    });

    it('should handle malformed HTML gracefully', () => {
      const html = '<p>Unclosed paragraph<div>Nested <strong>content</div>';
      const result = htmlToTtsText(html);
      expect(result).toContain('Unclosed paragraph');
      expect(result).toContain('Nested');
      expect(result).toContain('content');
    });

    it('should handle attributes with special characters', () => {
      const html = '<a href="page?param=value&other=123">Link</a>';
      const result = htmlToTtsText(html);
      expect(result).toBe('Link');
    });

    it('should handle empty tags', () => {
      const html = '<p></p><div></div><span></span>Content';
      const result = htmlToTtsText(html);
      expect(result).toContain('Content');
      // Empty p tags still generate break tags
    });

    it('should handle only whitespace', () => {
      const html = '<p>   </p><div>\n\n</div>';
      const result = htmlToTtsText(html);
      // Empty p tags generate breaks, but no actual content
      expect(result.replace(/<[^>]*>/g, '').trim()).toBe('');
    });
  });

  describe('Real-world examples with SSML', () => {
    it('should handle TipTap editor output with emphasis and pauses', () => {
      const html = '<h1>Chapter 1</h1><p>This is <strong>important</strong> content with a <a href="#">link</a>.</p><ul><li>Point 1</li><li>Point 2</li></ul>';
      const result = htmlToTtsText(html);
      expect(result).toContain('Chapter 1');
      expect(result).toContain('important');
      expect(result).toContain('content');
      expect(result).toContain('Point 1');
      expect(result).toContain('Point 2');
      expect(result).toContain('emphasis level="strong"'); // h1
      expect(result).toContain('break time');
    });

    it('should handle French text with accents, special characters, and emphasis', () => {
      const html = '<h2><strong>Chapitre 2 &ndash; Le Basculement</strong></h2><p>C&rsquo;est tr&egrave;s important.</p>';
      const result = htmlToTtsText(html);
      expect(result).toContain('Chapitre 2 – Le Basculement');
      expect(result).toContain("C\u2019est très important."); // with curly quote from &rsquo;
      expect(result).toContain('emphasis level="strong"');
      expect(result).toContain('break time');
    });

    it('should handle multiple heading styles with appropriate emphasis levels', () => {
      const html = '<h1 class="text-4xl font-bold text-center">Published</h1><h2 class="subtitle">Overview</h2><h3>Details</h3>';
      const result = htmlToTtsText(html);
      expect(result).toContain('Published');
      expect(result).toContain('Overview');
      expect(result).toContain('Details');
      expect(result).toContain('emphasis level="strong"'); // h1 and h2
      expect(result).toContain('emphasis level="moderate"'); // h3
      expect(result).toContain('break time="0.5s"'); // h1 and h2
      expect(result).toContain('break time="0.4s"'); // h3
    });
  });
});

