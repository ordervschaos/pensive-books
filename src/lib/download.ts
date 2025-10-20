import { Database } from '@/integrations/supabase/types';
import { supabase } from '@/integrations/supabase/client';
import { generateEPUB } from './epub';
import { prepareEPUBContent, EPUBOptions } from './epub-generator';
import jsPDF from 'jspdf';
import { convertJSONToHTML } from '@/utils/tiptapHelpers';

type Page = Database['public']['Tables']['pages']['Row'] & {
  page_type: 'section' | 'page';
};

interface DownloadOptions {
  bookId: number;
  name: string;
  author?: string | null;
  coverUrl?: string | null;
  subtitle?: string | null;
  showTextOnCover?: boolean;
  returnBlob?: boolean;
}

interface GenerateResult {
  success: boolean;
  blob?: Blob;
  error?: {
    message: string;
    details?: unknown;
  };
}

// Helper function to load images
const loadImage = (url: string): Promise<HTMLImageElement> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    
    // Set a timeout to prevent hanging
    const timeoutId = setTimeout(() => {
      img.src = ''; // Cancel loading
      reject(new Error(`Image load timeout: ${url}`));
    }, 10000); // 10 second timeout
    
    img.onload = () => {
      clearTimeout(timeoutId);
      resolve(img);
    };
    
    img.onerror = (error) => {
      clearTimeout(timeoutId);
      reject(new Error(`Failed to load image: ${url}`));
    };
    
    img.src = url;
  });
};

