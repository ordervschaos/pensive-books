import { Editor } from '@tiptap/react';
import { Bold, Italic, Quote, Code2, Link2, List, ListOrdered, Image as ImageIcon, Undo, Redo, Pencil, Check, Table as TableIcon, MoreHorizontal, Heading1, Heading2, Heading3 } from "lucide-react";
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
  onToggleEdit?: () => void;
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
    </>
  );

  const renderListButtons = () => (
    <>
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
    </>
  );

  const renderHistoryButtons = () => (
    <>
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
    </>
  );

  return (
    <>
      {/* Formatting toolbar - only visible when editing */}
      {isEditing && (
        <div className="rounded-md flex gap-1 items-center p-1 flex-wrap z-50 sticky top-4 bg-muted/50 shadow-sm backdrop-blur-sm mb-2">
          <div className="flex gap-1 items-center flex-1 flex-wrap">
            {!isMobile ? (
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
                  <DropdownMenuItem onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
                    <Heading2 className="mr-2 h-4 w-4" />
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

            <div className="w-px h-4 bg-border mx-1" />
            
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className={isTableActive ? 'bg-muted' : ''}
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
            
            <div className="w-px h-4 bg-border mx-1" />
            {renderHistoryButtons()}
            {!isMobile && customButtons}
          </div>
        </div>
      )}

      {/* Circular toggle button - Edit/Preview - Outside toolbar */}
      {editable && (
        <Button
          variant="default"
          size="lg"
          onClick={onToggleEdit}
          className="rounded-full h-14 w-14 p-0 fixed bottom-6 right-6 z-50 shadow-2xl border-2 border-primary/20 hover:scale-110 transition-transform duration-200"
        >
          {isEditing ? (
            <Check className="h-5 w-5" />
          ) : (
            <Pencil className="h-5 w-5" />
          )}
        </Button>
      )}
    </>
  );
};
