
import { Database } from '@/integrations/supabase/types';
import { supabase } from '@/integrations/supabase/client';
import { generateEPUB } from './epub';
import { prepareEPUBContent, EPUBOptions } from './epub-generator';
import jsPDF from 'jspdf';

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
    img.onload = () => resolve(img);
    img.onerror = reject;
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

// Process HTML content to extract formatted text
const processHtmlContent = (html: string): { lines: string[]; images: Array<{ url: string; afterLine: number }> } => {
  if (!html) return { lines: [], images: [] };

  const div = document.createElement('div');
  div.innerHTML = html;

  const lines: string[] = [];
  const images: Array<{ url: string; afterLine: number }> = [];
  
  // First replace all <br> tags with newlines in the HTML content
  div.querySelectorAll('br').forEach(br => {
    br.replaceWith('\n');
  });

  // Track images and their positions
  div.querySelectorAll('img').forEach(img => {
    const src = img.getAttribute('src');
    if (src) {
      // Store the image URL and the current line count
      images.push({
        url: src,
        afterLine: lines.length
      });
      // Add extra spacing for the image
      lines.push('\n');
      lines.push('\n');
    }
  });

  // Process headings with more spacing
  div.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(heading => {
    lines.push('\n'); // Extra line break before heading
    lines.push(heading.textContent?.trim() || '');
    lines.push('\n'); // Extra line break after heading
  });

  // Process paragraphs with proper spacing
  div.querySelectorAll('p').forEach(p => {
    const text = p.textContent?.trim();
    if (text) {
      lines.push('\n'); // Line break before paragraph
      // Split paragraph into individual lines to preserve manual line breaks
      text.split('\n').forEach(line => {
        if (line.trim()) {
          lines.push(line.trim());
        } else {
          // Add empty line for <br> tags that resulted in empty lines
          lines.push('');
        }
      });
      lines.push('\n'); // Line break after paragraph
    }
  });

  // Process lists with proper indentation and spacing
  div.querySelectorAll('ul, ol').forEach(list => {
    lines.push('\n'); // Line break before list
    list.querySelectorAll('li').forEach(li => {
      const text = li.textContent?.trim();
      if (text) {
        // Handle multi-line list items
        text.split('\n').forEach((line, index) => {
          if (line.trim()) {
            if (index === 0) {
              lines.push(`  • ${line.trim()}`);
            } else {
              lines.push(`    ${line.trim()}`); // Extra indent for wrapped lines
            }
          } else {
            // Add empty line for <br> tags in list items
            lines.push('');
          }
        });
      }
    });
    lines.push('\n'); // Line break after list
  });

  // Process blockquotes with proper formatting
  div.querySelectorAll('blockquote').forEach(quote => {
    lines.push('\n'); // Line break before quote
    const text = quote.textContent?.trim();
    if (text) {
      text.split('\n').forEach(line => {
        if (line.trim()) {
          lines.push(`  "${line.trim()}"`);
        } else {
          // Add empty line for <br> tags in quotes
          lines.push('');
        }
      });
    }
    lines.push('\n'); // Line break after quote
  });

  // Process code blocks with proper formatting and spacing
  div.querySelectorAll('pre, code').forEach(code => {
    lines.push('\n'); // Line break before code block
    const text = code.textContent?.trim();
    if (text) {
      text.split('\n').forEach(line => {
        if (line.trim()) {
          lines.push(`  ${line}`);
        } else {
          // Add empty line for <br> tags in code blocks
          lines.push('');
        }
      });
    }
    lines.push('\n'); // Line break after code block
  });

  // Filter out consecutive empty lines
  const filteredLines = lines.reduce((acc: string[], line: string) => {
    const lastLine = acc[acc.length - 1];
    // Only add line if it's not creating more than two consecutive empty lines
    if (!(line.trim() === '' && lastLine?.trim() === '' && acc[acc.length - 2]?.trim() === '')) {
      acc.push(line);
    }
    return acc;
  }, []);

  // Remove empty lines at the beginning and end while preserving intentional spacing
  while (filteredLines.length > 0 && !filteredLines[0].trim()) {
    filteredLines.shift();
  }
  while (filteredLines.length > 0 && !filteredLines[filteredLines.length - 1].trim()) {
    filteredLines.pop();
  }

  return { lines: filteredLines, images };
};

