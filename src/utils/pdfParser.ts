
import * as pdfjs from 'pdfjs-dist';

// Set worker source
pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

interface ExtractedPage {
  content: string;
  title?: string;
  isSection: boolean;
}

interface ParsedPDF {
  title: string;
  pages: ExtractedPage[];
}

/**
 * Extract text content from a specific page of a PDF
 */
async function extractPageText(page: any): Promise<string> {
  const textContent = await page.getTextContent();
  let lastY: number | null = null;
  let text = '';

  for (const item of textContent.items) {
    if (lastY === null || Math.abs((item as any).transform[5] - lastY) > 5) {
      text += '\n';
    }
    text += (item as any).str;
    lastY = (item as any).transform[5];
  }

  return text.trim();
}

/**
 * Determine if a page is likely a section based on its content
 */
function identifyPageType(pageText: string, pageNum: number): { isSection: boolean; title?: string } {
  // Section identification logic
  // 1. Very short pages with few words are likely section dividers
  // 2. Pages with large text at the top (chapter headings)
  const lines = pageText.split('\n').filter(line => line.trim().length > 0);
  
  if (lines.length === 0) {
    return { isSection: false };
  }
  
  // If the page is very short (just a few lines) and the first line looks like a title
  if (lines.length < 5 && lines[0].length < 100) {
    return { 
      isSection: true, 
      title: lines[0].trim() 
    };
  }
  
  // If the first line looks like a title (e.g., "Chapter 1", "Introduction", etc.)
  const firstLine = lines[0].trim();
  const chapterPattern = /^(chapter|section|part)\s+\w+/i;
  
  if (chapterPattern.test(firstLine) || firstLine.length < 50) {
    return { 
      isSection: true, 
      title: firstLine 
    };
  }
  
  // First page is usually a title page
  if (pageNum === 0) {
    return { 
      isSection: true, 
      title: firstLine 
    };
  }
  
  return { isSection: false };
}

/**
 * Format the extracted text into HTML
 */
function formatContentAsHtml(text: string, isSection: boolean, title?: string): string {
  const lines = text.split('\n').filter(line => line.trim().length > 0);
  
  if (isSection && title) {
    // For section pages, create centered title
    return `<h1 class="text-4xl font-bold text-center">${title}</h1>`;
  }
  
  // For regular content pages
  let html = '';
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    if (trimmedLine.length === 0) continue;
    
    // Add paragraphs for each line of text
    html += `<p>${trimmedLine}</p>`;
  }
  
  return html;
}

/**
 * Parse a PDF file and extract its content
 */
export async function parsePDF(file: File): Promise<ParsedPDF> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  
  const numPages = pdf.numPages;
  let bookTitle = file.name.replace('.pdf', '');
  const extractedPages: ExtractedPage[] = [];

  for (let i = 1; i <= numPages; i++) {
    const page = await pdf.getPage(i);
    const pageText = await extractPageText(page);
    
    // Identify if this is a section or regular content page
    const { isSection, title } = identifyPageType(pageText, i - 1);
    
    // Use the title of the first page as the book title if it's a section
    if (i === 1 && isSection && title) {
      bookTitle = title;
    }
    
    const htmlContent = formatContentAsHtml(pageText, isSection, title);
    
    extractedPages.push({
      content: htmlContent,
      title: title || `Page ${i}`,
      isSection
    });
  }
  
  return {
    title: bookTitle,
    pages: extractedPages
  };
}
