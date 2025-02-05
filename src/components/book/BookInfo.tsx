import { Card, CardHeader } from "@/components/ui/card";
import { ImageIcon, Download } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BookInfoProps {
  name: string;
  coverUrl?: string | null;
}

export const BookInfo = ({ 
  name,
  coverUrl,
}: BookInfoProps) => {
  const handleDownloadPDF = async () => {
    try {
      const element = document.createElement('div');
      element.innerHTML = `
        <h1 style="font-size: 24px; margin-bottom: 20px;">${name}</h1>
        ${coverUrl ? `<img src="${coverUrl}" style="max-width: 300px; margin-bottom: 20px;" />` : ''}
      `;
      
      // Create a new window for PDF
      const win = window.open('', '_blank');
      if (!win) return;
      
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
    } catch (error) {
      console.error('Error generating PDF:', error);
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