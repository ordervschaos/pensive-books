/**
 * Utility functions for working with TipTap JSON content
 */

// Conditional import based on environment
// In browser, use @tiptap/html; in Node/test, use @tiptap/html (default export works in both)
import { generateHTML as generateHTMLBrowser } from '@tiptap/html';
import { StarterKit } from '@tiptap/starter-kit';
import { Link } from '@tiptap/extension-link';
import { Image } from '@tiptap/extension-image';
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight';
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table';
import { Title } from '@/components/editor/extensions/Title';
import { SmartTypography } from '@/components/editor/extensions/SmartTypography';
import { common, createLowlight } from 'lowlight';

const lowlight = createLowlight(common);

// Extensions matching the editor config.
// NOTE: ParagraphObjective is intentionally EXCLUDED. Author-only paragraph objectives
// live as `data-objective` attributes in the stored JSON; omitting the extension makes
// generateHTML() drop those attributes, so objectives never leak into exported
// EPUB/Kindle HTML. Do NOT add ParagraphObjective to this list.
const extensions = [
  Title,
  SmartTypography,
  StarterKit.configure({
    document: false,
    codeBlock: false,
  }),
  CodeBlockLowlight.configure({
    lowlight,
  }),
  Link,
  Image,
  Table,
  TableRow,
  TableCell,
  TableHeader,
];

// Use the browser version - it works in both environments when window is defined
const generateHTML = generateHTMLBrowser;

/**
 * Convert TipTap JSON content to HTML string
 */
export const jsonToHtml = (json: any): string => {
  if (!json) return '';
  try {
    let html = generateHTML(json, extensions);

    // Remove xmlns attributes that are added in Node environment
    html = html.replace(/ xmlns="http:\/\/www\.w3\.org\/1999\/xhtml"/g, '');

    // Check if HTML contains images
    if (html.includes('<img')) {
      const imgMatches = html.match(/<img[^>]*src="([^"]+)"[^>]*>/g);
      if (imgMatches) {
        console.log(`jsonToHtml: Generated HTML with ${imgMatches.length} image(s)`);
        imgMatches.forEach(match => {
          const srcMatch = match.match(/src="([^"]+)"/);
          if (srcMatch) {
            console.log(`  - Image src: ${srcMatch[1]}`);
          }
        });
      }
    }
    return html;
  } catch (error) {
    console.error('Error converting JSON to HTML:', error);
    return '';
  }
};


/**
 * Extract plain text from TipTap JSON content
 */
export const jsonToText = (json: any): string => {
  if (!json || !json.content) return '';

  const extractText = (node: any): string => {
    if (node.type === 'text') {
      return node.text || '';
    }

    if (node.content && Array.isArray(node.content)) {
      return node.content.map(extractText).join('');
    }

    return '';
  };

  try {
    return extractText(json);
  } catch (error) {
    console.error('Error extracting text from JSON:', error);
    return '';
  }
};

/**
 * Extract plain text from HTML string (fallback)
 */
export const htmlToText = (html: string): string => {
  if (!html) return '';

  try {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;
    return tempDiv.textContent || tempDiv.innerText || '';
  } catch (error) {
    console.error('Error extracting text from HTML:', error);
    return '';
  }
};

/**
 * Get text content from JSON content
 * @deprecated Use jsonToText directly
 */
export const getTextContent = (jsonContent: any, htmlContent?: string): string => {
  if (jsonContent) {
    const text = jsonToText(jsonContent);
    if (text) return text;
  }

  // Fallback for legacy code
  if (htmlContent) {
    return htmlToText(htmlContent);
  }

  return '';
};

/**
 * Get text content from JSON content (simplified API)
 */
export const getTextFromContent = (jsonContent: any): string => {
  return jsonToText(jsonContent);
};

/**
 * Remove unsupported marks and attributes from JSON content
 * This is needed when converting content for export formats
 */
const stripUnsupportedMarks = (json: any): any => {
  if (!json) return json;

  const processNode = (node: any): any => {
    if (!node) return node;

    // Create a clean copy of the node without unsupported attributes
    const cleanNode: any = {
      type: node.type,
    };

    // Copy supported attributes, excluding custom ones like audioBlock
    if (node.attrs) {
      const cleanAttrs: any = {};
      for (const [key, value] of Object.entries(node.attrs)) {
        // Only keep standard TipTap attributes, exclude custom ones
        if (!['audioBlock'].includes(key)) {
          cleanAttrs[key] = value;
        }
      }
      if (Object.keys(cleanAttrs).length > 0) {
        cleanNode.attrs = cleanAttrs;
      }
    }

    // Copy text content
    if (node.text) {
      cleanNode.text = node.text;
    }

    // Copy marks (formatting)
    if (node.marks) {
      cleanNode.marks = node.marks;
    }

    // Recursively process content arrays
    if (node.content && Array.isArray(node.content)) {
      cleanNode.content = node.content.map(processNode);
    }

    return cleanNode;
  };

  return processNode(json);
};


/**
 * Get HTML from JSON content (simplified API)
 */
export const convertJSONToHTML = (jsonContent: any): string => {
  if (!jsonContent) return '';
  const cleanedJson = stripUnsupportedMarks(jsonContent);
  return jsonToHtml(cleanedJson);
};

/**
 * Get word count from content
 * @deprecated Use getWordCountFromContent
 */
