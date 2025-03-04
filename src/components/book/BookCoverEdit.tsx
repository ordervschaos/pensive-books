
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { UnsplashPicker } from "./UnsplashPicker";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Pencil, Image, Loader2, X, Upload } from "lucide-react";
import { useSupabaseUpload } from "@/hooks/use-supabase-upload";

interface BookCoverEditProps {
  bookId: number;
}

export function BookCoverEdit({ bookId }: BookCoverEditProps) {
  const [open, setOpen] = useState(false);
  const [showUnsplash, setShowUnsplash] = useState(false);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const { uploadImage } = useSupabaseUpload();

  const handleUnsplashSelect = async (imageUrl: string, photographer: string, photographerUsername: string) => {
    try {
      setLoading(true);

      // Update the book with the Unsplash image URL and photographer info
      const { error } = await supabase
        .from("books")
        .update({ 
          cover_url: imageUrl,
          photographer: photographer,
          photographer_username: photographerUsername 
        })
        .eq("id", bookId);

      if (error) throw error;

      toast({
        title: "Cover updated",
        description: "Book cover has been updated successfully.",
      });

      setShowUnsplash(false);
      setOpen(false);
    } catch (error: any) {
      console.error("Error updating cover:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to update book cover.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setLoading(true);

      // Upload the image to Supabase Storage
      const { url, error: uploadError } = await uploadImage(file, "book-covers");

      if (uploadError) throw uploadError;

      // Update the book with the new cover URL
      const { error: updateError } = await supabase
        .from("books")
        .update({ 
          cover_url: url,
          // Clear photographer info since this is a custom upload
          photographer: null,
          photographer_username: null
        })
        .eq("id", bookId);

      if (updateError) throw updateError;

      toast({
        title: "Cover updated",
        description: "Book cover has been updated successfully.",
      });

      setOpen(false);
    } catch (error: any) {
      console.error("Error uploading cover:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to upload book cover.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
      // Reset the file input
      e.target.value = "";
    }
  };

  const removeCover = async () => {
    try {
      setLoading(true);

      const { error } = await supabase
        .from("books")
        .update({ 
          cover_url: null,
          photographer: null,
          photographer_username: null
        })
        .eq("id", bookId);

      if (error) throw error;

      toast({
        title: "Cover removed",
        description: "Book cover has been removed.",
      });

      setOpen(false);
    } catch (error: any) {
      console.error("Error removing cover:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to remove book cover.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="absolute bottom-2 left-2 bg-black/50 hover:bg-black/70 text-white"
        >
          <Pencil className="h-4 w-4 mr-2" />
          Edit Cover
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Change Book Cover</DialogTitle>
        
        {showUnsplash ? (
          <UnsplashPicker
            onSelect={handleUnsplashSelect}
            onClose={() => setShowUnsplash(false)}
          />
        ) : (
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <Button
                variant="outline"
                className="h-20"
                onClick={() => setShowUnsplash(true)}
                disabled={loading}
              >
                <Image className="h-5 w-5 mr-2" />
                Choose from Unsplash
              </Button>
              
              <label className="cursor-pointer">
                <div className="flex items-center justify-center h-20 border border-dashed rounded-md">
                  <div className="flex flex-col items-center">
                    <Upload className="h-5 w-5 mb-1" />
                    <span className="text-sm">Upload Image</span>
                  </div>
                </div>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleFileUpload}
                  disabled={loading}
                />
              </label>
            </div>
            
            <Button
              variant="destructive"
              className="w-full"
              onClick={removeCover}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <X className="h-4 w-4 mr-2" />
              )}
              Remove Cover
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
