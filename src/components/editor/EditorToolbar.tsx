import { Editor } from '@tiptap/react';
import { Bold, Italic, Quote, Code2, Link2, List, ListOrdered, Image as ImageIcon, Undo, Redo, Table as TableIcon, MoreHorizontal, Heading1, Heading2, Heading3, Heading, Pencil, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useSupabaseUpload } from "@/hooks/use-supabase-upload";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useMediaQuery } from "@/hooks/use-media-query";

interface EditorToolbarProps {
  editor: Editor | null;
  isEditing: boolean;
  onToggleEdit: () => void;
  editable: boolean;
  customButtons?: React.ReactNode;
  onToggleChat?: () => void;
  hasActiveChat?: boolean;
}

export const EditorToolbar = ({ editor, isEditing, onToggleEdit, editable, customButtons, onToggleChat, hasActiveChat }: EditorToolbarProps) => {
  const { toast } = useToast();
  const uploadImage = useSupabaseUpload();
  const isMobile = useMediaQuery("(max-width: 768px)");
  const isBetaEnabled = localStorage.getItem('is_beta') === 'true';

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

  const addTable = () => {
    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
  };

  const addTableRow = () => {
    editor.chain().focus().addRowAfter().run();
  };

  const addTableColumn = () => {
    editor.chain().focus().addColumnAfter().run();
  };

  const deleteTableRow = () => {
    editor.chain().focus().deleteRow().run();
  };

  const deleteTableColumn = () => {
    editor.chain().focus().deleteColumn().run();
  };

  const deleteTable = () => {
    editor.chain().focus().deleteTable().run();
  };

  const toggleTableHeader = () => {
    editor.chain().focus().toggleHeaderRow().run();
  };

  const isTableActive = editor.isActive('table');

  const renderTextFormattingButtons = () => (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => editor.chain().focus().toggleBold().run()}
        className={`h-8 w-8 p-0 ${editor.isActive('bold') ? 'bg-muted' : ''}`}
      >
        <Bold className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => editor.chain().focus().toggleItalic().run()}
        className={`h-8 w-8 p-0 ${editor.isActive('italic') ? 'bg-muted' : ''}`}
      >
        <Italic className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        className={`h-8 w-8 p-0 ${editor.isActive('blockquote') ? 'bg-muted' : ''}`}
      >
        <Quote className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        className={`h-8 w-8 p-0 ${editor.isActive('codeBlock') ? 'bg-muted' : ''}`}
      >
        <Code2 className="h-4 w-4" />
      </Button>
    </>
  );

  const renderListButtons = () => (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        className={`h-8 w-8 p-0 ${editor.isActive('bulletList') ? 'bg-muted' : ''}`}
      >
        <List className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        className={`h-8 w-8 p-0 ${editor.isActive('orderedList') ? 'bg-muted' : ''}`}
      >
        <ListOrdered className="h-4 w-4" />
      </Button>
    </>
  );

  const renderHistoryButtons = () => (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => editor.chain().focus().undo().run()}
        disabled={!editor.can().undo()}
        className="opacity-60 hover:opacity-100 h-7 w-7 p-0"
      >
        <Undo className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!editor.can().redo()}
        className="opacity-60 hover:opacity-100 h-7 w-7 p-0"
      >
        <Redo className="h-3.5 w-3.5" />
      </Button>
    </>
  );

  return (
    <div className="flex gap-2 items-center justify-end min-h-[44px]">
      <div className="flex-1 flex justify-start">
        {isEditing && (
          <div className="rounded-md flex gap-1 grow items-center p-1 z-50 sticky top-4 bg-muted/50 shadow-sm backdrop-blur-sm">
            <div className="flex gap-1 items-center flex-1">
              {!isMobile ? (
              <>
                <div className="flex gap-1">
                  {[1,2, 3, 4, 5, 6].map((level) => (
                    <Button
                      key={level}
                      variant="ghost"
                      size="sm"
                      onClick={() => editor.chain().focus().toggleHeading({ level: level as 1 | 2 | 3 | 4 | 5 | 6 }).run()}
                      className={`h-8 w-8 p-0 text-xs ${editor.isActive('heading', { level: level as 1 | 2 | 3 | 4 | 5 | 6 }) ? 'bg-muted' : ''}`}
                    >
                      h{level}
                    </Button>
                  ))}
                </div>
                <div className="w-px h-4 bg-border mx-0.5" />
                {renderTextFormattingButtons()}
                {renderListButtons()}
              </>
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56">
                  <DropdownMenuItem onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>
                    <Heading className="mr-2 h-4 w-4" />
                    Heading 1
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
                    <Heading className="mr-2 h-4 w-4" />
                    Heading 2
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
                    <Heading3 className="mr-2 h-4 w-4" />
                    Heading 3
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => editor.chain().focus().toggleBold().run()}>
                    <Bold className="mr-2 h-4 w-4" />
                    Bold
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => editor.chain().focus().toggleItalic().run()}>
                    <Italic className="mr-2 h-4 w-4" />
                    Italic
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => editor.chain().focus().toggleBlockquote().run()}>
                    <Quote className="mr-2 h-4 w-4" />
                    Quote
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => editor.chain().focus().toggleCodeBlock().run()}>
                    <Code2 className="mr-2 h-4 w-4" />
                    Code
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => editor.chain().focus().toggleBulletList().run()}>
                    <List className="mr-2 h-4 w-4" />
                    Bullet List
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => editor.chain().focus().toggleOrderedList().run()}>
                    <ListOrdered className="mr-2 h-4 w-4" />
                    Numbered List
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            <div className="w-px h-4 bg-border mx-0.5" />
            
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className={`h-8 w-8 p-0 ${isTableActive ? 'bg-muted' : ''}`}
                >
                  <TableIcon className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onClick={addTable} disabled={isTableActive}>
                  Insert Table
                </DropdownMenuItem>
                <DropdownMenuItem onClick={addTableRow} disabled={!isTableActive}>
                  Add Row
                </DropdownMenuItem>
                <DropdownMenuItem onClick={addTableColumn} disabled={!isTableActive}>
                  Add Column
                </DropdownMenuItem>
                <DropdownMenuItem onClick={deleteTableRow} disabled={!isTableActive}>
                  Delete Row
                </DropdownMenuItem>
                <DropdownMenuItem onClick={deleteTableColumn} disabled={!isTableActive}>
                  Delete Column
                </DropdownMenuItem>
                <DropdownMenuItem onClick={toggleTableHeader} disabled={!isTableActive}>
                  Toggle Header Row
                </DropdownMenuItem>
                <DropdownMenuItem onClick={deleteTable} disabled={!isTableActive}>
                  Delete Table
                </DropdownMenuItem>
                <DropdownMenuItem>
                  {isMobile && customButtons}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            
            <Button
              variant="ghost"
              size="sm"
              onClick={addLink}
              className={`h-8 w-8 p-0 ${editor.isActive('link') ? 'bg-muted' : ''}`}
            >
              <Link2 className="h-4 w-4" />
            </Button>
            
            <div className="relative">
              <Button
                variant="ghost"
                size="sm"
                className="relative h-8 w-8 p-0"
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
            
            <div className="w-px h-4 bg-border mx-0.5" />
            {renderHistoryButtons()}
            {!isMobile && customButtons}
          </div>
        </div>
        )}
      </div>
      {onToggleEdit && editable && (
        <Button 
          size="sm" 
          className="rounded-full"
          variant={isEditing ? "default" : "outline"}
          onClick={onToggleEdit}
          title={isEditing ? "Exit Edit Mode" : "Enter Edit Mode"}
        >
          {isEditing ? (
            <Check className="h-4 w-4" />
          ) : (
            <Pencil className="h-4 w-4" />
          )}
        </Button>
      )}
    </div>
  );
};
