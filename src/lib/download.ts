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

// Process HTML content for PDF
const processContent = (html: string): string => {
  if (!html) return '';
  
  // Create a temporary div to parse HTML
  const div = document.createElement('div');
  div.innerHTML = html;
  
  // Process images
  div.querySelectorAll('img').forEach(img => {
    img.setAttribute('style', 'max-width: 100%; height: auto; page-break-inside: avoid; margin: 10px 0;');
    img.removeAttribute('class');
  });

  // Remove interactive elements
  div.querySelectorAll('button, script').forEach(el => el.remove());
  
  return div.innerHTML;
};

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

export const generatePDF = async (
  options: DownloadOptions
): Promise<GenerateResult> => {
  try {
    const pages = await fetchBookPages(options.bookId);
    
    // Initialize PDF with A4 format
    const pdf = new jsPDF({
      unit: 'mm',
      format: 'a4',
      orientation: 'portrait'
    });

    // Helper function to add page content
    const addPage = (content: string) => {
      // Calculate page dimensions
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 20; // 20mm margins
      const contentWidth = pageWidth - (2 * margin);
      
      // Add content
      pdf.setFont('helvetica');
      pdf.setFontSize(11);
      
      const splitText = pdf.splitTextToSize(content, contentWidth);
      let yPosition = margin;
      
      // Add new page if we're not at the beginning
      if (pdf.internal.getCurrentPageInfo().pageNumber !== 1) {
        pdf.addPage();
      }
      
      // Add content with proper line breaks
      splitText.forEach((line: string) => {
        if (yPosition > pageHeight - margin) {
          pdf.addPage();
          yPosition = margin;
        }
        pdf.text(line, margin, yPosition);
        yPosition += 7; // Line height
      });
    };

    // Add cover page
    if (options.coverUrl) {
      try {
        const coverImg = await loadImage(options.coverUrl);
        const coverAspectRatio = coverImg.height / coverImg.width;
        const pageWidth = pdf.internal.pageSize.getWidth();
        const maxHeight = pdf.internal.pageSize.getHeight() - 40; // Leave margin
        let imgWidth = pageWidth - 40; // 20mm margins on each side
        let imgHeight = imgWidth * coverAspectRatio;

        // Adjust if height exceeds page
        if (imgHeight > maxHeight) {
          imgHeight = maxHeight;
          imgWidth = imgHeight / coverAspectRatio;
        }

        const xPos = (pageWidth - imgWidth) / 2;
        pdf.addImage(coverImg, 'JPEG', xPos, 20, imgWidth, imgHeight);
      } catch (error) {
        console.warn('Failed to add cover image:', error);
      }
    }

    // Add title page
    pdf.addPage();
    pdf.setFontSize(24);
    pdf.setFont('helvetica', 'bold');
    const titleWidth = pdf.getTextWidth(options.name);
    const pageWidth = pdf.internal.pageSize.getWidth();
    pdf.text(options.name, (pageWidth - titleWidth) / 2, 60);

    if (options.author) {
      pdf.setFontSize(16);
      pdf.setFont('helvetica', 'normal');
      const authorText = `by ${options.author}`;
      const authorWidth = pdf.getTextWidth(authorText);
      pdf.text(authorText, (pageWidth - authorWidth) / 2, 80);
    }

    // Add table of contents
    pdf.addPage();
    pdf.setFontSize(20);
    pdf.setFont('helvetica', 'bold');
    pdf.text('Table of Contents', 20, 30);
    
    let tocY = 50;
    const sections = pages.filter(p => p.page_type === 'section');
    sections.forEach((section, index) => {
      pdf.setFontSize(12);
      pdf.setFont('helvetica', 'normal');
      pdf.text(`${index + 1}. ${section.title || `Section ${index + 1}`}`, 25, tocY);
      tocY += 10;
    });

    // Process and add each page
    for (const page of pages) {
      pdf.addPage();

      if (page.page_type === 'section') {
        // Section page
        pdf.setFontSize(24);
        pdf.setFont('helvetica', 'bold');
        const title = page.title || `Section ${page.page_index + 1}`;
        const titleWidth = pdf.getTextWidth(title);
        pdf.text(title, (pageWidth - titleWidth) / 2, 60);
      } else {
        // Regular page
        pdf.setFontSize(16);
        pdf.setFont('helvetica', 'bold');
        const title = page.title || `Page ${page.page_index + 1}`;
        pdf.text(title, 20, 30);

        // Convert HTML content to plain text and add it
        if (page.html_content) {
          const plainText = stripHtmlAndFormatText(page.html_content);
          pdf.setFontSize(11);
          pdf.setFont('helvetica', 'normal');
          const splitText = pdf.splitTextToSize(plainText, pageWidth - 40);
          let yPosition = 50;

          splitText.forEach((line: string) => {
            if (yPosition > pdf.internal.pageSize.getHeight() - 20) {
              pdf.addPage();
              yPosition = 20;
            }
            pdf.text(line, 20, yPosition);
            yPosition += 7;
          });
        }
      }
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
