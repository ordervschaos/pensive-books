
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

interface BookCoverEditProps {
  bookId: number;
  coverUrl?: string | null;
  showTextOnCover?: boolean;
  title?: string;
  author?: string;
}

export const BookCoverEdit = ({ 
  bookId, 
  coverUrl,
  showTextOnCover = false,
  title = "",
  author = ""
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
      setIsOpen(false);
    }
  };

  const handleUnsplashSelect = async (imageUrl: string) => {
    try {
      setUploading(true);
      await updateBookCover(imageUrl);
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

  const updateBookCover = async (url: string) => {
    const { error: updateError } = await supabase
      .from('books')
      .update({ cover_url: url })
      .eq('id', bookId);

    if (updateError) throw updateError;

    toast({
      title: "Cover updated",
      description: "Your book cover has been successfully updated."
    });

    window.location.reload();
  };

  const handleTextToggle = async () => {
    try {
      const newShowTextValue = !isShowingText;
      setIsShowingText(newShowTextValue);
      
      const { error } = await supabase
        .from('books')
        .update({ show_text_on_cover: newShowTextValue })
        .eq('id', bookId);

      if (error) throw error;

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
    <Card className="bg-white shadow-sm">
      <CardHeader className="space-y-6">
        <div className="space-y-4">
          <div className="w-full aspect-[3/4] relative rounded-lg overflow-hidden bg-blue-100">
            {coverUrl ? (
              <div className="relative w-full h-full">
                <img 
                  src={coverUrl} 
                  alt="Book cover" 
                  className="w-full h-full object-cover"
                />
                {isShowingText && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/30 p-4">
                    <h1 className="text-2xl font-bold text-white text-center mb-2">
                      {title || "Untitled"}
                    </h1>
                    {author && (
                      <p className="text-lg text-white/90 text-center">
                        by {author}
                      </p>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <ImageIcon className="w-16 h-16 text-blue-300" />
              </div>
            )}
            <Dialog open={isOpen} onOpenChange={setIsOpen}>
              <DialogTrigger asChild>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="absolute bottom-4 right-4 bg-white/90 backdrop-blur-sm hover:bg-white/95"
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
