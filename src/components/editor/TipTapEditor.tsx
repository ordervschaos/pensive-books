import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Button } from "@/components/ui/button";
import { Bold, Italic, Quote, Code2, Link2, List, ListOrdered, Image, History, Check } from "lucide-react";
import { useEffect } from 'react';

interface TipTapEditorProps {
  content: string;
  onChange: (html: string, json: any) => void;
  editable?: boolean;
}

export const TipTapEditor = ({ content, onChange, editable = true }: TipTapEditorProps) => {
  const editor = useEditor({
    extensions: [StarterKit],
    content,
    editable,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML(), editor.getJSON());
    },
    autofocus: 'start',
  });

  useEffect(() => {
    if (editor) {
      editor.setEditable(editable);
      if (editable) {
        editor.commands.focus('start');
      }
    }
  }, [editor, editable]);

  if (!editor) {
    return null;
  }

  return (
    <div className="h-full flex flex-col">
      {editable && (
        <div className="border-b bg-slate-50/80 p-2 flex gap-1 items-center flex-wrap">
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
            onClick={() => editor.chain().focus().toggleCode().run()}
            className={editor.isActive('code') ? 'bg-muted' : ''}
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
            disabled
          >
            <Link2 className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled
          >
            <Image className="h-4 w-4" />
          </Button>
          <div className="ml-auto flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => editor.chain().focus().undo().run()}
              disabled={!editor.can().undo()}
            >
              <History className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => editor.chain().focus().redo().run()}
              disabled={!editor.can().redo()}
            >
              <Check className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
      <div className="prose prose-slate max-w-none p-8 flex-1 [&_.ProseMirror:focus]:outline-none">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
};