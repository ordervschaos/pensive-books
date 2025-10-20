import {
  Card,
  CardHeader
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ImageIcon, Download, FileText, Tablet } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { generatePDF, generateAndDownloadEPUB } from "@/lib/download";
import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { convertJSONToHTML } from "@/utils/tiptapHelpers";

interface BookInfoProps {
  name: string;
  coverUrl?: string | null;
  bookId: number;
  author?: string | null;
  subtitle?: string | null;
  showTextOnCover?: boolean;
}

export const BookInfo = ({ 
  name,
  coverUrl,
  bookId,
  author,
  subtitle,
  showTextOnCover = false
}: BookInfoProps) => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [sending, setSending] = useState(false);

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
      if (!pages || pages.length === 0) {
        throw new Error('No pages found for the book');
      }

      // Create a new window for printing
      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        throw new Error('Failed to open print window');
      }

      // Create the HTML content for printing
      const htmlContent = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>${name}</title>
            <style>
              body {
                font-family: Arial, sans-serif;
                line-height: 1.6;
                margin: 0;
                padding: 20px;
                max-width: 800px;
                margin: 0 auto;
              }
              .cover {
                text-align: center;
                margin-bottom: 40px;
                page-break-after: always;
              }
              .cover img {
                max-width: 300px;
                height: auto;
                margin-bottom: 20px;
              }
              .cover h1 {
                font-size: 2.5em;
                margin-bottom: 10px;
              }
              .cover h2 {
                font-size: 1.5em;
                color: #666;
                margin-bottom: 20px;
              }
              .cover p {
                font-size: 1.2em;
                color: #444;
              }
              .section {
                text-align: center;
                margin: 40px 0;
                page-break-before: always;
              }
              .section h2 {
                font-size: 2em;
                margin-bottom: 20px;
              }
              .content {
                margin: 20px 0;
              }
              .content img {
                max-width: 100%;
                height: auto;
                margin: 20px 0;
              }
              @media print {
                body {
                  padding: 0;
                }
                .content {
                  page-break-inside: avoid;
                }
              }
            </style>
          </head>
          <body>
            <div class="cover">
              ${coverUrl ? `<img src="${coverUrl}" alt="Book cover">` : ''}
              <h1>${name}</h1>
              ${subtitle ? `<h2>${subtitle}</h2>` : ''}
              ${author ? `<p>by ${author}</p>` : ''}
            </div>
            ${pages.map(page => {
              const pageHtml = page.content ? convertJSONToHTML(page.content) : '';

              return `
              ${page.page_type === 'section'
                ? `<div class="section"><h2>${page.title || 'Untitled Section'}</h2></div>`
                : `<div class="content">${pageHtml}</div>`
              }
            `;
            }).join('')}
          </body>
        </html>
      `;

      // Write the content to the new window
      printWindow.document.write(htmlContent);
      printWindow.document.close();

      // Wait for images to load before printing
      printWindow.onload = () => {
        printWindow.print();
        // Close the window after printing (or if printing is cancelled)
        printWindow.onafterprint = () => {
          printWindow.close();
        };
      };

      toast({
        title: "Print Dialog Opened",
        description: "Please use your browser's print dialog to save as PDF"
      });
    } catch (error) {
      console.error('Error preparing PDF:', error);
      toast({
        variant: "destructive",
        title: "Error preparing PDF",
        description: error instanceof Error ? error.message : 'An unexpected error occurred'
      });
    }
  };

  const handleDownloadEPUB = async () => {
    const result = await generateAndDownloadEPUB({ 
      bookId, 
      name, 
      subtitle,
      author,
      coverUrl,
      showTextOnCover
    });
    
    if (result.success) {
      toast({
        title: "EPUB Generated",
        description: "Your book has been downloaded as EPUB"
      });
    } else {
      toast({
        variant: "destructive",
        title: "Error generating EPUB",
        description: result.error?.message
      });
    }
  };

  const handleSendToKindle = async () => {
    try {
      setSending(true);
      
      // Check if user is logged in
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        navigate("/auth");
        return;
      }

      // Check Kindle configuration
      const { data: userData, error: userError } = await supabase
        .from('user_data')
        .select('kindle_email, kindle_configured')
        .eq('user_id', session.user.id)
        .single();

      if (userError || !userData) {
        throw new Error('Could not fetch user data');
      }

      if (!userData.kindle_configured || !userData.kindle_email) {
        navigate('/settings/kindle');
        return;
      }

      // Generate EPUB content
      const result = await generateAndDownloadEPUB({ 
        bookId, 
        name, 
        subtitle,
        author,
        coverUrl,
        showTextOnCover,
        returnBlob: true
      });

      if (!result.success || !result.blob) {
        throw new Error('Failed to generate EPUB');
      }

      // Convert blob to base64
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === 'string') {
            // Remove the data URL prefix
            const base64 = reader.result.split(',')[1];
            resolve(base64);
          } else {
            reject(new Error('Failed to convert file to base64'));
          }
        };
        reader.onerror = reject;
        reader.readAsDataURL(result.blob);
      });

      // Use the new client-side approach to send to Kindle
      const { data, error } = await supabase.functions.invoke('get-kindle-token', {
        body: { 
          bookId,
          title: name,
          kindle_email: userData.kindle_email
        }
      });
      
      if (error) throw new Error(`Failed to get token: ${error.message}`);
      
      const { token, mailgunEndpoint, mailgunApiKey } = data;
      
      // Create form data for the email with the correct from address
      const formData = new FormData();
      formData.append('from', `Pensive <hello@pensive.me>`);
      formData.append('to', userData.kindle_email);
      formData.append('subject', name);
      formData.append('text', `Your book "${name}" is attached.`);
      
      // Convert base64 to Blob for the attachment
      const binaryData = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
      const blob = new Blob([binaryData], { type: 'application/epub+zip' });
      formData.append('attachment', blob, `${name}.epub`);
      
      // Send to Mailgun directly from the client
      const response = await fetch(mailgunEndpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${btoa(`api:${mailgunApiKey}`)}`,
        },
        body: formData,
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to send email');
      }

      toast({
        title: "Book Sent to Kindle",
        description: "Your book will appear on your Kindle shortly"
      });
    } catch (error) {
      console.error('Error sending to Kindle:', error);
      toast({
        variant: "destructive",
        title: "Error Sending to Kindle",
        description: error instanceof Error ? error.message : 'An unexpected error occurred'
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <Card className="bg-background shadow-sm w-full lg:max-w-[300px]">
      <div className="flex flex-col gap-4">
        <CardHeader className="space-y-6">
          <div className="w-full aspect-[3/4] relative rounded-lg overflow-hidden bg-muted">
            {coverUrl ? (
              <div className="relative w-full h-full">
                <img 
                  src={coverUrl} 
                  alt="Book cover"
                  className="w-full h-full object-cover"
                />
                {showTextOnCover && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/30 p-4">
                    <h1 className="text-sm sm:text-base lg:text-2xl font-bold text-white text-center mb-1 sm:mb-2">
                      {name}
                    </h1>
                    {subtitle && (
                      <p className="text-xs sm:text-sm lg:text-lg text-white/90 text-center mb-1 sm:mb-4">
                        {subtitle}
                      </p>
                    )}
                    {author && (
                      <p className="text-xs sm:text-sm lg:text-lg text-white/90 text-center">
                        by {author}
                      </p>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <ImageIcon className="w-16 h-16 text-muted-foreground" />
              </div>
            )}
          </div>
          <div className="flex flex-col sm:flex-row lg:flex-col gap-2">
            <Button
              onClick={handleDownloadEPUB}
              variant="outline"
              className="w-full text-xs sm:text-sm"
            >
              <Download className="h-4 w-4 mr-2" />
              Download EPUB
            </Button>
            <Button
              onClick={handleDownloadPDF}
              variant="outline"
              className="w-full text-xs sm:text-sm"
            >
              <FileText className="h-4 w-4 mr-2" />
              Download PDF
            </Button>
            <Button
              onClick={handleSendToKindle}
              variant="outline"
              className="w-full text-xs sm:text-sm"
              disabled={sending}
            >
              <Tablet className="h-4 w-4 mr-2" />
              {sending ? "Sending..." : "Send to Kindle"}
            </Button>
          </div>
        </CardHeader>
      </div>
    </Card>
  );
};
