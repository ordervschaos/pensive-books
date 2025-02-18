import { Database } from '@/types/supabase';
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
    
    // Initialize PDF
    const pdf = new jsPDF({
      unit: 'mm',
      format: 'a4',
      orientation: 'portrait'
    });

    // Create a temporary container for rendering
    const container = document.createElement('div');
    container.style.position = 'absolute';
    container.style.left = '-9999px';
    container.style.width = '794px'; // A4 width in pixels at 96 DPI
    document.body.appendChild(container);

    // Function to add a page to PDF
    const addPageToPDF = async (content: string) => {
      container.innerHTML = content;

      // Wait for images to load
      const images = container.getElementsByTagName('img');
      await Promise.all(
        Array.from(images).map(
          img => 
            new Promise((resolve, reject) => {
              if (img.complete) resolve(null);
              img.onload = () => resolve(null);
              img.onerror = reject;
            })
        )
      );

      const canvas = await html2canvas(container, {
        scale: 2,
        useCORS: true,
        logging: false,
        allowTaint: true,
        backgroundColor: '#ffffff',
        windowWidth: 794,
        windowHeight: 1123 // A4 height in pixels at 96 DPI
      });

      const imgData = canvas.toDataURL('image/jpeg', 1.0);
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      
      if (pdf.getNumberOfPages() > 0) {
        pdf.addPage();
      }
      pdf.addImage(imgData, 'JPEG', 0, 0, pageWidth, pageHeight);
    };

    // Add cover page
    await addPageToPDF(`
      <div class="pdf-container">
        <style>
          .pdf-container {
            font-family: system-ui, -apple-system, sans-serif;
            line-height: 1.5;
            color: #333;
            padding: 40px;
            min-height: 1123px;
            box-sizing: border-box;
            background: white;
          }
          .cover-page {
            min-height: 1043px;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            text-align: center;
          }
          .cover-image {
            max-width: 70%;
            margin-bottom: 30px;
            display: block;
          }
          .book-title {
            font-size: 48px;
            margin-bottom: 20px;
            font-weight: bold;
          }
          .book-author {
            font-size: 24px;
            color: #666;
          }
        </style>
        <div class="cover-page">
          ${options.coverUrl ? `<img src="${options.coverUrl}" alt="Book cover" class="cover-image">` : ''}
          <h1 class="book-title">${options.name}</h1>
          ${options.author ? `<div class="book-author">by ${options.author}</div>` : ''}
        </div>
      </div>
    `);

    // Add each page
    for (const page of pages) {
      if (page.page_type === 'section') {
        await addPageToPDF(`
          <div class="pdf-container">
            <style>
              .pdf-container {
                font-family: system-ui, -apple-system, sans-serif;
                line-height: 1.5;
                color: #333;
                padding: 40px;
                min-height: 1123px;
                box-sizing: border-box;
                background: white;
              }
              .section-page {
                min-height: 1043px;
                display: flex;
                align-items: center;
                justify-content: center;
                text-align: center;
              }
              .section-title {
                font-size: 36px;
                font-weight: bold;
                color: #333;
              }
            </style>
            <div class="section-page">
              <h1 class="section-title">${page.title || `Section ${page.page_index + 1}`}</h1>
            </div>
          </div>
        `);
      } else {
        await addPageToPDF(`
          <div class="pdf-container">
            <style>
              .pdf-container {
                font-family: system-ui, -apple-system, sans-serif;
                line-height: 1.5;
                color: #333;
                padding: 40px;
                min-height: 1123px;
                box-sizing: border-box;
                background: white;
              }
              .page-title {
                font-size: 24px;
                margin-bottom: 20px;
                font-weight: bold;
              }
              .page-content {
                font-size: 16px;
              }
              img {
                max-width: 100% !important;
                height: auto !important;
                page-break-inside: avoid;
                margin: 10px 0;
                display: block;
              }
              pre, code {
                white-space: pre-wrap;
                word-wrap: break-word;
                background: #f5f5f5;
                padding: 0.2em 0.4em;
                border-radius: 3px;
                font-family: monospace;
              }
              table {
                width: 100%;
                border-collapse: collapse;
                margin: 10px 0;
              }
              th, td {
                border: 1px solid #ddd;
                padding: 8px;
                text-align: left;
              }
              blockquote {
                margin: 10px 0;
                padding-left: 20px;
                border-left: 4px solid #ddd;
                color: #666;
              }
            </style>
            <div class="page">
              <div class="page-title">${page.title || `Page ${page.page_index + 1}`}</div>
              <div class="page-content">${page.html_content ? processContent(page.html_content) : ''}</div>
            </div>
          </div>
        `);
      }
    }

    // Clean up
    document.body.removeChild(container);

    // Save PDF
    pdf.save(`${options.name}.pdf`);

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: {
        message: "Failed to generate PDF",
        details: error instanceof Error ? error.message : error
      }
    };
  }
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
      author: options.author || undefined,
      language: 'en',
      coverUrl: options.coverUrl
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