import { useState } from "react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar, Clock, Globe, Upload, Image as ImageIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { UnsplashPicker } from "./UnsplashPicker";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface BookInfoProps {
  name: string;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  bookId: number;
  coverUrl?: string | null;
}

export const BookInfo = ({ 
  name, 
  isPublic, 
  createdAt, 
  updatedAt, 
  publishedAt, 
  bookId,
  coverUrl 
}: BookInfoProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const [bookName, setBookName] = useState(name);
  const [uploading, setUploading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const { toast } = useToast();

  const handleNameChange = async (newName: string) => {
    try {
      const { error } = await supabase
        .from("books")
        .update({ name: newName })
        .eq("id", bookId);

      if (error) throw error;

      setBookName(newName);
      toast({
        title: "Book name updated",
        description: "Your book name has been successfully updated."
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error updating book name",
        description: error.message
      });
      setBookName(name);
    }
    setIsEditing(false);
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
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              {isEditing ? (
                <Input
                  value={bookName}
                  onChange={(e) => setBookName(e.target.value)}
                  onBlur={() => {
                    if (bookName !== name) {
                      handleNameChange(bookName);
                    } else {
                      setIsEditing(false);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      if (bookName !== name) {
                        handleNameChange(bookName);
                      } else {
                        setIsEditing(false);
                      }
                    }
                    if (e.key === "Escape") {
                      setBookName(name);
                      setIsEditing(false);
                    }
                  }}
                  className="text-2xl font-semibold w-[300px]"
                  autoFocus
                />
              ) : (
                <CardTitle 
                  className="text-2xl cursor-pointer hover:text-muted-foreground transition-colors"
                  onClick={() => setIsEditing(true)}
                >
                  {bookName}
                </CardTitle>
              )}
              {isPublic && (
                <span className="text-sm text-muted-foreground flex items-center">
                  <Globe className="mr-1 h-4 w-4" />
                  Public
                </span>
              )}
            </div>
            <div className="flex space-x-4 text-sm text-muted-foreground">
              <div className="flex items-center">
                <Clock className="mr-1 h-4 w-4" />
                Last updated {new Date(updatedAt).toLocaleDateString()}
              </div>
              {publishedAt && (
                <div className="flex items-center">
                  <Globe className="mr-1 h-4 w-4" />
                  Published {new Date(publishedAt).toLocaleDateString()}
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end space-y-4">
            {coverUrl && (
              <img 
                src={coverUrl} 
                alt="Book cover" 
                className="w-32 h-32 object-cover rounded-lg shadow-md"
              />
            )}
            <Dialog open={isOpen} onOpenChange={setIsOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" disabled={uploading}>
                  {uploading ? (
                    "Updating..."
                  ) : (
                    <>
                      <ImageIcon className="mr-2 h-4 w-4" />
                      Update Cover
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
        </div>
      </CardHeader>
    </Card>
  );
};