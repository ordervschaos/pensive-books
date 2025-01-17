import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { Button } from "@/components/ui/button";
import { Bold, Italic, List, ListOrdered, ImagePlus, Eye, Pencil } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import imageCompression from 'browser-image-compression';
import { useState } from 'react';

interface TipTapEditorProps {
  content: string;
  onChange: (html: string, json: any) => void;
  editable?: boolean;
  isPublic?: boolean;
  bookId?: number;
}

export const TipTapEditor = ({ 
  content, 
  onChange, 
  editable = true,
  isPublic = false,
  bookId 
}: TipTapEditorProps) => {
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Image
    ],
    content,
    editable: isEditing,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML(), editor.getJSON());
    },
  });

  const compressImage = async (file: File) => {
    const options = {
      maxSizeMB: 1,
      maxWidthOrHeight: 1920,
      useWebWorker: true,
    };

    try {
      return await imageCompression(file, options);
    } catch (error) {
      console.error('Error compressing image:', error);
      return file;
    }
  };

  const uploadImage = async (file: File) => {
    try {
      console.log('Starting image upload...', { isPublic, bookId });
      
      if (!bookId) {
        throw new Error('Book ID is required for image upload');
      }

      // Compress the image first
      const compressedFile = await compressImage(file);
      
      const fileExt = file.name.split('.').pop();
      const fileName = `${bookId}/${Date.now()}.${fileExt}`;
      const bucketName = isPublic ? 'public_images' : 'images';

      console.log('Uploading to bucket:', bucketName, 'path:', fileName);

      let { data, error } = await supabase.storage
        .from(bucketName)
        .upload(fileName, compressedFile);

      if (error) {
        console.error('Upload error:', error);
        throw error;
      }

      console.log('File uploaded successfully, getting public URL...');

      // Then get the public URL
      const { data: { publicUrl } } = supabase.storage
        .from(bucketName)
        .getPublicUrl(fileName);

      console.log('Got public URL:', publicUrl);

      if (editor) {
        editor.chain().focus().setImage({ src: publicUrl }).run();
      }

      toast({
        title: "Image uploaded",
        description: "The image has been added to your content"
      });
    } catch (error: any) {
      console.error('Error uploading image:', error);
      toast({
        variant: "destructive",
        title: "Upload failed",
        description: error.message
      });
    }
  };

  const handleImageUpload = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (file) {
        await uploadImage(file);
      }
    };
    input.click();
  };

  if (!editor) {
    return null;
  }

  return (
    <div className="border rounded-lg">
      <div className="border-b p-2 flex justify-between">
        {isEditing ? (
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => editor.chain().focus().toggleBold().run()}
              className={editor.isActive('bold') ? 'bg-muted' : ''}
            >
              <Bold className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => editor.chain().focus().toggleItalic().run()}
              className={editor.isActive('italic') ? 'bg-muted' : ''}
            >
              <Italic className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => editor.chain().focus().toggleBulletList().run()}
              className={editor.isActive('bulletList') ? 'bg-muted' : ''}
            >
              <List className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
              className={editor.isActive('orderedList') ? 'bg-muted' : ''}
            >
              <ListOrdered className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleImageUpload}
            >
              <ImagePlus className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          // Empty div to maintain flex layout
          <div />
        )}
        {editable && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setIsEditing(!isEditing);
              editor.setEditable(!isEditing);
            }}
          >
            {isEditing ? (
              <>
                <Eye className="mr-2 h-4 w-4" />
                Preview
              </>
            ) : (
              <>
                <Pencil className="mr-2 h-4 w-4" />
                Edit
              </>
            )}
          </Button>
        )}
      </div>
      <div className="prose max-w-none p-4">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
};