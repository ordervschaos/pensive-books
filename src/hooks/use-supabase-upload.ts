
import { supabase } from "@/integrations/supabase/client";
import imageCompression from "browser-image-compression";

class SupabaseUploadAdapter {
  constructor(private file: File) {}

  async upload() {
    console.log("uploading image to supabase", this.file);

    // Compress the image
    const compressedFile = await this.compressImage(this.file);

    const fileExt = compressedFile.name.split(".").pop();
    const fileName = `${Date.now()}.${fileExt}`;

    const { data, error } = await supabase.storage
      .from("images")
      .upload(fileName, compressedFile);

    if (error) {
      throw error;
    }

    const { data: urlData } = supabase.storage
      .from("images")
      .getPublicUrl(data.path);

    return {
      default: urlData.publicUrl,
    };
  }

  private async compressImage(file: File) {
    const options = {
      maxSizeMB: 1,
      maxWidthOrHeight: 1920,
      useWebWorker: true,
    };

    try {
      const compressedFile = await imageCompression(file, options);
      return compressedFile;
    } catch (error) {
      console.error("Error compressing image:", error);
      return file;
    }
  }

  abort() {
    // Handle abort if needed
  }
}

export const useSupabaseUpload = () => {
  return (file: File) => new SupabaseUploadAdapter(file);
};
