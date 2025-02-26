
import { Editor } from '@tiptap/react';
import { Bold, Italic, Quote, Code2, Link2, List, ListOrdered, Image as ImageIcon, Undo, Redo, Pencil, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useSupabaseUpload } from "@/hooks/use-supabase-upload";

interface EditorToolbarProps {
  editor: Editor | null;
  isEditing: boolean;
  onToggleEdit?: () => void;
  editable: boolean;
  customButtons?: React.ReactNode;
}

export const EditorToolbar = ({ editor, isEditing, onToggleEdit, editable, customButtons }: EditorToolbarProps) => {
  const { toast } = useToast();
  const uploadImage = useSupabaseUpload();

  if (!editor) return null;

  const addLink = () => {
    const url = window.prompt('Enter URL');
    if (url) {
      editor.chain().focus().setLink({ href: url }).run();
    }
  };

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    if (!file.type.startsWith('image/')) {
      toast({
        title: "Invalid file type",
        description: "Please upload an image file",
        variant: "destructive",
      });
      return;
    }

    try {
      const { default: url } = await uploadImage(file).upload();
      editor.chain().focus().setImage({ src: url }).run();
    } catch (error) {
      toast({
        title: "Upload failed",
        description: "Failed to upload image",
        variant: "destructive",
      });
    }
  };

  return (
    <div className={`rounded-md flex gap-1 items-center p-1 flex-wrap z-50 ${isEditing ? 'sticky top-4 bg-muted/50 shadow-sm backdrop-blur-sm' : ''}`}>
      {isEditing && (
        <>
          <div className="flex gap-1">
            {[2, 3, 4, 5, 6].map((level) => (
              <Button
                key={level}
                variant="ghost"
                size="sm"
                onClick={() => editor.chain().focus().toggleHeading({ level: level as 2 | 3 | 4 | 5 | 6 }).run()}
                className={editor.isActive('heading', { level: level as 2 | 3 | 4 | 5 | 6 }) ? 'bg-muted' : ''}
              >
                h{level}
              </Button>
            ))}
          </div>
          <div className="w-px h-4 bg-border mx-1" />
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
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            className={editor.isActive('blockquote') ? 'bg-muted' : ''}
          >
            <Quote className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
            className={editor.isActive('codeBlock') ? 'bg-muted' : ''}
          >
            <Code2 className="h-4 w-4" />
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
            onClick={addLink}
            className={editor.isActive('link') ? 'bg-muted' : ''}
          >
            <Link2 className="h-4 w-4" />
          </Button>
          <div className="relative">
            <Button
              variant="ghost"
              size="sm"
              className="relative"
            >
              <input
                type="file"
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                onChange={handleImageUpload}
                accept="image/*"
              />
              <ImageIcon className="h-4 w-4" />
            </Button>
          </div>
          <div className="ml-auto flex gap-1 items-center">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => editor.chain().focus().undo().run()}
              disabled={!editor.can().undo()}
            >
              <Undo className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => editor.chain().focus().redo().run()}
              disabled={!editor.can().redo()}
            >
              <Redo className="h-4 w-4" />
            </Button>
            {customButtons}
          </div>
          <div className="ml-auto">
            {customButtons}
          </div>
        </>
      )}

      {editable && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggleEdit}
          className="ml-auto"
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
  );
};
