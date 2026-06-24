import { Editor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { useEffect, useState } from 'react';
import { Bold, Italic, Underline, Strikethrough, Code, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface SelectionBubbleProps {
  editor: Editor;
}

/**
 * Selection-level formatting menu (the "selection bubble" from the editor redesign).
 * Floats above highlighted text with bold / italic / underline / strike / inline-code / link.
 * Block-level types live in the toolbar's block-type chip; this only handles inline marks.
 */
export const SelectionBubble = ({ editor }: SelectionBubbleProps) => {
  // Re-render so the buttons reflect the marks active at the current selection.
  const [, force] = useState(0);
  useEffect(() => {
    const bump = () => force((n) => n + 1);
    editor.on('selectionUpdate', bump);
    editor.on('transaction', bump);
    return () => {
      editor.off('selectionUpdate', bump);
      editor.off('transaction', bump);
    };
  }, [editor]);

  // Collapse selection when clicking outside the editor or bubble — TipTap doesn't
  // fire a selectionUpdate for clicks on empty whitespace, so shouldShow stays true.
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Element;
      if (
        !editor.view.dom.contains(target) &&
        !target.closest?.('[data-selection-bubble]')
      ) {
        editor.commands.setTextSelection(editor.state.selection.anchor);
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [editor]);

  const toggleLink = () => {
    if (editor.isActive('link')) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    const url = window.prompt('Enter URL');
    if (url) {
      editor.chain().focus().setLink({ href: url }).run();
    }
  };

  const btn = 'h-7 w-7 p-0 text-muted-foreground hover:text-foreground';
  const btnActive = 'bg-muted text-foreground';

  return (
    <BubbleMenu
      editor={editor}
      options={{ placement: 'top', offset: 8 }}
      shouldShow={({ editor, state, from, to }) => {
        if (!editor.isEditable) return false;
        if (from === to) return false; // collapsed cursor, no selection
        if (editor.isActive('codeBlock')) return false; // inline marks don't apply
        return state.doc.textBetween(from, to, ' ').trim().length > 0;
      }}
      // Keep the editor selection when pressing a button (otherwise mousedown blurs it).
      onMouseDown={(e) => e.preventDefault()}
      data-selection-bubble
      className="flex items-center gap-0.5 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
    >
      <Button
        variant="ghost"
        size="sm"
        onClick={() => editor.chain().focus().toggleBold().run()}
        className={cn(btn, editor.isActive('bold') && btnActive)}
        title="Bold (⌘B)"
      >
        <Bold className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => editor.chain().focus().toggleItalic().run()}
        className={cn(btn, editor.isActive('italic') && btnActive)}
        title="Italic (⌘I)"
      >
        <Italic className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        className={cn(btn, editor.isActive('underline') && btnActive)}
        title="Underline (⌘U)"
      >
        <Underline className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => editor.chain().focus().toggleStrike().run()}
        className={cn(btn, editor.isActive('strike') && btnActive)}
        title="Strikethrough"
      >
        <Strikethrough className="h-3.5 w-3.5" />
      </Button>
      <div className="mx-0.5 h-4 w-px bg-border/60" />
      <Button
        variant="ghost"
        size="sm"
        onClick={() => editor.chain().focus().toggleCode().run()}
        className={cn(btn, editor.isActive('code') && btnActive)}
        title="Inline code"
      >
        <Code className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={toggleLink}
        className={cn(btn, editor.isActive('link') && btnActive)}
        title="Link (⌘K)"
      >
        <Link2 className="h-3.5 w-3.5" />
      </Button>
    </BubbleMenu>
  );
};
