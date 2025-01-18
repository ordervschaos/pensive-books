import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import { Button } from "@/components/ui/button";
import { Bold, Italic, Quote, Code2, Link2, List, ListOrdered, Image as ImageIcon, History, Check } from "lucide-react";
import { useEffect } from 'react';
import { useToast } from "@/hooks/use-toast";

interface TipTapEditorProps {
  content: string;
  onChange: (html: string, json: any) => void;
  editable?: boolean;
}

export const TipTapEditor = ({ content, onChange, editable = true }: TipTapEditorProps) => {
  const { toast } = useToast();

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        blockquote: {
          HTMLAttributes: {
            class: 'border-l-4 border-primary pl-4 my-4 italic',
          },
        },
        bulletList: {
          HTMLAttributes: {
            class: 'list-disc list-outside ml-4 my-4 space-y-1',
          },
        },
        orderedList: {
          HTMLAttributes: {
            class: 'list-decimal list-outside ml-4 my-4 space-y-1',
          },
        },
        listItem: {
          HTMLAttributes: {
            class: 'pl-1',
          },
        },
        code: {
          HTMLAttributes: {
            class: 'rounded-md bg-muted px-[0.3rem] py-[0.2rem] font-mono text-sm',
          },
        },
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'text-blue-500 dark:text-blue-400 underline',
        },
      }),
      Image.configure({
        HTMLAttributes: {
          class: 'max-w-full h-auto rounded-lg',
        },
      }),
    ],
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

  const addLink = () => {
    const url = window.prompt('Enter URL');
    if (url) {
      editor?.chain().focus().setLink({ href: url }).run();
    }
  };

  const addImage = () => {
    const url = window.prompt('Enter image URL');
    if (url) {
      editor?.chain().focus().setImage({ src: url }).run();
    } else {
      toast({
        title: "Image URL required",
        description: "Please provide a valid image URL",
        variant: "destructive",
      });
    }
  };

  if (!editor) {
    return null;
  }

  return (
    <div className="h-full flex flex-col">
      {editable && (
        <div className="border-b bg-muted/50 p-2 flex gap-1 items-center flex-wrap">
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
            onClick={addLink}
            className={editor.isActive('link') ? 'bg-muted' : ''}
          >
            <Link2 className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={addImage}
          >
            <ImageIcon className="h-4 w-4" />
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
      <div className="prose dark:prose-invert prose-slate max-w-none p-8 flex-1 [&_.ProseMirror:focus]:outline-none bg-background">
        <EditorContent editor={editor} className="[&>div>ul]:list-disc [&>div>ul]:ml-4 [&>div>ol]:list-decimal [&>div>ol]:ml-4 [&>div>blockquote]:border-l-4 [&>div>blockquote]:border-primary [&>div>blockquote]:pl-4 [&>div>blockquote]:italic [&>div>blockquote]:my-4 [&>div>p>code]:rounded-md [&>div>p>code]:bg-muted [&>div>p>code]:px-[0.3rem] [&>div>p>code]:py-[0.2rem] [&>div>p>code]:font-mono [&>div>p>code]:text-sm" />
      </div>
    </div>
  );
};