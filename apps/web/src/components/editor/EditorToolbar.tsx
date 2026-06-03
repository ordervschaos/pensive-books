import { Editor } from '@tiptap/react';
import { useEffect, useRef, useState } from 'react';
import { Undo, Redo, Table as TableIcon, Image as ImageIcon, Heading1, Heading2, Heading3, Type, List, ListOrdered, Quote, Code2, Minus, Section, MoreHorizontal, Trash2, ChevronDown } from "lucide-react";
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
   * appended below the built-in undo/redo + page-type / delete-page items. Used by the
   * page view to fold Page Settings + Sign in/out into the same menu on
   * mobile so the editor toolbar doesn't compete with a separate floating
   * kebab in the top-right.
   */
  extraMenuItems?: React.ReactNode;
}

export const EditorToolbar = ({ editor, isEditing, onToggleEdit, editable, customButtons, pageType, onPageTypeChange, onDeletePage, extraMenuItems }: EditorToolbarProps) => {
  const { toast } = useToast();
  const uploadImage = useSupabaseUpload();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Track editor selection to force re-renders when the active block type changes
  const [, setSelectionUpdate] = useState(0);

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

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = ''; // allow re-selecting the same file later
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

  const addTable = () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
  const addTableRow = () => editor.chain().focus().addRowAfter().run();
  const addTableColumn = () => editor.chain().focus().addColumnAfter().run();
  const deleteTableRow = () => editor.chain().focus().deleteRow().run();
  const deleteTableColumn = () => editor.chain().focus().deleteColumn().run();
  const deleteTable = () => editor.chain().focus().deleteTable().run();
  const toggleTableHeader = () => editor.chain().focus().toggleHeaderRow().run();
  const isTableActive = editor.isActive('table');

  const iconBtn = "h-7 w-7 p-0 text-muted-foreground hover:text-foreground";
  const chip = "pv-serif h-7 gap-1 px-2 text-[13px] italic text-foreground hover:text-foreground";

  // Converting to a non-list block type (heading/paragraph/quote/code) is a no-op while the
  // selection is still inside a list item, so lift it out of the list first, then apply.
  const convertBlock = (
    apply: (chain: ReturnType<Editor['chain']>) => ReturnType<Editor['chain']>
  ) => {
    let chain = editor.chain().focus();
    if (editor.isActive('bulletList') || editor.isActive('orderedList')) {
      chain = chain.liftListItem('listItem');
    }
    apply(chain).run();
  };

  // Label for the block-type chip — reflects the block at the cursor.
  const getActiveBlockLabel = () => {
    if (editor.isActive('heading', { level: 1 })) return 'Heading 1';
    if (editor.isActive('heading', { level: 2 })) return 'Heading 2';
    if (editor.isActive('heading', { level: 3 })) return 'Heading 3';
    if (editor.isActive('heading')) return 'Heading';
    if (editor.isActive('bulletList')) return 'Bulleted list';
    if (editor.isActive('orderedList')) return 'Numbered list';
    if (editor.isActive('blockquote')) return 'Quote';
    if (editor.isActive('codeBlock')) return 'Code block';
    return 'Paragraph';
  };

  const activeItem = (active: boolean) => (active ? 'bg-muted' : '');

  return (
    <>
      {/* Spacer reserves vertical space so editor content doesn't slide under the fixed bar */}
      <div className="h-14 flex-shrink-0" aria-hidden />
      <div className="fixed top-0 left-0 right-0 lg:left-64 lg:right-64 z-40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-b border-border/40">
        <div className="max-w-3xl mx-auto px-4">
          <div className="flex gap-2 items-center justify-between min-h-[44px] py-1.5">
            {/* Left side: block-type + insert chips — only in edit mode */}
            <div className="flex-1 flex items-center gap-1 min-w-0 overflow-x-auto">
              {isEditing && (
                <div className="flex items-center gap-0.5">
                  {/* Block-type chip */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className={chip} title="Block type">
                        <span className="whitespace-nowrap">{getActiveBlockLabel()}</span>
                        <ChevronDown className="h-3 w-3 opacity-60" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-52">
                      <DropdownMenuItem
                        onClick={() => convertBlock((c) => c.toggleHeading({ level: 1 }))}
                        className={activeItem(editor.isActive('heading', { level: 1 }))}
                      >
                        <Heading1 className="mr-2 h-4 w-4" /> Heading 1
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => convertBlock((c) => c.toggleHeading({ level: 2 }))}
                        className={activeItem(editor.isActive('heading', { level: 2 }))}
                      >
                        <Heading2 className="mr-2 h-4 w-4" /> Heading 2
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => convertBlock((c) => c.toggleHeading({ level: 3 }))}
                        className={activeItem(editor.isActive('heading', { level: 3 }))}
                      >
                        <Heading3 className="mr-2 h-4 w-4" /> Heading 3
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => convertBlock((c) => c.setParagraph())}
                        className={activeItem(editor.isActive('paragraph') && !editor.isActive('bulletList') && !editor.isActive('orderedList'))}
                      >
                        <Type className="mr-2 h-4 w-4" /> Paragraph
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => editor.chain().focus().toggleBulletList().run()}
                        className={activeItem(editor.isActive('bulletList'))}
                      >
                        <List className="mr-2 h-4 w-4" /> Bulleted list
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => editor.chain().focus().toggleOrderedList().run()}
                        className={activeItem(editor.isActive('orderedList'))}
                      >
                        <ListOrdered className="mr-2 h-4 w-4" /> Numbered list
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => convertBlock((c) => c.toggleBlockquote())}
                        className={activeItem(editor.isActive('blockquote'))}
                      >
                        <Quote className="mr-2 h-4 w-4" /> Quote
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => convertBlock((c) => c.toggleCodeBlock())}
                        className={activeItem(editor.isActive('codeBlock'))}
                      >
                        <Code2 className="mr-2 h-4 w-4" /> Code block
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  {/* Insert chip */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className={chip} title="Insert">
                        <span>Insert</span>
                        <ChevronDown className="h-3 w-3 opacity-60" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuItem onClick={addTable} disabled={isTableActive}>
                        <TableIcon className="mr-2 h-4 w-4" /> Table
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
                        <ImageIcon className="mr-2 h-4 w-4" /> Image
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => editor.chain().focus().setHorizontalRule().run()}>
                        <Minus className="mr-2 h-4 w-4" /> Divider
                      </DropdownMenuItem>
                      {isTableActive && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={addTableRow}>Add row</DropdownMenuItem>
                          <DropdownMenuItem onClick={addTableColumn}>Add column</DropdownMenuItem>
                          <DropdownMenuItem onClick={deleteTableRow}>Delete row</DropdownMenuItem>
                          <DropdownMenuItem onClick={deleteTableColumn}>Delete column</DropdownMenuItem>
                          <DropdownMenuItem onClick={toggleTableHeader}>Toggle header row</DropdownMenuItem>
                          <DropdownMenuItem onClick={deleteTable}>Delete table</DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>

                  {customButtons}
                </div>
              )}
            </div>

            {/* Right side: Read/Edit segmented toggle + meatballs (undo/redo + page actions) */}
            <div className="flex items-center gap-3 shrink-0">
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

              {editable && (isEditing || onDeletePage || onPageTypeChange || extraMenuItems) && (
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
                    {isEditing && (
                      <>
                        <DropdownMenuItem
                          onClick={() => editor.chain().focus().undo().run()}
                          disabled={!editor.can().undo()}
                          className="flex items-center gap-2"
                        >
                          <Undo className="h-4 w-4" />
                          <span>Undo</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => editor.chain().focus().redo().run()}
                          disabled={!editor.can().redo()}
                          className="flex items-center gap-2"
                        >
                          <Redo className="h-4 w-4" />
                          <span>Redo</span>
                        </DropdownMenuItem>
                        {(onPageTypeChange || onDeletePage || extraMenuItems) && <DropdownMenuSeparator />}
                      </>
                    )}
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

      {/* Hidden input backing the Insert ▸ Image action */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleImageUpload}
      />
    </>
  );
};
