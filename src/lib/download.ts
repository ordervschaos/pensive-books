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
}

interface GenerateResult {
  success: boolean;
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
const processHtmlContent = (html: string): string[] => {
  if (!html) return [];

  const div = document.createElement('div');
  div.innerHTML = html;

  // First replace all <br> tags with newlines in the HTML content
  div.querySelectorAll('br').forEach(br => {
    br.replaceWith('\n');
  });

  const lines: string[] = [];
  
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

  return filteredLines;
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
    const margin = 50; // 50pt margins
    const contentWidth = pageWidth - (2 * margin);
    const baseLineHeight = 16; // Base line height
    const paragraphSpacing = 24; // Space between paragraphs

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

        // Always add dark overlay for better text visibility
        pdf.setFillColor(0, 0, 0);
        pdf.setGlobalAlpha(0.6);
        pdf.rect(0, 0, pageWidth, pageHeight, 'F');
        pdf.setGlobalAlpha(1);

        // Add title text
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

        // Add subtitle if available
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

        // Add author if available
        if (options.author) {
          textY += 40;
          pdf.setFontSize(20);
          pdf.setFont('helvetica', 'normal');
          const authorText = `by ${options.author}`;
          const textWidth = pdf.getStringUnitWidth(authorText) * pdf.getFontSize();
          const textX = (pageWidth - textWidth) / 2;
          pdf.text(authorText, textX, textY);
        }
      } catch (error) {
        console.warn('Failed to add cover image:', error);
      }
    } else {
      // If no cover image, create a plain dark background cover
      pdf.setFillColor(20, 20, 20); // Dark background
      pdf.rect(0, 0, pageWidth, pageHeight, 'F');

      // Add title text
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

    // Add table of contents
    pdf.addPage();
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(20);
    pdf.text('Table of Contents', margin, margin + 20);

    let tocY = margin + 60;
    let currentSection = '';
    let sectionCount = 0;
    let pageCount = 0;

    // Process pages for TOC
    pages.forEach((page, index) => {
      if (tocY > pageHeight - margin) {
        pdf.addPage();
        tocY = margin + 20;
      }

      if (page.page_type === 'section') {
        // Add section with larger font and bold
        sectionCount++;
        currentSection = page.title || `Section ${sectionCount}`;
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(14);
        pdf.text(`${sectionCount}. ${currentSection}`, margin, tocY);
        tocY += 25;
      } else {
        // Add page under current section with smaller font and indentation
        pageCount++;
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(12);
        const title = page.title || `Page ${pageCount}`;
        pdf.text(`${title}`, margin + 20, tocY);
        tocY += 20;
      }
    });

    // Process each page
    for (const page of pages) {
      pdf.addPage();
      let y = margin;

      // Add page title
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(16);
      const title = page.title || `Page ${page.page_index + 1}`;
      pdf.text(title, margin, y);
      y += 40;

      if (page.page_type === 'section') {
        // Section page - only show title
        continue;
      }

      // Process content
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(12);

      let contentLines: string[] = [];
      if (page.html_content) {
        contentLines = processHtmlContent(page.html_content);
      }

      // Add content with proper line breaks
      contentLines.forEach(line => {
        // Check if this is an empty line (just \n)
        if (!line.trim()) {
          y += paragraphSpacing;
          return;
        }

        // Split long lines to fit page width
        const wrappedLines = pdf.splitTextToSize(line, contentWidth);
        
        // Add each line with proper spacing
        wrappedLines.forEach((textLine: string) => {
          // Check if we need to add a new page
          if (y > pageHeight - margin) {
            pdf.addPage();
            y = margin;
          }

          // Only add non-empty lines
          if (textLine.trim()) {
            // Handle indentation for lists and quotes
            const isIndented = textLine.startsWith('  ');
            const xOffset = isIndented ? margin + 20 : margin;
            pdf.text(textLine.trimStart(), xOffset, y);
          }
          
          // Move to next line with proper spacing
          y += baseLineHeight;
        });

        // Add extra spacing after certain elements (lists, quotes, code blocks)
        if (line.startsWith('  •') || line.startsWith('  "') || line.match(/^  [^•"]/)) {
          y += baseLineHeight / 2;
        }
      });
    }

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
