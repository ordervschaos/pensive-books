import { Button } from "@/components/ui/button";
import { ImageIcon, Play, Pencil, Download, ChevronDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { generateAndDownloadEPUB, generatePDFWithPrintDialog, generateAndDownloadMarkdown } from "@/lib/download";
import { useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatDistanceToNow } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { UnsplashPicker } from "./UnsplashPicker";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BookCoverFallback } from "./BookCoverFallback";

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
  const [uploading, setUploading] = useState(false);
  const [isEditCoverOpen, setIsEditCoverOpen] = useState(false);
  const [currentCoverUrl, setCurrentCoverUrl] = useState(coverUrl);

  // Sync coverUrl prop changes with local state
  useEffect(() => {
    setCurrentCoverUrl(coverUrl);
  }, [coverUrl]);

  const handleDownloadPDF = async () => {
    const result = await generatePDFWithPrintDialog({ 
      bookId, 
      name, 
      subtitle,
      author,
      coverUrl: currentCoverUrl,
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
      coverUrl: currentCoverUrl,
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

  const handleDownloadMarkdown = async () => {
    const result = await generateAndDownloadMarkdown({
      bookId,
      name,
      subtitle,
      author,
      coverUrl: currentCoverUrl,
      showTextOnCover
    });

    if (result.success) {
      toast({
        title: "Markdown Generated",
        description: "Your book has been downloaded as Markdown files"
      });
    } else {
      toast({
        variant: "destructive",
        title: "Error generating Markdown",
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
        coverUrl: currentCoverUrl,
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

  const handleCoverUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    try {
      setUploading(true);
      const file = event.target.files?.[0];
      if (!file) return;

      if (!file.type.startsWith('image/')) {
        toast({
          variant: "destructive",
          title: "Invalid file type",
          description: "Please upload an image file."
        });
        return;
      }

      const fileExt = file.name.split('.').pop();
      const fileName = `${bookId}_${Math.random().toString(36).slice(2)}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('public_images')
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('public_images')
        .getPublicUrl(fileName);

      await updateBookCover(publicUrl);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error uploading cover",
        description: error instanceof Error ? error.message : "An error occurred"
      });
    } finally {
      setUploading(false);
      setIsEditCoverOpen(false);
    }
  };

  const handleUnsplashSelect = async (imageUrl: string) => {
    try {
      setUploading(true);
      await updateBookCover(imageUrl);
      setIsEditCoverOpen(false);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error setting cover",
        description: error instanceof Error ? error.message : "An error occurred"
      });
    } finally {
      setUploading(false);
    }
  };

  const updateBookCover = async (url: string) => {
    const { error: updateError } = await supabase
      .from('books')
      .update({ cover_url: url })
      .eq('id', bookId);

    if (updateError) throw updateError;

    setCurrentCoverUrl(url);

    toast({
      title: "Cover updated",
      description: "Your book cover has been successfully updated."
    });
  };

  const lastUpdatedLabel = lastUpdated ? formatDistanceToNow(new Date(lastUpdated), { addSuffix: true }) : null;

  return (
    <div className="grid grid-cols-1 gap-6 p-5 sm:grid-cols-[160px,1fr] sm:p-6 md:grid-cols-[200px,1fr] md:gap-8 md:p-8">
          {/* Book Cover */}
        <div className="relative overflow-hidden rounded-xl ring-1 ring-border/50 group">
            {currentCoverUrl ? (
              <img
                src={currentCoverUrl}
                alt={`${name} cover`}
                className="h-full w-full object-cover"
                loading="lazy"
              />
            ) : (
              <BookCoverFallback
                bookId={bookId}
                title={name}
                author={author}
                variant="hero"
                className="min-h-[220px]"
              />
            )}
            
            {/* Edit Cover Button - Only shows when user can edit */}
            {canEdit && (
              <Dialog open={isEditCoverOpen} onOpenChange={setIsEditCoverOpen}>
                <DialogTrigger asChild>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="absolute bottom-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity bg-background/90 backdrop-blur-sm hover:bg-background/95"
                    disabled={uploading}
                  >
                    {uploading ? "Updating..." : <><ImageIcon className="h-4 w-4 mr-1" /> Edit Cover</>}
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Choose Cover Image</DialogTitle>
                  </DialogHeader>
                  <Tabs defaultValue="upload">
                    <TabsList className="grid w-full grid-cols-2">
                      <TabsTrigger value="upload">Upload</TabsTrigger>
                      <TabsTrigger value="unsplash">Unsplash</TabsTrigger>
                    </TabsList>
                    <TabsContent value="upload" className="space-y-4">
                      <Input
                        type="file"
                        accept="image/*"
                        onChange={handleCoverUpload}
                        disabled={uploading}
                      />
                    </TabsContent>
                    <TabsContent value="unsplash">
                      <UnsplashPicker onSelect={handleUnsplashSelect} />
                    </TabsContent>
                  </Tabs>
                </DialogContent>
              </Dialog>
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
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-2 h-9 gap-2 text-sm"
                  >
                    <Download className="h-4 w-4" />
                    Export
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56">
                  <DropdownMenuItem onClick={handleDownloadEPUB}>
                    Download EPUB
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleDownloadPDF}>
                    Download PDF
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleDownloadMarkdown}>
                    Download Markdown
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleSendToKindle} disabled={sending}>
                    {sending ? "Sending to Kindle..." : "Send to Kindle"}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
    </div>
  );
};
