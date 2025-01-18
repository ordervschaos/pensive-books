import { useState } from "react";
import { Card, CardHeader } from "@/components/ui/card";
import { Lock, Globe, Image as ImageIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { UnsplashPicker } from "./UnsplashPicker";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";

interface BookInfoProps {
  name: string;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  bookId: number;
  coverUrl?: string | null;
  onTogglePublish: () => void;
  publishing: boolean;
}

export const BookInfo = ({ 
  isPublic,
  bookId,
  coverUrl,
  onTogglePublish,
  publishing
}: BookInfoProps) => {
  const [uploading, setUploading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
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

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('public_images')
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('public_images')
        .getPublicUrl(fileName);

      await updateBookCover(publicUrl);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error uploading cover",
        description: error.message
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
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error setting cover",
        description: error.message
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

  return (
    <Card className="bg-white shadow-sm">
      <CardHeader className="space-y-6">
        <div className="space-y-4">
          {/* Cover image */}
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
            <Dialog open={isOpen} onOpenChange={setIsOpen}>
              <DialogTrigger asChild>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="absolute bottom-4 right-4 bg-white/90 backdrop-blur-sm hover:bg-white/95"
                  disabled={uploading}
                >
                  {uploading ? (
                    "Updating..."
                  ) : (
                    <>
                      <ImageIcon className="h-4 w-4" />
                    </>
                  )}
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

          {/* Publish toggle */}
          <div className="flex items-center justify-center gap-2">
            <Lock className="h-4 w-4 text-muted-foreground" />
            <Switch
              checked={isPublic}
              onCheckedChange={onTogglePublish}
              disabled={publishing}
            />
            <Globe className="h-4 w-4 text-muted-foreground" />
          </div>
        </div>
      </CardHeader>
    </Card>
  );
};