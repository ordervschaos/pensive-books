import { Editor } from '@tiptap/react';
import { useEffect, useState } from 'react';
import { Bold, Italic, Quote, Code2, Link2, List, ListOrdered, Image as ImageIcon, Undo, Redo, Table as TableIcon, Heading1, Heading2, Heading3, Heading, Type, Section, MoreHorizontal, Trash2, ChevronDown } from "lucide-react";
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
import { cn } from "@/lib/utils";

interface EditorToolbarProps {
  editor: Editor | null;
  isEditing: boolean;
  onToggleEdit: () => void;
  editable: boolean;
  customButtons?: React.ReactNode;
  pageType?: 'text' | 'section';
  onPageTypeChange?: (newPageType: 'text' | 'section') => void;
  onDeletePage?: () => void;
  saving?: boolean;
  lastSavedAt?: Date | null;
  /**
   * Additional items rendered inside the meatball "More options" dropdown,
   * appended below the built-in page-type / delete-page items. Used by the
   * page view to fold Page Settings + Sign in/out into the same menu on
   * mobile so the editor toolbar doesn't compete with a separate floating
   * kebab in the top-right.
   */
  extraMenuItems?: React.ReactNode;
}

export const EditorToolbar = ({ editor, isEditing, onToggleEdit, editable, customButtons, pageType, onPageTypeChange, onDeletePage, saving, lastSavedAt, extraMenuItems }: EditorToolbarProps) => {
  const { toast } = useToast();
  const uploadImage = useSupabaseUpload();
  const isMobile = useMediaQuery("(max-width: 768px)");

  // Track editor selection to force re-renders when heading changes
  const [, setSelectionUpdate] = useState(0);

  // Update toolbar when editor selection changes
  useEffect(() => {
    if (!editor) return;

    const updateHandler = () => {
      setSelectionUpdate(prev => prev + 1);
    };

    editor.on('selectionUpdate', updateHandler);
    editor.on('update', updateHandler);

    return () => {
      editor.off('selectionUpdate', updateHandler);
      editor.off('update', updateHandler);
    };
  }, [editor]);

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

  const iconBtn = "h-7 w-7 p-0 text-muted-foreground hover:text-foreground";
  const iconBtnActive = "bg-muted text-foreground";

  const renderTextFormattingButtons = () => (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => editor.chain().focus().toggleBold().run()}
        className={cn(iconBtn, editor.isActive('bold') && iconBtnActive)}
      >
        <Bold className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => editor.chain().focus().toggleItalic().run()}
        className={cn(iconBtn, editor.isActive('italic') && iconBtnActive)}
      >
        <Italic className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        className={cn(iconBtn, editor.isActive('blockquote') && iconBtnActive)}
      >
        <Quote className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        className={cn(iconBtn, editor.isActive('codeBlock') && iconBtnActive)}
      >
        <Code2 className="h-3.5 w-3.5" />
      </Button>
    </>
  );

  const renderListButtons = () => (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        className={cn(iconBtn, editor.isActive('bulletList') && iconBtnActive)}
      >
        <List className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        className={cn(iconBtn, editor.isActive('orderedList') && iconBtnActive)}
      >
        <ListOrdered className="h-3.5 w-3.5" />
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
        className={cn(iconBtn, "opacity-60 hover:opacity-100")}
      >
        <Undo className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!editor.can().redo()}
        className={cn(iconBtn, "opacity-60 hover:opacity-100")}
      >
        <Redo className="h-3.5 w-3.5" />
      </Button>
    </>
  );

  const getActiveHeadingLabel = () => {
    for (let level = 1; level <= 6; level++) {
      if (editor.isActive('heading', { level: level as 1 | 2 | 3 | 4 | 5 | 6 })) {
        return `Heading ${level}`;
      }
    }
    return 'Normal text';
  };

  const savedAgo = (() => {
    if (saving) return 'saving…';
    if (!lastSavedAt) return null;
    const diff = Date.now() - lastSavedAt.getTime();
    if (diff < 60_000) return 'just now';
    const mins = Math.floor(diff / 60_000);
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.floor(mins / 60);
    return `${hrs}h ago`;
  })();

  const divider = <div className="w-px h-4 bg-border/60 mx-1" />;

  return (
    <>
      {/* Spacer reserves vertical space so editor content doesn't slide under the fixed bar */}
      <div className="h-14 flex-shrink-0" aria-hidden />
      <div className="fixed top-0 left-0 right-0 lg:left-64 lg:right-64 z-40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-b border-border/40">
        <div className="max-w-3xl mx-auto px-4">
          <div className="flex gap-2 items-center justify-between min-h-[44px] py-1.5">
            {/* Left side: formatting tools — only visible in edit mode */}
            <div className="flex-1 flex items-center gap-1 min-w-0 overflow-x-auto">
        {isEditing && (
          <div className="flex items-center gap-0.5">
            {/* Headings Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="pv-serif h-7 gap-1 px-2 text-[13px] italic text-foreground hover:text-foreground"
                  title="Text Style"
                >
                  <span className="whitespace-nowrap">{getActiveHeadingLabel()}</span>
                  <ChevronDown className="h-3 w-3 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-48">
                <DropdownMenuItem
                  onClick={() => editor.chain().focus().setParagraph().run()}
                  className={!editor.isActive('heading') ? 'bg-muted' : ''}
                >
                  <Type className="mr-2 h-4 w-4" />
                  Normal Text
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
                  className={editor.isActive('heading', { level: 1 }) ? 'bg-muted' : ''}
                >
                  <Heading1 className="mr-2 h-4 w-4" />
                  Heading 1
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
                  className={editor.isActive('heading', { level: 2 }) ? 'bg-muted' : ''}
                >
                  <Heading2 className="mr-2 h-4 w-4" />
                  Heading 2
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
                  className={editor.isActive('heading', { level: 3 }) ? 'bg-muted' : ''}
                >
                  <Heading3 className="mr-2 h-4 w-4" />
                  Heading 3
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => editor.chain().focus().toggleHeading({ level: 4 }).run()}
                  className={editor.isActive('heading', { level: 4 }) ? 'bg-muted' : ''}
                >
                  <Heading className="mr-2 h-4 w-4" />
                  Heading 4
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => editor.chain().focus().toggleHeading({ level: 5 }).run()}
                  className={editor.isActive('heading', { level: 5 }) ? 'bg-muted' : ''}
                >
                  <Heading className="mr-2 h-4 w-4" />
                  Heading 5
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => editor.chain().focus().toggleHeading({ level: 6 }).run()}
                  className={editor.isActive('heading', { level: 6 }) ? 'bg-muted' : ''}
                >
                  <Heading className="mr-2 h-4 w-4" />
                  Heading 6
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {divider}
            {renderTextFormattingButtons()}
            {divider}
            {renderListButtons()}
            {divider}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(iconBtn, isTableActive && iconBtnActive)}
                >
                  <TableIcon className="h-3.5 w-3.5" />
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
                {isMobile && customButtons && (
                  <DropdownMenuItem>{customButtons}</DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            <Button
              variant="ghost"
              size="sm"
              onClick={addLink}
              className={cn(iconBtn, editor.isActive('link') && iconBtnActive)}
            >
              <Link2 className="h-3.5 w-3.5" />
            </Button>

            <div className="relative">
              <Button
                variant="ghost"
                size="sm"
                className={cn(iconBtn, "relative")}
              >
                <input
                  type="file"
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  onChange={handleImageUpload}
                  accept="image/*"
                />
                <ImageIcon className="h-3.5 w-3.5" />
              </Button>
            </div>

            {divider}
            {renderHistoryButtons()}
            {!isMobile && customButtons}
          </div>
        )}
      </div>

      {/* Right side: save status + Read/Edit segmented toggle + meatballs */}
      <div className="flex items-center gap-3 shrink-0">
        {editable && savedAgo && (
          <span className="hidden items-center gap-2 sm:inline-flex">
            <span
              className="h-[7px] w-[7px] rounded-full"
              style={{
                background: saving ? 'hsl(var(--pv-text-faint))' : '#5a8a4a',
                boxShadow: saving ? undefined : '0 0 0 3px rgba(90,138,74,0.18)',
              }}
            />
            <span className="pv-mono text-[10.5px] uppercase tracking-[0.18em] text-[hsl(var(--pv-text-faint))]">
              {saving ? savedAgo : `saved · ${savedAgo}`}
            </span>
          </span>
        )}
        {onToggleEdit && editable && (
          <div
            className="inline-flex items-center rounded-full border border-border p-[3px]"
            style={{ background: 'hsl(var(--pv-surface-2))' }}
          >
            <button
              type="button"
              onClick={() => { if (isEditing) onToggleEdit(); }}
              className={cn(
                "pv-serif h-7 rounded-full px-3.5 text-[13px] transition-colors",
                !isEditing
                  ? "bg-foreground italic text-background"
                  : "text-[hsl(var(--pv-text-muted))] hover:text-foreground"
              )}
            >
              Read
            </button>
            <button
              type="button"
              onClick={() => { if (!isEditing) onToggleEdit(); }}
              className={cn(
                "pv-serif h-7 rounded-full px-3.5 text-[13px] transition-colors",
                isEditing
                  ? "bg-foreground italic text-background"
                  : "text-[hsl(var(--pv-text-muted))] hover:text-foreground"
              )}
            >
              Edit
            </button>
          </div>
        )}

        {editable && (onDeletePage || onPageTypeChange || extraMenuItems) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                title="More options"
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {onPageTypeChange && (
                <>
                  <DropdownMenuItem
                    onClick={() => onPageTypeChange('text')}
                    className={cn("flex items-center gap-2", pageType !== 'section' && "bg-muted")}
                  >
                    <Type className="h-4 w-4" />
                    <span>Text page</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => onPageTypeChange('section')}
                    className={cn("flex items-center gap-2", pageType === 'section' && "bg-muted")}
                  >
                    <Section className="h-4 w-4" />
                    <span>Section (centered)</span>
                  </DropdownMenuItem>
                  {(onDeletePage || extraMenuItems) && <DropdownMenuSeparator />}
                </>
              )}
              {onDeletePage && (
                <DropdownMenuItem
                  onClick={onDeletePage}
                  className="text-destructive focus:text-destructive flex items-center gap-2"
                >
                  <Trash2 className="h-4 w-4" />
                  <span>Delete page</span>
                </DropdownMenuItem>
              )}
              {extraMenuItems && (
                <>
                  {onDeletePage && <DropdownMenuSeparator />}
                  {extraMenuItems}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
};
