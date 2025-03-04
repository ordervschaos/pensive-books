
import { useState } from "react";
import { Card, CardHeader } from "@/components/ui/card";
import { Image as ImageIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { UnsplashPicker } from "./UnsplashPicker";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface BookCoverEditProps {
  bookId: number;
  coverUrl?: string | null;
  showTextOnCover?: boolean;
  title?: string;
  subtitle?: string | null;
  author?: string;
  photographer?: string | null;
  onCoverChange?: (url: string, photographer?: string | null, photographerUsername?: string | null) => void;
  onShowTextChange?: (showText: boolean) => void;
}

export const BookCoverEdit = ({ 
  bookId, 
  coverUrl,
  showTextOnCover = false,
  title = "",
  subtitle = "",
  author = "",
  photographer = null,
  onCoverChange,
  onShowTextChange
}: BookCoverEditProps) => {
  const [uploading, setUploading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [isShowingText, setIsShowingText] = useState(showTextOnCover);
  const { toast } = useToast();

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
      const fileName = `${bookId || 'new'}_${Math.random().toString(36).slice(2)}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('public_images')
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('public_images')
        .getPublicUrl(fileName);

      await updateBookCover(publicUrl, null, null);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error uploading cover",
        description: error instanceof Error ? error.message : "An error occurred"
      });
    } finally {
      setUploading(false);
      setIsOpen(false);
    }
  };

  const handleUnsplashSelect = async (imageUrl: string, photographer: string, photographerUsername: string) => {
    try {
      setUploading(true);
      await updateBookCover(imageUrl, photographer, photographerUsername);
      setIsOpen(false);
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

  const updateBookCover = async (url: string, photographer: string | null = null, photographerUsername: string | null = null) => {
    try {
      if (bookId === 0) {
        // For new book, just update the parent state
        onCoverChange?.(url, photographer, photographerUsername);
      } else {
        // For existing book, update in database
        const { error: updateError } = await supabase
          .from('books')
          .update({ 
            cover_url: url,
            photographer: photographer,
            photographer_username: photographerUsername
          })
          .eq('id', bookId);

        if (updateError) throw updateError;

        // If parent provided onCoverChange, call it
        onCoverChange?.(url, photographer, photographerUsername);
      }

      toast({
        title: "Cover updated",
        description: "Your book cover has been successfully updated."
      });
    } catch (error) {
      throw error;
    }
  };

  const handleTextToggle = async () => {
    try {
      const newShowTextValue = !isShowingText;
      setIsShowingText(newShowTextValue);
      
      if (bookId === 0) {
        // For new book, just update the parent state
        onShowTextChange?.(newShowTextValue);
      } else {
        // For existing book, update in database
        const { error } = await supabase
          .from('books')
          .update({ show_text_on_cover: newShowTextValue })
          .eq('id', bookId);

        if (error) throw error;

        // If parent provided onShowTextChange, call it
        onShowTextChange?.(newShowTextValue);
      }

      toast({
        title: "Setting updated",
        description: `Text overlay ${newShowTextValue ? 'enabled' : 'disabled'}`
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error updating setting",
        description: error instanceof Error ? error.message : "An error occurred"
      });
      setIsShowingText(!isShowingText); // Revert state on error
    }
  };

  return (
    <Card className="border bg-card">
      <CardHeader className="space-y-6">
        <div className="space-y-4">
          <div className="w-full aspect-[3/4] relative rounded-lg overflow-hidden bg-muted">
            {coverUrl ? (
              <div className="relative w-full h-full">
                <img 
                  src={coverUrl} 
                  alt="Book cover" 
                  className="w-full h-full object-cover"
                />
                {isShowingText && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 p-4">
                    <h1 className="text-2xl font-bold text-white text-center mb-2">
                      {title || "Untitled"}
                    </h1>
                    {subtitle && (
                      <p className="text-lg text-white/90 text-center mb-4">
                        {subtitle}
                      </p>
                    )}
                    {author && (
                      <p className="text-lg text-white/90 text-center">
                        by {author}
                      </p>
                    )}
                  </div>
                )}
                {photographer && (
                  <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-xs text-white p-1 text-center">
                    Photo by {photographer} on Unsplash
                  </div>
                )}
              </div>
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <ImageIcon className="w-16 h-16 text-muted-foreground" />
              </div>
            )}
            <Dialog open={isOpen} onOpenChange={setIsOpen}>
              <DialogTrigger asChild>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className={cn(
                    "absolute bottom-4 right-4",
                    "bg-background/90 backdrop-blur-sm hover:bg-background/95"
                  )}
                  disabled={uploading}
                >
                  {uploading ? "Updating..." : <ImageIcon className="h-4 w-4" />}
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
          </div>
          <div className="flex items-center space-x-2">
            <Switch
              id="show-text"
              checked={isShowingText}
              onCheckedChange={handleTextToggle}
            />
            <Label htmlFor="show-text">Show title and author on cover</Label>
          </div>
        </div>
      </CardHeader>
    </Card>
  );
};
