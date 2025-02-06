import { useState } from "react";
import { 
  Card,
  CardHeader 
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ImageIcon, Download, Book } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { generateEPUB } from "@/lib/epub";

interface BookInfoProps {
  name: string;
  coverUrl?: string | null;
  bookId: number;
  author?: string | null;
}

export const BookInfo = ({ 
  name,
  coverUrl,
  bookId,
  author,
}: BookInfoProps) => {
  const { toast } = useToast();

  const handleDownloadPDF = async () => {
    try {
      // Fetch all pages for the book
      const { data: pages, error } = await supabase
        .from("pages")
        .select("*")
        .eq("book_id", bookId)
        .eq("archived", false)
        .order("page_index", { ascending: true });

      if (error) throw error;

      // Create a new window for the PDF content
      const printWindow = window.open("", "_blank");
      if (!printWindow) {
        toast({
          variant: "destructive",
          title: "Error",
          description: "Please allow pop-ups to download the PDF"
        });
        return;
      }

      // Write the HTML content
      printWindow.document.write(`
        <html>
        <head>
          <title>${name}</title>
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
            ${coverUrl 
              ? `<img src="${coverUrl}" class="cover" />`
              : `<h1 class="book-title">${name}</h1>
                 ${author ? `<div class="book-author">by ${author}</div>` : ''}`
            }
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

      // Trigger print dialog
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => {
        printWindow.print();
        printWindow.close();
      }, 250);

    } catch (error: any) {
      console.error('Error generating PDF:', error);
      toast({
        variant: "destructive",
        title: "Error generating PDF",
        description: error.message
      });
    }
  };

  const handleDownloadEPUB = async () => {
    try {
      // Fetch all pages for the book
      const { data: pages, error } = await supabase
        .from("pages")
        .select("*")
        .eq("book_id", bookId)
        .eq("archived", false)
        .order("page_index", { ascending: true });

      if (error) throw error;

      // Generate EPUB file using the utility functions
      const epubBlob = await generateEPUB(
        {
          title: name,
          author: author || undefined,
          language: 'en'
        },
        pages || []
      );

      // Download the file
      const url = window.URL.createObjectURL(epubBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${name}.epub`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast({
        title: "EPUB Generated",
        description: "Your book has been downloaded as EPUB"
      });

    } catch (error: any) {
      console.error('Error generating EPUB:', error);
      toast({
        variant: "destructive",
        title: "Error generating EPUB",
        description: error.message
      });
    }
  };

  return (
    <Card className="bg-white shadow-sm">
      <div className="flex flex-col gap-4">
        <CardHeader className="space-y-6">
          <div className="w-full aspect-[3/4] relative rounded-lg overflow-hidden bg-blue-100">
            {coverUrl ? (
              <img 
                src={coverUrl} 
                alt="Book cover"
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <ImageIcon className="w-16 h-16 text-blue-300" />
              </div>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <Button
              onClick={handleDownloadPDF}
              variant="outline"
              className="w-full"
            >
              <Download className="h-4 w-4 mr-2" />
              Download PDF
            </Button>
            <Button
              onClick={handleDownloadEPUB}
              variant="outline"
              className="w-full"
            >
              <Book className="h-4 w-4 mr-2" />
              Download EPUB
            </Button>
          </div>
        </CardHeader>
      </div>
    </Card>
  );
};