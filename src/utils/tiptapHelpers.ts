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

// Extensions matching the editor config
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
