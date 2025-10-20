/**
 * Utility functions for working with TipTap JSON content
 */

import { generateHTML, generateJSON } from '@tiptap/html';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import { Title } from '@/components/editor/extensions/Title';
import { lowlight } from '@/components/editor/config/editorConfig';

// Extensions matching the editor config
const extensions = [
  Title,
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

/**
 * Convert TipTap JSON content to HTML string
 */
export const jsonToHtml = (json: any): string => {
  if (!json) return '';
  try {
    const html = generateHTML(json, extensions);
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
 * Convert HTML string to TipTap JSON content
 */
export const htmlToJson = (html: string): any => {
  if (!html) return null;
  try {
    return generateJSON(html, extensions);
  } catch (error) {
    console.error('Error converting HTML to JSON:', error);
    return null;
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
 * Remove unsupported marks from JSON content
 * This is needed when converting content for export formats
 */
const stripUnsupportedMarks = (json: any): any => {
  if (!json) return json;

  const processNode = (node: any): any => {
    if (!node) return node;

    // If this is a text node with marks, filter out unsupported marks
    if (node.type === 'text' && node.marks) {
      // Currently no unsupported marks to filter out
      return node;
    }

    // Recursively process content arrays
    if (node.content && Array.isArray(node.content)) {
      return {
        ...node,
        content: node.content.map(processNode)
      };
    }

    return node;
  };

  return processNode(json);
};

/**
 * Get HTML content from JSON content
 * @deprecated Use jsonToHtml directly or getHtmlFromContent
 */
export const getHtmlContent = (jsonContent: any, htmlContent?: string): string => {
  if (jsonContent) {
    // Strip unsupported marks before conversion
    const cleanedJson = stripUnsupportedMarks(jsonContent);
    const html = jsonToHtml(cleanedJson);
    if (html) return html;
  }

  // Fallback for legacy code
  return htmlContent || '';
};

/**
 * Get HTML from JSON content (simplified API)
 */
export const getHtmlFromContent = (jsonContent: any): string => {
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