export const generatePDF = async (
  options: DownloadOptions
): Promise<GenerateResult> => {
  try {
    const pages = await fetchBookPages(options.bookId);
    
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
    let sectionCount = 0;  // Declaration moved here to fix error

    // Add cover page if available
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

        // Add a single light overlay for better text visibility
        pdf.setFillColor(0, 0, 0);
        pdf.setGState(pdf.GState({opacity: 0.4}));
        pdf.rect(0, 0, pageWidth, pageHeight, 'F');
        pdf.setGState(pdf.GState({opacity: 1}));

        // Add title text with white color and ensure it's on top
        pdf.setTextColor(255, 255, 255);
        pdf.setFont('helvetica', 'bold'); // Keep Helvetica for cover - it looks better
        pdf.setFontSize(42); // Increased from 36

        const titleLines = pdf.splitTextToSize(options.name, pageWidth * 0.8);
        let textY = pageHeight * 0.4;

        // Center and add title lines with slight shadow effect for better visibility
        titleLines.forEach(line => {
          const textWidth = pdf.getStringUnitWidth(line) * pdf.getFontSize();
          const textX = (pageWidth - textWidth) / 2;
          
          // Add shadow effect
          pdf.setTextColor(0, 0, 0);
          pdf.text(line, textX + 2, textY + 2);
          
          // Add main text
          pdf.setTextColor(255, 255, 255);
          pdf.text(line, textX, textY);
          
          textY += 60; // Increased from 50
        });

        // Add subtitle if available
        if (options.subtitle) {
          textY += 25; // Increased from 20
          pdf.setFontSize(28); // Increased from 24
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
            
            textY += 40; // Increased from 35
          });
        }

        // Add author if available
        if (options.author) {
          textY += 45; // Increased from 40
          pdf.setFontSize(24); // Increased from 20
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

        currentPdfPage++;
      } catch (error) {
        console.warn('Failed to add cover image:', error);
      }
    } else {
      // If no cover image, create a plain dark background cover
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
    }

    // Reset text color and opacity for content pages
    pdf.setTextColor(0, 0, 0);
    pdf.setGState(pdf.GState({opacity: 1}));

    // Add TOC placeholder page - we'll come back to fill it later
    pdf.addPage();
    currentPdfPage++;
    const tocPageNumber = currentPdfPage;

    // First pass: Generate content and track actual page numbers
    for (const page of pages) {
      pdf.addPage();
      currentPdfPage++;
      
      // Store the starting page number for this entry
      tocPageNumbers[page.id] = currentPdfPage;

      let y = margin;

      if (page.page_type === 'section') {
        // Section page - center title both vertically and horizontally
        pdf.setFont('times', 'bold');
        pdf.setFontSize(32);
        const title = page.title || `Section ${sectionCount + 1}`;
        
        const titleLines = pdf.splitTextToSize(title, contentWidth);
        const lineHeight = 40;
        const totalHeight = titleLines.length * lineHeight;
        const centerY = (pageHeight - totalHeight) / 2;
        
        titleLines.forEach((line, index) => {
          const textWidth = pdf.getStringUnitWidth(line) * pdf.getFontSize();
          const centerX = (pageWidth - textWidth) / 2;
          pdf.text(line, centerX, centerY + (index * lineHeight));
        });
        
        sectionCount++;
        continue;
      }

      // Regular page title
      pdf.setFont('times', 'bold');
      pdf.setFontSize(20);
      const title = page.title || `Page ${page.page_index + 1}`;
      pdf.text(title, margin, y);
      y += 45;

      // Process content
      pdf.setFont('times', 'normal');
      pdf.setFontSize(14);

      let contentData = { lines: [], images: [] };
      if (page.html_content) {
        contentData = processHtmlContent(page.html_content);
      }

      // Add content with proper line breaks and images
      let lineCount = 0;
      for (const line of contentData.lines) {
        const imageToInsert = contentData.images.find(img => img.afterLine === lineCount);
        
        if (line.trim()) {
          const wrappedLines = pdf.splitTextToSize(line, contentWidth);
          wrappedLines.forEach((textLine: string) => {
            if (y > pageHeight - margin) {
              pdf.addPage();
              currentPdfPage++;
              y = margin;
            }
            const isIndented = textLine.startsWith('  ');
            const xOffset = isIndented ? margin + 20 : margin;
            pdf.text(textLine.trimStart(), xOffset, y);
            y += baseLineHeight;
          });
        } else {
          y += paragraphSpacing;
        }

        if (imageToInsert) {
          try {
            const img = await loadImage(imageToInsert.url);
            
            let imgWidth = contentWidth;
            let imgHeight = (img.height / img.width) * imgWidth;

            if (imgHeight > maxImageHeight) {
              imgHeight = maxImageHeight;
              imgWidth = (img.width / img.height) * imgHeight;
            }

            if (y + imgHeight > pageHeight - margin) {
              pdf.addPage();
              currentPdfPage++;
              y = margin;
            }

            const xPos = (pageWidth - imgWidth) / 2;
            pdf.addImage(img, 'PNG', xPos, y, imgWidth, imgHeight);
            y += imgHeight + paragraphSpacing;
          } catch (error) {
            console.warn('Failed to add image to PDF:', error);
          }
        }

        lineCount++;
      }
    }

    // Go back to TOC page and generate it with correct page numbers
    pdf.setPage(tocPageNumber);
    pdf.setFont('times', 'bold');
    pdf.setFontSize(24);
    pdf.text('Table of Contents', margin, margin + 20);

    let tocY = margin + 60;
    let pageCount = 0;
    sectionCount = 0; // Reset for TOC generation

    // Generate TOC with accurate page numbers
    pages.forEach((page, index) => {
      if (tocY > pageHeight - margin) {
        pdf.addPage();
        currentPdfPage++;
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

    const epubOptions: EPUBOptions = {
      title: options.name,
      subtitle: options.subtitle,
      author: options.author,
      coverUrl: options.coverUrl,
      identifier: options.bookId.toString()
    };

    const epubBlob = await generateEPUB(epubOptions, processedPages, images, options.showTextOnCover);

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
