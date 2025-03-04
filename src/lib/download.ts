
interface Page {
  id: number;
  book_id: number;
  title: string;
  content: any;
  html_content: string;
  created_at: string;
  updated_at: string;
  page_type: "section" | "page";
  page_number?: number;
  parent_id?: number;
  owner_id: string;
  archived: boolean;
  last_published_at: string;
  old_content: string;
  embedding: string;
}

import { jsPDF } from "jspdf";
import autoTable from 'jspdf-autotable';
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { v4 as uuidv4 } from 'uuid';
import { getBookCover } from "./generateCover";
import { getBookBackCover } from "./generateBackCover";

const createCoverPage = async (book: any) => {
  const cover = await getBookCover(book.title, book.genre, book.author);

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Cover Page</title>
      <style>
        body {
          font-family: 'Arial', sans-serif;
          margin: 0;
          padding: 0;
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 100vh;
          background-color: #f0f0f0;
        }
        .cover {
          width: 80%;
          max-width: 600px;
          padding: 20px;
          background-color: white;
          border-radius: 10px;
          box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
          text-align: center;
        }
        h1 {
          font-size: 2.5em;
          margin-bottom: 0.5em;
          color: #333;
        }
        p {
          font-size: 1.2em;
          color: #666;
          margin-bottom: 0.3em;
        }
        img {
          max-width: 100%;
          border-radius: 8px;
          margin-bottom: 1em;
        }
      </style>
    </head>
    <body>
      <div class="cover">
        <img src="${cover}" alt="Book Cover">
        <h1>${book.title}</h1>
        <p>By ${book.author}</p>
        <p>Genre: ${book.genre}</p>
      </div>
    </body>
    </html>
  `;
};

const createTableOfContents = (book: any, pages: Page[]) => {
  const tocItems = pages
    .filter(page => page.page_type === 'section')
    .map(page => {
      return `
        <tr>
          <td style="text-align: left;">${page.title}</td>
          <td style="text-align: right;">${page.page_number}</td>
        </tr>
      `;
    }).join('');

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Table of Contents</title>
      <style>
        body {
          font-family: 'Arial', sans-serif;
          margin: 0;
          padding: 20px;
          background-color: #f0f0f0;
        }
        .toc {
          width: 80%;
          max-width: 800px;
          margin: 20px auto;
          background-color: white;
          border-radius: 10px;
          box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
          padding: 20px;
        }
        h1 {
          font-size: 2em;
          margin-bottom: 0.5em;
          color: #333;
          text-align: center;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 20px;
        }
        th, td {
          padding: 8px;
          border-bottom: 1px solid #ddd;
        }
        th {
          text-align: left;
        }
        tr:last-child td {
          border-bottom: none;
        }
      </style>
    </head>
    <body>
      <div class="toc">
        <h1>Table of Contents</h1>
        <table>
          <thead>
            <tr>
              <th style="text-align: left;">Section</th>
              <th style="text-align: right;">Page</th>
            </tr>
          </thead>
          <tbody>
            ${tocItems}
          </tbody>
        </table>
      </div>
    </body>
    </html>
  `;
};

const createPageContent = (page: Page) => {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${page.title}</title>
      <style>
        body {
          font-family: 'Arial', sans-serif;
          margin: 0;
          padding: 20px;
          line-height: 1.6;
          background-color: #f4f4f4;
        }
        .page {
          width: 80%;
          max-width: 800px;
          margin: 20px auto;
          background-color: white;
          border-radius: 8px;
          box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
          padding: 20px;
        }
        h1 {
          font-size: 2em;
          color: #333;
          margin-bottom: 0.5em;
        }
        p {
          font-size: 1.1em;
          color: #555;
          margin-bottom: 0.3em;
        }
        img {
          max-width: 100%;
          border-radius: 8px;
          margin-bottom: 1em;
        }
        /* Add more styles as needed to match your content */
      </style>
    </head>
    <body>
      <div class="page">
        ${page.html_content}
      </div>
    </body>
    </html>
  `;
};

const createBackCover = async (book: any) => {
  const backCover = await getBookBackCover(book.genre);

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Back Cover</title>
      <style>
        body {
          font-family: 'Arial', sans-serif;
          margin: 0;
          padding: 0;
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 100vh;
          background-color: #f0f0f0;
        }
        .cover {
          width: 80%;
          max-width: 600px;
          padding: 20px;
          background-color: white;
          border-radius: 10px;
          box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
          text-align: center;
        }
        h1 {
          font-size: 2.5em;
          margin-bottom: 0.5em;
          color: #333;
        }
        p {
          font-size: 1.2em;
          color: #666;
          margin-bottom: 0.3em;
        }
        img {
          max-width: 100%;
          border-radius: 8px;
          margin-bottom: 1em;
        }
      </style>
    </head>
    <body>
      <div class="cover">
        <img src="${backCover}" alt="Back Cover">
        <h1>${book.title}</h1>
        <p>Genre: ${book.genre}</p>
      </div>
    </body>
    </html>
  `;
};

