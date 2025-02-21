
import { Database } from '@/integrations/supabase/types';
import { supabase } from '@/integrations/supabase/client';
import { generateEPUB } from './epub';
import { prepareEPUBContent, EPUBOptions } from './epub-generator';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

type Page = Database['public']['Tables']['pages']['Row'];

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

const fetchBookPages = async (bookId: number) => {
  const { data: pages, error } = await supabase
    .from("pages")
    .select("*")
    .eq("book_id", bookId)
    .eq("archived", false)
    .order("page_index", { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch pages: ${error.message}`);
  }

  return pages;
};

// Process HTML content to extract formatted text
const processHtmlContent = (html: string): string[] => {
  if (!html) return [];

  const div = document.createElement('div');
  div.innerHTML = html;

  const lines: string[] = [];
  
  // Process headings
  div.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(heading => {
    lines.push(''); // Add space before heading
    lines.push(heading.textContent || '');
    lines.push(''); // Add space after heading
  });

  // Process paragraphs
  div.querySelectorAll('p').forEach(p => {
    const text = p.textContent?.trim();
    if (text) {
      lines.push(text);
      lines.push(''); // Add blank line after paragraph
    }
  });

  // Process lists
  div.querySelectorAll('ul, ol').forEach(list => {
    lines.push(''); // Add space before list
    list.querySelectorAll('li').forEach(li => {
      lines.push(`• ${li.textContent?.trim()}`);
    });
    lines.push(''); // Add space after list
  });

  // Process blockquotes
  div.querySelectorAll('blockquote').forEach(quote => {
    lines.push('');
    lines.push(`"${quote.textContent?.trim()}"`);
    lines.push('');
  });

  // Process code blocks
  div.querySelectorAll('pre, code').forEach(code => {
    lines.push('');
    lines.push(code.textContent?.trim() || '');
    lines.push('');
  });

  return lines.filter(line => line !== undefined);
};

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

    // Add cover page if available
    if (options.coverUrl) {
      try {
        const coverImg = await loadImage(options.coverUrl);
        const coverAspectRatio = coverImg.height / coverImg.width;
        let imgWidth = pageWidth - (2 * margin);
        let imgHeight = imgWidth * coverAspectRatio;

        // Adjust if height exceeds page
        if (imgHeight > pageHeight - (2 * margin)) {
          imgHeight = pageHeight - (2 * margin);
          imgWidth = imgHeight / coverAspectRatio;
        }

        const xPos = (pageWidth - imgWidth) / 2;
        const yPos = (pageHeight - imgHeight) / 2;
        pdf.addImage(coverImg, 'JPEG', xPos, yPos, imgWidth, imgHeight);
      } catch (error) {
        console.warn('Failed to add cover image:', error);
      }
    }

    // Add title page
    pdf.addPage();
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(24);

    const titleLines = pdf.splitTextToSize(options.name, contentWidth);
    let yPos = 150;
    
    titleLines.forEach((line: string) => {
      const textWidth = pdf.getStringUnitWidth(line) * pdf.getFontSize();
      const xPos = (pageWidth - textWidth) / 2;
      pdf.text(line, xPos, yPos);
      yPos += 30;
    });

    if (options.author) {
      yPos += 20;
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(16);
      const authorText = `by ${options.author}`;
      const authorWidth = pdf.getStringUnitWidth(authorText) * pdf.getFontSize();
      pdf.text(authorText, (pageWidth - authorWidth) / 2, yPos);
    }

    // Add table of contents
    pdf.addPage();
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(20);
    pdf.text('Table of Contents', margin, margin + 20);

    let tocY = margin + 60;
    const sections = pages.filter(p => p.page_type === 'section');
    
    sections.forEach((section, index) => {
      if (tocY > pageHeight - margin) {
        pdf.addPage();
        tocY = margin + 20;
      }
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(12);
      pdf.text(`${index + 1}. ${section.title || `Section ${index + 1}`}`, margin, tocY);
      tocY += 20;
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
      const lineHeight = 16;

      let contentLines: string[] = [];
      if (page.html_content) {
        contentLines = processHtmlContent(page.html_content);
      }

      // Add content with proper line breaks
      contentLines.forEach(line => {
        const textLines = pdf.splitTextToSize(line, contentWidth);
        
        textLines.forEach((textLine: string) => {
          if (y > pageHeight - margin) {
            pdf.addPage();
            y = margin;
          }
          if (textLine.trim()) {
            pdf.text(textLine, margin, y);
          }
          y += lineHeight;
        });
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

const examplePageContent= {
  "type": "doc",
  "content": [
    {
      "type": "heading",
      "attrs": {
        "level": "[object Object]"
      },
      "content": [
        {
          "text": "Organize your book",
          "type": "text"
        }
      ]
    },
    {
      "type": "paragraph"
    },
    {
      "type": "paragraph",
      "content": [
        {
          "text": "Sections",
          "type": "text",
          "marks": [
            {
              "type": "bold"
            }
          ]
        }
      ]
    },
    {
      "type": "paragraph",
      "content": [
        {
          "text": "From the book page, you can add sections to structure your content.",
          "type": "text"
        }
      ]
    },
    {
      "type": "paragraph"
    },
    {
      "type": "image",
      "attrs": {
        "alt": null,
        "src": "https://qiqeyirtpstdjkkeyfss.supabase.co/storage/v1/object/public/images/178a3b0e-a9ec-4291-8829-f27b857dbd4c.png",
        "title": null
      }
    },
    {
      "type": "paragraph"
    },
    {
      "type": "paragraph"
    },
    {
      "type": "paragraph",
      "content": [
        {
          "text": "Re-order",
          "type": "text",
          "marks": [
            {
              "type": "bold"
            }
          ]
        }
      ]
    },
    {
      "type": "paragraph",
      "content": [
        {
          "text": "You can re-order the pages and sections by entering the ",
          "type": "text"
        },
        {
          "text": "Re-order Mode.",
          "type": "text",
          "marks": [
            {
              "type": "italic"
            }
          ]
        }
      ]
    },
    {
      "type": "paragraph"
    },
    {
      "type": "image",
      "attrs": {
        "alt": null,
        "src": "https://qiqeyirtpstdjkkeyfss.supabase.co/storage/v1/object/public/images/ea8b77a2-56f3-4757-acd9-e69b84fc4272.gif",
        "title": null
      }
    },
    {
      "type": "paragraph"
    },
    {
      "type": "paragraph"
    },
    {
      "type": "paragraph",
      "content": [
        {
          "text": "Delete",
          "type": "text",
          "marks": [
            {
              "type": "bold"
            }
          ]
        }
      ]
    },
    {
      "type": "paragraph",
      "content": [
        {
          "text": "You can delete book from the ",
          "type": "text"
        },
        {
          "text": "Delete Mode.",
          "type": "text",
          "marks": [
            {
              "type": "italic"
            }
          ]
        }
      ]
    },
    {
      "type": "paragraph"
    },
    {
      "type": "image",
      "attrs": {
        "alt": null,
        "src": "https://qiqeyirtpstdjkkeyfss.supabase.co/storage/v1/object/public/images/2f8a3a9d-7090-447a-bdce-9cb5e052fd4b.gif",
        "title": null
      }
    }
  ]
}

const examplePageContentHTML = `<h1 class="font-bold" level="[object Object]">Organize your book</h1><p></p><p><strong>Sections</strong></p><p>From the book page, you can add sections to structure your content.</p><p></p><img class="max-w-full h-auto rounded-lg preserve-animation mx-auto block" src="https://qiqeyirtpstdjkkeyfss.supabase.co/storage/v1/object/public/images/178a3b0e-a9ec-4291-8829-f27b857dbd4c.png"><p></p><p></p><p><strong>Re-order</strong></p><p>You can re-order the pages and sections by entering the <em>Re-order Mode.</em></p><p></p><img class="max-w-full h-auto rounded-lg preserve-animation mx-auto block" src="https://qiqeyirtpstdjkkeyfss.supabase.co/storage/v1/object/public/images/ea8b77a2-56f3-4757-acd9-e69b84fc4272.gif"><p></p><p></p><p><strong>Delete</strong></p><p>You can delete book from the <em>Delete Mode.</em></p><p></p><img class="max-w-full h-auto rounded-lg preserve-animation mx-auto block" src="https://qiqeyirtpstdjkkeyfss.supabase.co/storage/v1/object/public/images/2f8a3a9d-7090-447a-bdce-9cb5e052fd4b.gif">`