const fetchBookPages = async (bookId: number): Promise<Page[]> => {
  const { data: pages, error } = await supabase
    .from("pages")
    .select("*")
    .eq("book_id", bookId)
    .eq("archived", false)
    .order("page_index", { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch pages: ${error.message}`);
  }

  return (pages || []).map(page => ({
    ...page,
    page_type: page.page_type as 'section' | 'page'
  }));
};

// Process HTML content to extract formatted text and images
const processHtmlContent = (html: string): { 
  elements: Array<{
    type: 'text' | 'heading' | 'paragraph' | 'list' | 'listItem' | 'blockquote' | 'code' | 'image';
    content: string;
    level?: number;
    url?: string;
    isIndented?: boolean;
  }>;
  images: Array<{ url: string; afterElement: number }>;
} => {
  if (!html) return { elements: [], images: [] };

  const div = document.createElement('div');
  div.innerHTML = html;

  const elements: Array<{
    type: 'text' | 'heading' | 'paragraph' | 'list' | 'listItem' | 'blockquote' | 'code' | 'image';
    content: string;
    level?: number;
    url?: string;
    isIndented?: boolean;
  }> = [];
  const images: Array<{ url: string; afterElement: number }> = [];
  
  // Process the content in order, handling images as they appear
  const processNode = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent?.trim();
      if (text) {
        elements.push({
          type: 'text',
          content: text
        });
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as Element;
      
      // Handle images
      if (element.tagName.toLowerCase() === 'img') {
        const src = element.getAttribute('src');
        if (src) {
          // Store the image URL and the current element count
          images.push({
            url: src,
            afterElement: elements.length
          });
          // Add image element
          elements.push({
            type: 'image',
            content: '',
            url: src
          });
        }
      }
      // Handle headings
      else if (element.tagName.match(/^h[1-6]$/i)) {
        const level = parseInt(element.tagName.substring(1));
        elements.push({
          type: 'heading',
          content: element.textContent?.trim() || '',
          level
        });
      }
      // Handle paragraphs
      else if (element.tagName.toLowerCase() === 'p') {
        elements.push({
          type: 'paragraph',
          content: element.textContent?.trim() || ''
        });
      }
      // Handle lists
      else if (element.tagName.toLowerCase() === 'ul' || element.tagName.toLowerCase() === 'ol') {
        elements.push({
          type: 'list',
          content: element.tagName.toLowerCase() === 'ul' ? 'bullet' : 'number'
        });
        
        element.querySelectorAll('li').forEach(li => {
          elements.push({
            type: 'listItem',
            content: li.textContent?.trim() || '',
            isIndented: true
          });
        });
      }
      // Handle blockquotes
      else if (element.tagName.toLowerCase() === 'blockquote') {
        elements.push({
          type: 'blockquote',
          content: element.textContent?.trim() || '',
          isIndented: true
        });
      }
      // Handle code blocks
      else if (element.tagName.toLowerCase() === 'pre' || element.tagName.toLowerCase() === 'code') {
        elements.push({
          type: 'code',
          content: element.textContent?.trim() || '',
          isIndented: true
        });
      }
      // Process child nodes for other elements
      else {
        Array.from(element.childNodes).forEach(child => {
          processNode(child);
        });
      }
    }
  };

  // Process all nodes in the div
  Array.from(div.childNodes).forEach(node => {
    processNode(node);
  });

  return { elements, images };
};

// Create a cover page for the PDF
const createCoverPage = async (
  pdf: jsPDF, 
  options: DownloadOptions, 
  pageWidth: number, 
  pageHeight: number
): Promise<void> => {
  if (options.coverUrl) {
    try {
      const coverImg = await loadImage(options.coverUrl);
      const coverAspectRatio = coverImg.height / coverImg.width;
      
      // Make image cover the entire page
      let imgWidth = pageWidth;
      let imgHeight = imgWidth * coverAspectRatio;

      // If height is too short, scale by height instead
      if (imgHeight < pageHeight) {
        imgHeight = pageHeight;
        imgWidth = imgHeight / coverAspectRatio;
      }

      // Center the image if it's wider than the page
      const xPos = (pageWidth - imgWidth) / 2;
      const yPos = 0; // Start from top of page

      // Add the cover image
      pdf.addImage(coverImg, 'JPEG', xPos, yPos, imgWidth, imgHeight);

      // Add a light overlay for better text visibility
      pdf.setFillColor(0, 0, 0);
      pdf.setGState({ opacity: 0.4 });
      pdf.rect(0, 0, pageWidth, pageHeight, 'F');
      pdf.setGState({ opacity: 1 });

      // Add title text with white color
      pdf.setTextColor(255, 255, 255);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(42);

      const titleLines = pdf.splitTextToSize(options.name, pageWidth * 0.8);
      let textY = pageHeight * 0.4;

      // Center and add title lines with shadow effect
      titleLines.forEach(line => {
        const textWidth = pdf.getStringUnitWidth(line) * pdf.getFontSize();
        const textX = (pageWidth - textWidth) / 2;
        
        // Add shadow effect
        pdf.setTextColor(0, 0, 0);
        pdf.text(line, textX + 2, textY + 2);
        
        // Add main text
        pdf.setTextColor(255, 255, 255);
        pdf.text(line, textX, textY);
        
        textY += 60;
      });

      // Add subtitle if available
      if (options.subtitle) {
        textY += 25;
        pdf.setFontSize(28);
        pdf.setFont('helvetica', 'italic');
        const subtitleLines = pdf.splitTextToSize(options.subtitle, pageWidth * 0.8);
        subtitleLines.forEach(line => {
          const textWidth = pdf.getStringUnitWidth(line) * pdf.getFontSize();
          const textX = (pageWidth - textWidth) / 2;
          
          // Add shadow effect
          pdf.setTextColor(0, 0, 0);
          pdf.text(line, textX + 1, textY + 1);
          
          // Add main text
          pdf.setTextColor(255, 255, 255);
          pdf.text(line, textX, textY);
          
          textY += 40;
        });
      }

      // Add author if available
      if (options.author) {
        textY += 45;
        pdf.setFontSize(24);
        pdf.setFont('helvetica', 'normal');
        const authorText = `by ${options.author}`;
        const textWidth = pdf.getStringUnitWidth(authorText) * pdf.getFontSize();
        const textX = (pageWidth - textWidth) / 2;
        
        // Add shadow effect
        pdf.setTextColor(0, 0, 0);
        pdf.text(authorText, textX + 1, textY + 1);
        
        // Add main text
        pdf.setTextColor(255, 255, 255);
        pdf.text(authorText, textX, textY);
      }
    } catch (error) {
      console.warn('Failed to add cover image:', error);
      // Fall back to plain cover
      createPlainCover(pdf, options, pageWidth, pageHeight);
    }
  } else {
    // Create plain cover
    createPlainCover(pdf, options, pageWidth, pageHeight);
  }
};

// Create a plain cover page when no image is available
const createPlainCover = (
  pdf: jsPDF, 
  options: DownloadOptions, 
  pageWidth: number, 
  pageHeight: number
): void => {
  // Create a plain dark background cover
  pdf.setFillColor(20, 20, 20); // Dark background
  pdf.rect(0, 0, pageWidth, pageHeight, 'F');

  // Add title text with white color
  pdf.setTextColor(255, 255, 255);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(36);

  const titleLines = pdf.splitTextToSize(options.name, pageWidth * 0.8);
  let textY = pageHeight * 0.4;

  // Center and add title lines
  titleLines.forEach(line => {
    const textWidth = pdf.getStringUnitWidth(line) * pdf.getFontSize();
    const textX = (pageWidth - textWidth) / 2;
    pdf.text(line, textX, textY);
    textY += 50;
  });

  if (options.subtitle) {
    textY += 20;
    pdf.setFontSize(24);
    pdf.setFont('helvetica', 'italic');
    const subtitleLines = pdf.splitTextToSize(options.subtitle, pageWidth * 0.8);
    subtitleLines.forEach(line => {
      const textWidth = pdf.getStringUnitWidth(line) * pdf.getFontSize();
      const textX = (pageWidth - textWidth) / 2;
      pdf.text(line, textX, textY);
      textY += 35;
    });
  }

  if (options.author) {
    textY += 40;
    pdf.setFontSize(20);
    pdf.setFont('helvetica', 'normal');
    const authorText = `by ${options.author}`;
    const textWidth = pdf.getStringUnitWidth(authorText) * pdf.getFontSize();
    const textX = (pageWidth - textWidth) / 2;
    pdf.text(authorText, textX, textY);
  }
};

// Create a table of contents page
const createTableOfContents = (
  pdf: jsPDF,
  pages: Page[],
  tocPageNumbers: { [key: string]: number },
  pageWidth: number,
  pageHeight: number,
  margin: number
): void => {
  pdf.setFont('times', 'bold');
  pdf.setFontSize(24);
  pdf.text('Table of Contents', margin, margin + 20);

  let tocY = margin + 60;
  let sectionCount = 0;
  let pageCount = 0;

  // Generate TOC with accurate page numbers
  pages.forEach((page) => {
    if (tocY > pageHeight - margin) {
      pdf.addPage();
      tocY = margin + 20;
    }

    const pageNum = tocPageNumbers[page.id];
    
    if (page.page_type === 'section') {
      sectionCount++;
      const title = page.title || `Section ${sectionCount}`;
      pdf.setFont('times', 'bold');
      pdf.setFontSize(18);
      
      // Add section text
      pdf.text(`${sectionCount}. ${title}`, margin, tocY);
      
      // Add page number
      const pageNumText = pageNum.toString();
      const pageNumWidth = pdf.getStringUnitWidth(pageNumText) * pdf.getFontSize();
      pdf.text(pageNumText, pageWidth - margin - pageNumWidth, tocY);
      
      // Add link
      pdf.link(margin, tocY - 15, pageWidth - (2 * margin), 20, { pageNumber: pageNum });
      
      tocY += 30;
    } else {
      pageCount++;
      pdf.setFont('times', 'normal');
      pdf.setFontSize(14);
      const title = page.title || `Page ${pageCount}`;
      
      // Add title text
      pdf.text(`${title}`, margin + 20, tocY);
      
      // Add dotted line
      const titleWidth = pdf.getStringUnitWidth(title) * pdf.getFontSize();
      const pageNumText = pageNum.toString();
      const pageNumWidth = pdf.getStringUnitWidth(pageNumText) * pdf.getFontSize();
      const dotsStart = margin + 20 + titleWidth + 10;
      const dotsEnd = pageWidth - margin - pageNumWidth - 10;
      
      for (let x = dotsStart; x < dotsEnd; x += 5) {
        pdf.text('.', x, tocY);
      }
      
      // Add page number
      pdf.text(pageNumText, pageWidth - margin - pageNumWidth, tocY);
      
      // Add link
      pdf.link(margin + 20, tocY - 15, pageWidth - (2 * margin) - 20, 20, { pageNumber: pageNum });
      
      tocY += 25;
    }
  });
};

// Render a section page
const renderSectionPage = (
  pdf: jsPDF,
  page: Page,
  sectionCount: number,
  pageWidth: number,
  pageHeight: number,
  margin: number
): void => {
  // Section page - center title both vertically and horizontally
  pdf.setFont('times', 'bold');
  pdf.setFontSize(32);
  const title = page.title || `Section ${sectionCount + 1}`;
  
  const titleLines = pdf.splitTextToSize(title, pageWidth - (2 * margin));
  const lineHeight = 40;
  const totalHeight = titleLines.length * lineHeight;
  const centerY = (pageHeight - totalHeight) / 2;
  
  titleLines.forEach((line, index) => {
    const textWidth = pdf.getStringUnitWidth(line) * pdf.getFontSize();
    const centerX = (pageWidth - textWidth) / 2;
    pdf.text(line, centerX, centerY + (index * lineHeight));
  });
};

// Render a content page
const renderContentPage = async (
  pdf: jsPDF,
  page: Page,
  pageWidth: number,
  pageHeight: number,
  margin: number,
  baseLineHeight: number,
  paragraphSpacing: number,
  maxImageHeight: number
): Promise<number> => {
  let y = margin;

  // Regular page title
  pdf.setFont('times', 'bold');
  pdf.setFontSize(20);
  const title = page.title || `Page ${page.page_index + 1}`;
  pdf.text(title, margin, y);
  y += 45;

  // Process content
  pdf.setFont('times', 'normal');
  pdf.setFontSize(14);

  let contentData = { elements: [], images: [] };
  // Convert JSON content to HTML
  if (page.content) {
    const htmlContent = convertJSONToHTML(page.content);
    if (htmlContent) {
      contentData = processHtmlContent(htmlContent);
    }
  }

  // Add content with proper formatting and images
  let elementCount = 0;
  for (const element of contentData.elements) {
    const imageToInsert = contentData.images.find(img => img.afterElement === elementCount);
    
    // Handle different element types
    switch (element.type) {
      case 'text': {
        if (element.content.trim()) {
          const wrappedLines = pdf.splitTextToSize(element.content, pageWidth - (2 * margin));
          wrappedLines.forEach((textLine: string) => {
            if (y > pageHeight - margin) {
              pdf.addPage();
              y = margin;
            }
            pdf.text(textLine, margin, y);
            y += baseLineHeight;
          });
        } else {
          y += paragraphSpacing;
        }
        break;
      }
        
      case 'heading': {
        if (y > pageHeight - margin - 40) {
          pdf.addPage();
          y = margin;
        }
        
        pdf.setFont('times', 'bold');
        const headingSize = element.level ? Math.max(24 - (element.level - 1) * 2, 16) : 20;
        pdf.setFontSize(headingSize);
        
        const headingLines = pdf.splitTextToSize(element.content, pageWidth - (2 * margin));
        headingLines.forEach((line: string) => {
          if (y > pageHeight - margin) {
            pdf.addPage();
            y = margin;
          }
          pdf.text(line, margin, y);
          y += baseLineHeight + 5;
        });
        
        pdf.setFont('times', 'normal');
        pdf.setFontSize(14);
        y += 10;
        break;
      }
        
      case 'paragraph': {
        if (y > pageHeight - margin - 40) {
          pdf.addPage();
          y = margin;
        }
        
        const paragraphLines = pdf.splitTextToSize(element.content, pageWidth - (2 * margin));
        paragraphLines.forEach((line: string) => {
          if (y > pageHeight - margin) {
            pdf.addPage();
            y = margin;
          }
          pdf.text(line, margin, y);
          y += baseLineHeight;
        });
        
        y += paragraphSpacing;
        break;
      }
        
      case 'list': {
        if (y > pageHeight - margin - 40) {
          pdf.addPage();
          y = margin;
        }
        
        y += 10; // Add some space before the list
        break;
      }
        
      case 'listItem': {
        if (y > pageHeight - margin - 40) {
          pdf.addPage();
          y = margin;
        }
        
        const listItemLines = pdf.splitTextToSize(element.content, pageWidth - (2 * margin) - 20);
        listItemLines.forEach((line: string, index: number) => {
          if (y > pageHeight - margin) {
            pdf.addPage();
            y = margin;
          }
          
          const prefix = index === 0 ? '• ' : '  ';
          pdf.text(prefix + line, margin + (element.isIndented ? 20 : 0), y);
          y += baseLineHeight;
        });
        
        y += 5; // Add some space after each list item
        break;
      }
        
      case 'blockquote': {
        if (y > pageHeight - margin - 40) {
          pdf.addPage();
          y = margin;
        }
        
        pdf.setFont('times', 'italic');
        const quoteLines = pdf.splitTextToSize(element.content, pageWidth - (2 * margin) - 40);
        quoteLines.forEach((line: string) => {
          if (y > pageHeight - margin) {
            pdf.addPage();
            y = margin;
          }
          pdf.text(`"${line}"`, margin + 20, y);
          y += baseLineHeight;
        });
        
        pdf.setFont('times', 'normal');
        y += paragraphSpacing;
        break;
      }
        
      case 'code': {
        if (y > pageHeight - margin - 40) {
          pdf.addPage();
          y = margin;
        }
        
        pdf.setFont('courier', 'normal');
        const codeLines = pdf.splitTextToSize(element.content, pageWidth - (2 * margin) - 40);
        codeLines.forEach((line: string) => {
          if (y > pageHeight - margin) {
            pdf.addPage();
            y = margin;
          }
          pdf.text(line, margin + 20, y);
          y += baseLineHeight;
        });
        
        pdf.setFont('times', 'normal');
        y += paragraphSpacing;
        break;
      }
        
      case 'image':
        // Images are handled separately after the element
        break;
    }

    // Handle image if present
    if (imageToInsert) {
      try {
        const img = await loadImage(imageToInsert.url);
        
        // Check if image loaded successfully
        if (!img || !img.width || !img.height) {
          console.warn('Failed to load image properly:', imageToInsert.url);
          continue;
        }
        
        let imgWidth = pageWidth - (2 * margin);
        let imgHeight = (img.height / img.width) * imgWidth;

        if (imgHeight > maxImageHeight) {
          imgHeight = maxImageHeight;
          imgWidth = (img.width / img.height) * imgHeight;
        }

        if (y + imgHeight > pageHeight - margin) {
          pdf.addPage();
          y = margin;
        }

        const xPos = (pageWidth - imgWidth) / 2;
        
        // Use a try-catch block for the actual image insertion
        try {
          pdf.addImage(img, 'PNG', xPos, y, imgWidth, imgHeight);
          y += imgHeight + paragraphSpacing;
        } catch (imgError) {
          console.warn('Error adding image to PDF:', imgError);
          // Continue without the image
          y += paragraphSpacing;
        }
      } catch (error) {
        console.warn('Failed to add image to PDF:', error);
        // Continue without the image
        y += paragraphSpacing;
      }
    }

    elementCount++;
  }
  
  return y;
};

export const generatePDF = async (
  options: DownloadOptions
): Promise<GenerateResult> => {
  try {
    // Validate input
    if (!options.bookId) {
      throw new Error('Book ID is required');
    }
    
    const pages = await fetchBookPages(options.bookId);
    
    // Check if we have any pages
    if (!pages || pages.length === 0) {
      throw new Error('No pages found for the specified book');
    }
    
    // Initialize PDF
    const pdf = new jsPDF({
      unit: 'pt',
      format: 'a4',
      orientation: 'portrait'
    });

    const pageWidth = pdf.internal.pageSize.width;
    const pageHeight = pdf.internal.pageSize.height;
    const margin = 50;
    const contentWidth = pageWidth - (2 * margin);
    const baseLineHeight = 20;
    const paragraphSpacing = 30;
    const maxImageHeight = pageHeight * 0.7;

    // Store actual page numbers for TOC
    const tocPageNumbers: { [key: string]: number } = {};
    let currentPdfPage = 0;

    // Add cover page
    await createCoverPage(pdf, options, pageWidth, pageHeight);
    currentPdfPage++;

    // Add TOC placeholder page - we'll come back to fill it later
    pdf.addPage();
    currentPdfPage++;
    const tocPageNumber = currentPdfPage;

    // First pass: Generate content and track actual page numbers
    let sectionCount = 0;
    for (const page of pages) {
      pdf.addPage();
      currentPdfPage++;
      
      // Store the starting page number for this entry
      tocPageNumbers[page.id] = currentPdfPage;

      if (page.page_type === 'section') {
        // Render section page
        renderSectionPage(pdf, page, sectionCount, pageWidth, pageHeight, margin);
        sectionCount++;
      } else {
        // Render content page
        await renderContentPage(
          pdf, 
          page, 
          pageWidth, 
          pageHeight, 
          margin, 
          baseLineHeight, 
          paragraphSpacing, 
          maxImageHeight
        );
      }
    }

    // Go back to TOC page and generate it with correct page numbers
    pdf.setPage(tocPageNumber);
    createTableOfContents(pdf, pages, tocPageNumbers, pageWidth, pageHeight, margin);

    // Save PDF
    pdf.save(`${options.name}.pdf`);
    return { success: true };
  } catch (error) {
    console.error('Error generating PDF:', error);
    return {
      success: false,
      error: {
        message: "Failed to generate PDF",
        details: error instanceof Error ? error.message : error
      }
    };
  }
};

// Helper function to strip HTML and format text
const stripHtmlAndFormatText = (html: string): string => {
  const temp = document.createElement('div');
  temp.innerHTML = html;
  
  // Handle lists
  temp.querySelectorAll('li').forEach(li => {
    li.textContent = `• ${li.textContent}`;
  });
  
  // Handle headers
  temp.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(header => {
    header.textContent = `\n${header.textContent}\n`;
  });
  
  // Handle paragraphs
  temp.querySelectorAll('p').forEach(p => {
    p.textContent = `${p.textContent}\n`;
  });
  
  // Remove remaining HTML tags and decode entities
  return temp.textContent || temp.innerText || '';
};

// Download and process images for EPUB
const downloadImage = async (url: string): Promise<Blob | null> => {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch image: ${response.statusText}`);
    return await response.blob();
  } catch (error) {
    console.warn(`Failed to download image: ${url}`, error);
    return null;
  }
};

