import { Database } from '@/types/supabase';
import { supabase } from '@/integrations/supabase/client';
import { generateEPUB } from './epub';

type Page = Database['public']['Tables']['pages']['Row'];

interface DownloadOptions {
  bookId: number;
  name: string;
  author?: string | null;
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

export const generatePDF = async (
  options: DownloadOptions
): Promise<GenerateResult> => {
  try {
    const pages = await fetchBookPages(options.bookId);

    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      return {
        success: false,
        error: {
          message: "Please allow pop-ups to download the PDF"
        }
      };
    }

    printWindow.document.write(`
      <html>
      <head>
        <title>${options.name}</title>
        <style>
        body { font-family: system-ui, -apple-system, sans-serif; line-height: 1.5; margin: 40px; }
        .cover { max-width: 100%; max-height: 70vh; margin-bottom: 20px; }
        .page { margin-bottom: 40px; page-break-after: always; }
        .page-title { font-size: 24px; margin-bottom: 20px; font-weight: bold; }
        .page-content { font-size: 16px; }
        .cover-page { 
          height: 100vh; 
          display: flex; 
          flex-direction: column; 
          justify-content: center; 
          align-items: center;
          text-align: center;
          page-break-after: always;
        }
        .book-title { font-size: 48px; margin-bottom: 20px; }
        .book-author { font-size: 24px; color: #666; }
        .section-page {
          height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          text-align: center;
          page-break-after: always;
        }
        .section-title {
          font-size: 36px;
          font-weight: bold;
          color: #333;
        }
        </style>
      </head>
      <body>
        <div class="cover-page">
          <h1 class="book-title">${options.name}</h1>
          ${options.author ? `<div class="book-author">by ${options.author}</div>` : ''}
        </div>
        ${pages?.map((page, index) => 
          page.page_type === 'section' 
            ? `<div class="section-page">
                <h1 class="section-title">${page.title || `Section ${index + 1}`}</h1>
              </div>`
            : `<div class="page">
                <div class="page-title">${page.title || `Page ${index + 1}`}</div>
                <div class="page-content">${page.html_content || ''}</div>
              </div>`
        ).join('')}
      </body>
      </html>
    `);

    printWindow.document.close();
    printWindow.focus();
    
    await new Promise(resolve => setTimeout(resolve, 250));
    printWindow.print();
    printWindow.close();

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

export const generateAndDownloadEPUB = async (
  options: DownloadOptions
): Promise<GenerateResult> => {
  try {
    const pages = await fetchBookPages(options.bookId);

    const epubBlob = await generateEPUB(
      {
        title: options.name,
        author: options.author || undefined,
        language: 'en'
      },
      pages?.map(page => ({
        ...page,
        page_type: page.page_type as 'section' | 'page'
      })) || []
    );

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