export const getWordCount = (jsonContent: any, htmlContent?: string): number => {
  const text = getTextContent(jsonContent, htmlContent);
  if (!text.trim()) return 0;
  return text.trim().split(/\s+/).length;
};

/**
 * Get word count from JSON content (simplified API)
 */
export const getWordCountFromContent = (jsonContent: any): number => {
  const text = jsonToText(jsonContent);
  if (!text.trim()) return 0;
  return text.trim().split(/\s+/).length;
};

/** Where a page sits in the manuscript, measured in words. */
export interface PageWordPosition {
  /** Number of manuscript words BEFORE this page begins. */
  start: number;
  /** This page's own word count (0 for non-text or empty pages). */
  count: number;
}

/**
 * Cumulative word offsets across an ordered list of pages.
 *
 * `start` is the distance primitive that foreshadowing / thread tracking is built on:
 * the number of words before a page begins, so the gap between any two anchors is just a
 * subtraction. Only `text` pages contribute to the running total; section/other pages get
 * count 0 and carry the current offset forward.
 *
 * Pages MUST already be in reading (page_index) order — only the per-page `start` depends on
 * order; `total` is order-independent.
 */
export const cumulativeWordOffsets = <
  T extends { id: number; page_type?: string | null; content?: any }
>(
  pages: T[]
): { positions: Map<number, PageWordPosition>; total: number } => {
  const positions = new Map<number, PageWordPosition>();
  let running = 0;
  for (const page of pages) {
    const count =
      page.page_type === 'text' && page.content ? getWordCountFromContent(page.content) : 0;
    positions.set(page.id, { start: running, count });
    running += count;
  }
  return { positions, total: running };
};

/**
 * Convert TipTap JSON content to Markdown string
 */
export const jsonToMarkdown = (json: any): string => {
  if (!json || !json.content) return '';

  const processMarks = (text: string, marks?: any[]): string => {
    if (!marks || marks.length === 0) return text;

    let result = text;
    for (const mark of marks) {
      switch (mark.type) {
        case 'bold':
          result = `**${result}**`;
          break;
        case 'italic':
          result = `*${result}*`;
          break;
        case 'strike':
          result = `~~${result}~~`;
          break;
        case 'code':
          result = `\`${result}\``;
          break;
        case 'link':
          result = `[${result}](${mark.attrs?.href || ''})`;
          break;
      }
    }
    return result;
  };

  const processNode = (node: any, listType?: 'bullet' | 'ordered', listIndex?: number): string => {
    if (!node) return '';

    switch (node.type) {
      case 'doc':
        return node.content?.map((child: any) => processNode(child)).join('\n\n') || '';

      case 'title':
      case 'heading': {
        const level = node.attrs?.level || 1;
        const prefix = '#'.repeat(level);
        const text = node.content?.map((child: any) => processNode(child)).join('') || '';
        return `${prefix} ${text}`;
      }

      case 'paragraph': {
        const text = node.content?.map((child: any) => processNode(child)).join('') || '';
        return text;
      }

      case 'text':
        return processMarks(node.text || '', node.marks);

      case 'hardBreak':
        return '  \n';

      case 'horizontalRule':
        return '---';

      case 'codeBlock': {
        const language = node.attrs?.language || '';
        const code = node.content?.map((child: any) => child.text || '').join('') || '';
        return `\`\`\`${language}\n${code}\n\`\`\``;
      }

      case 'blockquote': {
        const content = node.content?.map((child: any) => processNode(child)).join('\n') || '';
        return content.split('\n').map((line: string) => `> ${line}`).join('\n');
      }

      case 'bulletList': {
        return node.content?.map((child: any) => processNode(child, 'bullet')).join('\n') || '';
      }

      case 'orderedList': {
        return node.content?.map((child: any, index: number) => processNode(child, 'ordered', index + 1)).join('\n') || '';
      }

      case 'listItem': {
        const prefix = listType === 'ordered' ? `${listIndex}. ` : '- ';
        const content = node.content?.map((child: any) => processNode(child)).join('\n') || '';
        // Handle nested content with proper indentation
        const lines = content.split('\n');
        return lines.map((line: string, i: number) => i === 0 ? `${prefix}${line}` : `  ${line}`).join('\n');
      }

      case 'image': {
        const src = node.attrs?.src || '';
        const alt = node.attrs?.alt || '';
        const title = node.attrs?.title || '';
        return title ? `![${alt}](${src} "${title}")` : `![${alt}](${src})`;
      }

      case 'table': {
        const rows = node.content || [];
        if (rows.length === 0) return '';

        const processCell = (cell: any): string => {
          return cell.content?.map((child: any) => processNode(child)).join(' ') || '';
        };

        const tableRows: string[] = [];
        rows.forEach((row: any, rowIndex: number) => {
          const cells = row.content || [];
          const rowContent = cells.map((cell: any) => processCell(cell)).join(' | ');
          tableRows.push(`| ${rowContent} |`);

          // Add separator after header row
          if (rowIndex === 0) {
            const separator = cells.map(() => '---').join(' | ');
            tableRows.push(`| ${separator} |`);
          }
        });

        return tableRows.join('\n');
      }

      default:
        // For unknown nodes, try to extract text content
        if (node.content) {
          return node.content.map((child: any) => processNode(child)).join('');
        }
        return node.text || '';
    }
  };

  try {
    const cleanedJson = stripUnsupportedMarks(json);
    return processNode(cleanedJson);
  } catch (error) {
    console.error('Error converting JSON to Markdown:', error);
    return '';
  }
};
