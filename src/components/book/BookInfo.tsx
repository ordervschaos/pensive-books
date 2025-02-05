import { Card, CardHeader } from "@/components/ui/card";
import { ImageIcon, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

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
      // Fetch all pages for this book
      const { data: pages, error } = await supabase
        .from('pages')
        .select('*')
        .eq('book_id', bookId)
        .eq('archived', false)
        .order('page_index', { ascending: true });

      if (error) throw error;

      // Create the PDF content with styling
      const element = document.createElement('div');
      element.innerHTML = `
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; padding: 40px; }
          h1 { font-size: 32px; margin-bottom: 20px; text-align: center; }
          .cover { max-width: 300px; margin: 20px auto; display: block; }
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
        </style>
        <div class="cover-page">
          ${coverUrl 
            ? `<img src="${coverUrl}" class="cover" />`
            : `<h1 class="book-title">${name}</h1>
               ${author ? `<div class="book-author">by ${author}</div>` : ''}`
          }
        </div>
        ${pages?.map((page, index) => `
          <div class="page">
            <div class="page-title">${page.title || `Page ${index + 1}`}</div>
            <div class="page-content">${page.html_content || ''}</div>
          </div>
        `).join('')}
      `;
      
      // Create a new window for PDF
      const win = window.open('', '_blank');
      if (!win) {
        toast({
          variant: "destructive",
          title: "Error",
          description: "Unable to open print window"
        });
        return;
      }
      
      win.document.write(`
        <html>
          <head>
            <title>${name}</title>
          </head>
          <body>
            ${element.innerHTML}
          </body>
        </html>
      `);
      
      // Trigger print dialog which can save as PDF
      win.document.close();
      win.focus();
      win.print();
      win.close();

      toast({
        title: "PDF Generated",
        description: "Your book is ready to download"
      });
    } catch (error: any) {
      console.error('Error generating PDF:', error);
      toast({
        variant: "destructive",
        title: "Error generating PDF",
        description: error.message
      });
    }
  };

  return (
    <Card className="bg-white shadow-sm">
      <CardHeader className="space-y-6">
        <div className="space-y-4">
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
          <Button 
            onClick={handleDownloadPDF}
            variant="outline"
            className="w-full"
          >
            <Download className="h-4 w-4 mr-2" />
            Download PDF
          </Button>
        </div>
      </CardHeader>
    </Card>
  );
};