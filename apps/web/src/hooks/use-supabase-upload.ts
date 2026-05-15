import { supabase } from "@/integrations/supabase/client";
import imageCompression from "browser-image-compression";

interface UploadOptions {
  preserveAnimation?: boolean;
}

class SupabaseUploadAdapter {
  constructor(private file: File) {}

  async upload(options: UploadOptions = {}) {
    console.log("uploading image to supabase", this.file);

    // Create a separate upload path for GIFs
    if (this.file.type === 'image/gif') {
      return this.uploadGif();
    }

    // For non-GIF images, use compression
    return this.uploadWithCompression();
  }

  private async uploadGif() {
    const fileExt = this.file.name.split(".").pop();
    const fileName = `${crypto.randomUUID()}.${fileExt}`;

    // Read the file as an ArrayBuffer to preserve all data
    const arrayBuffer = await this.file.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    const { data, error } = await supabase.storage
      .from("images")
      .upload(fileName, uint8Array, {
        contentType: 'image/gif',
        cacheControl: '3600',
        upsert: false
      });

    if (error) {
      console.error("Error uploading GIF:", error);
      throw error;
    }

    const { data: urlData } = supabase.storage
      .from("images")
      .getPublicUrl(data.path);

    return { default: urlData.publicUrl };
  }

  private async uploadWithCompression() {
    const compressedFile = await this.compressImage(this.file);

    const fileExt = compressedFile.name.split(".").pop();
    const fileName = `${crypto.randomUUID()}.${fileExt}`;

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

