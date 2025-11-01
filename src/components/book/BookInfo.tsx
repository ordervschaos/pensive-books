import { Button } from "@/components/ui/button";
import { ImageIcon, Play, Pencil } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {  generateAndDownloadEPUB, generatePDFWithPrintDialog } from "@/lib/download";
import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatDistanceToNow } from "date-fns";

interface BookInfoProps {
  name: string;
  coverUrl?: string | null;
  bookId: number;
  author?: string | null;
  subtitle?: string | null;
  showTextOnCover?: boolean;
  currentPage?: number;
  totalPages?: number;
  onContinueReading?: () => void;
  onContinueWriting?: () => void;
  lastUpdated?: string | null;
  canEdit?: boolean;
  lastUpdatedPageIndex?: number;
  showWritingButton?: boolean;
}

export const BookInfo = ({
  name,
  coverUrl,
  bookId,
  author,
  subtitle,
  showTextOnCover = false,
  currentPage = 0,
  totalPages = 0,
  onContinueReading,
  onContinueWriting,
  lastUpdated,
  canEdit = false,
  lastUpdatedPageIndex,
  showWritingButton = false
}: BookInfoProps) => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [sending, setSending] = useState(false);

  const handleDownloadPDF = async () => {
    const result = await generatePDFWithPrintDialog({ 
      bookId, 
      name, 
      subtitle,
      author,
      coverUrl,
      showTextOnCover
    });
    
    if (result.success) {
      toast({
        title: "Print Dialog Opened",
        description: "Please use your browser's print dialog to save as PDF"
      });
    } else {
      toast({
        variant: "destructive",
        title: "Error preparing PDF",
        description: result.error?.message
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

  const lastUpdatedLabel = lastUpdated ? formatDistanceToNow(new Date(lastUpdated), { addSuffix: true }) : null;

  return (
    <div className="grid grid-cols-1 gap-6 p-5 sm:grid-cols-[160px,1fr] sm:p-6 md:grid-cols-[200px,1fr] md:gap-8 md:p-8">
          {/* Book Cover */}
          <div className="relative overflow-hidden rounded-xl ring-1 ring-border/50">
            {coverUrl ? (
              <img
                src={coverUrl}
                alt={`${name} cover`}
                className="h-full w-full object-cover"
                loading="lazy"
              />
            ) : (
              <div className="flex h-full min-h-[220px] w-full items-center justify-center bg-gradient-to-br from-muted/80 to-muted/40">
                <ImageIcon className="h-14 w-14 text-muted-foreground" />
              </div>
            )}
          </div>

          {/* Content Column */}
          <div className="flex flex-col">
            {/* Header */}
            <header className="mb-3">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
                {name}
              </h1>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
                <span>
                  {currentPage + 1} / {totalPages} chapters
                </span>
                {lastUpdatedLabel && (
                  <>
                    <span className="hidden h-1 w-1 rounded-full bg-muted-foreground/50 sm:inline-block" />
                    <span>Updated {lastUpdatedLabel}</span>
                  </>
                )}
              </div>
            </header>

            {/* Action Buttons */}
            <div className="mb-5">
              {showWritingButton && canEdit && onContinueWriting && lastUpdatedPageIndex !== undefined ? (
                <Button
                  type="button"
                  onClick={onContinueWriting}
                  className="group inline-flex items-center justify-center gap-2"
                  size="default"
                  variant="default"
                >
                  <Pencil className="h-4 w-4 transition group-hover:translate-x-0.5" />
                  <span className="font-medium">Continue Writing</span>
                  <span className="text-xs opacity-70">(Page {lastUpdatedPageIndex + 1})</span>
                </Button>
              ) : onContinueReading ? (
                <Button
                  type="button"
                  onClick={onContinueReading}
                  className="group inline-flex items-center justify-center gap-2"
                  size="default"
                  variant="default"
                >
                  <Play className="h-4 w-4 fill-current transition group-hover:translate-x-0.5" />
                  <span className="font-medium">Continue Reading</span>
                  <span className="text-xs opacity-70">(Page {currentPage + 1})</span>
                </Button>
              ) : null}
            </div>

            {/* Downloads Section */}
            <div className="mt-auto">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Downloads
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  onClick={handleDownloadEPUB}
                  variant="outline"
                  size="sm"
                  className="text-sm"
                >
                  EPUB
                </Button>
                <Button
                  type="button"
                  onClick={handleDownloadPDF}
                  variant="outline"
                  size="sm"
                  className="text-sm"
                >
                  PDF
                </Button>
                <Button
                  type="button"
                  onClick={handleSendToKindle}
                  variant="outline"
                  size="sm"
                  className="text-sm"
                  disabled={sending}
                >
                  {sending ? "Sending..." : "Kindle"}
                </Button>
              </div>
            </div>
          </div>
    </div>
  );
};