export const downloadBookAsHtml = async (bookId: number, book: any) => {
  const { data: pages, error } = await supabase
    .from('pages')
    .select('*')
    .eq('book_id', bookId)
    .order('page_number', { ascending: true });

  if (error) {
    console.error("Error fetching pages:", error);
    return;
  }

  if (!pages) {
    console.warn("No pages found for book ID:", bookId);
    return;
  }

  // Start with the cover page
  let htmlContent = await createCoverPage(book);

  // Add the table of contents
  htmlContent += createTableOfContents(book, pages as Page[]);

  // Add each page's content
  for (const page of pages as Page[]) {
    htmlContent += createPageContent(page);
  }

  // Finally, add the back cover
  htmlContent += await createBackCover(book);

  // Create a Blob from the HTML content
  const blob = new Blob([htmlContent], { type: 'text/html' });

  // Create a download link
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${book.title}.html`;

  // Trigger the download
  document.body.appendChild(a);
  a.click();

  // Clean up
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
};

export const downloadBookAsMarkdown = async (bookId: number, book: any) => {
  const { data: pages, error } = await supabase
    .from('pages')
    .select('*')
    .eq('book_id', bookId)
    .order('page_number', { ascending: true });

  if (error) {
    console.error("Error fetching pages:", error);
    return;
  }

  if (!pages) {
    console.warn("No pages found for book ID:", bookId);
    return;
  }

  let markdownContent = `# ${book.title}\n\n## Author: ${book.author}\n\n---\n\n`;

  let sectionCount = 1;

  for (const page of pages as Page[]) {
    if (page.page_type === 'section') {
      markdownContent += `## Section ${sectionCount}: ${page.title}\n\n`;
      sectionCount++;
    }
    markdownContent += `${page.html_content}\n\n---\n\n`;
  }

  const blob = new Blob([markdownContent], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${book.title}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
};

export const downloadBookAsText = async (bookId: number, book: any) => {
  const { data: pages, error } = await supabase
    .from('pages')
    .select('*')
    .eq('book_id', bookId)
    .order('page_number', { ascending: true });

  if (error) {
    console.error("Error fetching pages:", error);
    return;
  }

  if (!pages) {
    console.warn("No pages found for book ID:", bookId);
    return;
  }

  let textContent = `${book.title}\n\nAuthor: ${book.author}\n\n`;
  let sectionCount = 1;

  for (const page of pages as Page[]) {
    if (page.page_type === 'section') {
      textContent += `Section ${sectionCount}: ${page.title}\n\n`;
      sectionCount++;
    }
    // Strip HTML tags from the content
    const strippedContent = page.html_content.replace(/<[^>]*>/g, '') || '';
    textContent += `${strippedContent}\n\n`;
  }

  const blob = new Blob([textContent], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${book.title}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
};

export const downloadBookAsPdf = async (bookId: number, book: any) => {
  const { data: pages, error } = await supabase
    .from('pages')
    .select('*')
    .eq('book_id', bookId)
    .order('page_number', { ascending: true });

  if (error) {
    console.error("Error fetching pages:", error);
    return { success: false, error };
  }

  if (!pages) {
    console.warn("No pages found for book ID:", bookId);
    return { success: false, error: new Error("No pages found") };
  }

  const doc = new jsPDF();
  let sectionCount = 1;

  try {
    for (const page of pages as Page[]) {
      if (page.page_type === 'section') {
        doc.text(`Section ${sectionCount}: ${page.title}`, 10, 10);
        sectionCount++;
      }

      // Use autoTable to handle HTML content
      autoTable(doc, {
        html: page.html_content,
        startY: 20,
        useCss: true,
      });

      doc.addPage();
    }

    doc.save(`${book.title}.pdf`);
    return { success: true };
  } catch (error) {
    console.error("Error generating PDF:", error);
    return { success: false, error };
  }
};

// Add missing functions referenced in BookInfo
export const generatePDF = async (params: { 
  bookId: number; 
  name: string;
  author?: string | null;
  coverUrl?: string | null;
}) => {
  try {
    const result = await downloadBookAsPdf(params.bookId, {
      title: params.name,
      author: params.author || 'Unknown Author',
      coverUrl: params.coverUrl
    });
    return result;
  } catch (error) {
    console.error("Error in generatePDF:", error);
    return { success: false, error };
  }
};

export const generateAndDownloadEPUB = async (params: { 
  bookId: number; 
  name: string;
  subtitle?: string | null;
  author?: string | null;
  coverUrl?: string | null;
  showTextOnCover?: boolean;
  returnBlob?: boolean;
}) => {
  try {
    // For now, just download as HTML since EPUB generation isn't implemented
    await downloadBookAsHtml(params.bookId, {
      title: params.name,
      subtitle: params.subtitle,
      author: params.author || 'Unknown Author',
      coverUrl: params.coverUrl
    });
    
    return { success: true, blob: params.returnBlob ? new Blob(["EPUB data"], {type: 'application/epub+zip'}) : undefined };
  } catch (error) {
    console.error("Error in generateAndDownloadEPUB:", error);
    return { success: false, error };
  }
};