// Extract image URLs from HTML content
const extractImageUrls = (html: string): string[] => {
  if (!html) return [];
  const div = document.createElement('div');
  div.innerHTML = html;
  const images = div.querySelectorAll('img');
  return Array.from(images)
    .map(img => img.getAttribute('src'))
    .filter((src): src is string => src !== null && src.startsWith('http'));
};

export const generateAndDownloadEPUB = async (
  options: DownloadOptions
): Promise<GenerateResult> => {
  try {
    const pages = await fetchBookPages(options.bookId);
    const { processedPages, images } = await prepareEPUBContent(pages);

    // Ensure processedPages have the correct type for generateEPUB
    const typedProcessedPages = processedPages.map(page => ({
      ...page,
      page_type: page.page_type as 'section' | 'page'
    }));

    const epubOptions: EPUBOptions = {
      title: options.name,
      subtitle: options.subtitle,
      author: options.author,
      coverUrl: options.coverUrl,
      identifier: options.bookId.toString()
    };
    // Generate the EPUB file
    const epubBlob = await generateEPUB(epubOptions, typedProcessedPages, images, options.showTextOnCover);

    if (options.returnBlob) {
      return { success: true, blob: epubBlob };
    }

    // Only trigger download if returnBlob is false
    const url = window.URL.createObjectURL(epubBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${options.name}.epub`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: {
        message: "Failed to generate EPUB",
        details: error instanceof Error ? error.message : error
      }
    };
  }
};