import { useEditor, EditorContent, Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useCallback, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Bold, Italic, List, ListOrdered, Edit2 } from "lucide-react";
import Title from '@tiptap/extension-heading';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import Heading from '@tiptap/extension-heading';
import BulletList from '@tiptap/extension-bullet-list';
import OrderedList from '@tiptap/extension-ordered-list';
import ListItem from '@tiptap/extension-list-item';
import HardBreak from '@tiptap/extension-hard-break';

interface TipTapEditorProps {
  content: string;
  onChange: (html: string, json: any) => void;
  onTitleChange: (title: string) => void;
  editable?: boolean;
  isEditing?: boolean;
  onToggleEdit?: () => void;
}

const CustomDocument = Document.extend({
  content: 'title block+',
});

const Title = Heading.extend({
  name: 'title',
  group: 'title',
  content: 'inline*',
  defining: true,
  parseHTML() {
    return [{ tag: 'h1.page-title' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['h1', { class: 'page-title', ...HTMLAttributes }, 0];
  },
});

export const TipTapEditor = ({ content, onChange, onTitleChange, editable = true, isEditing = true, onToggleEdit }: TipTapEditorProps) => {
  const editor = useEditor({
    extensions: [
      CustomDocument,
      Title,
      Paragraph,
      Text,
      BulletList,
      OrderedList,
      ListItem,
      HardBreak,
      StarterKit.configure({
        document: false,
        heading: false,
      }),
    ],
    editorProps: {
      handleKeyDown: (view, event) => {
        if (editor?.isActive('title')) {
          if (event.key === 'b' && (event.ctrlKey || event.metaKey)) return true;
          if (event.key === 'i' && (event.ctrlKey || event.metaKey)) return true;
          if (event.key === 'Enter') {
            editor?.chain().focus().setHardBreak().run();
            return true;
          }
        }
        return false;
      },
    },
    content,
    editable: isEditing && editable,
    onUpdate: ({ editor }) => {
      const title = editor.getHTML().match(/<h1 class="page-title">(.*?)<\/h1>/)?.[1] || '';
      onTitleChange(title);
      onChange(editor.getHTML(), editor.getJSON());
    },
  });

  useEffect(() => {
    if (editor && content && editor.getHTML() !== content) {
      editor.commands.setContent(content);
    }
  }, [content, editor]);

  const toggleBold = useCallback(() => {
    if (!editor?.isActive('title')) {
      editor?.chain().focus().toggleBold().run();
    }
  }, [editor]);

  const toggleItalic = useCallback(() => {
    if (!editor?.isActive('title')) {
      editor?.chain().focus().toggleItalic().run();
    }
  }, [editor]);

  const toggleBulletList = useCallback(() => {
    if (!editor?.isActive('title')) {
      editor?.chain().focus().toggleBulletList().run();
    }
  }, [editor]);

  const toggleOrderedList = useCallback(() => {
    if (!editor?.isActive('title')) {
      editor?.chain().focus().toggleOrderedList().run();
    }
  }, [editor]);

  if (!editor) {
    return null;
  }

  return (
    <div className="flex-1 flex flex-col">
      {editable && (
        <div className="border-b sticky top-0 bg-background z-10">
          <div className="container max-w-4xl mx-auto px-4">
            <div className="flex items-center justify-between py-2">
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={toggleBold}
                  className={editor.isActive('bold') ? 'bg-accent' : ''}
                  disabled={!isEditing || editor.isActive('title')}
                >
                  <Bold className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={toggleItalic}
                  className={editor.isActive('italic') ? 'bg-accent' : ''}
                  disabled={!isEditing || editor.isActive('title')}
                >
                  <Italic className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={toggleBulletList}
                  className={editor.isActive('bulletList') ? 'bg-accent' : ''}
                  disabled={!isEditing || editor.isActive('title')}
                >
                  <List className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={toggleOrderedList}
                  className={editor.isActive('orderedList') ? 'bg-accent' : ''}
                  disabled={!isEditing || editor.isActive('title')}
                >
                  <ListOrdered className="h-4 w-4" />
                </Button>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={onToggleEdit}
              >
                <Edit2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      )}
      <div className={`container max-w-4xl mx-auto px-4 py-8 flex-1 ${!isEditing ? 'prose dark:prose-invert max-w-none' : ''}`}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
};