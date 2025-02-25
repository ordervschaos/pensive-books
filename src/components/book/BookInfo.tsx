
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
    const result = await generatePDF({ 
      bookId, 
      name, 
      author,
      coverUrl
    });
    
    if (!result.success) {
      toast({
        variant: "destructive",
        title: "Error generating PDF",
        description: result.error?.message
      });
    } else {
      toast({
        title: "PDF Generated",
        description: "Your book has been downloaded as PDF"
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
        returnBlob: true // Just get the blob, don't trigger download
      });

      if (!result.success || !result.blob) {
        throw new Error('Failed to generate EPUB');
      }

      // Send to Kindle
      const { error: sendError } = await supabase.functions.invoke('send-to-kindle', {
        body: { 
          bookId,
          title: name,
          kindle_email: userData.kindle_email
        },
        headers: {
          Authorization: `Bearer ${session.access_token}`
        }
      });

      if (sendError) throw sendError;

      toast({
        title: "Book Sent to Kindle",
        description: "Your book will appear on your Kindle shortly"
      });
    } catch (error: any) {
      console.error('Error sending to Kindle:', error);
      toast({
        variant: "destructive",
        title: "Error Sending to Kindle",
        description: error.message || 'An unexpected error occurred'
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
