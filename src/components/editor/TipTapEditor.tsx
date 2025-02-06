
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { common, createLowlight } from 'lowlight';
import { Button } from "@/components/ui/button";
import { Bold, Italic, Quote, Code2, Link2, List, ListOrdered, Image as ImageIcon, History, Check, Undo, Redo, Pencil, Eye, Copy } from "lucide-react";
import { useEffect } from 'react';
import { useToast } from "@/hooks/use-toast";
import { Title } from './extensions/Title';
import { useIsMobile } from '@/hooks/use-mobile';

// Create a new lowlight instance with common languages
const lowlight = createLowlight(common)

interface TipTapEditorProps {
  content: string;
  onChange: (html: string, json: any) => void;
  onTitleChange?: (title: string) => void;
  editable?: boolean;
  isEditing?: boolean;
  onToggleEdit?: () => void;
}

export const TipTapEditor = ({ content, onChange, onTitleChange, editable = true, isEditing = true, onToggleEdit }: TipTapEditorProps) => {
  const { toast } = useToast();
  const isMobile = useIsMobile();

  const editor = useEditor({
    extensions: [
      Title,
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
        codeBlock: false,
        heading: {
          levels: [2, 3, 4, 5, 6],
        },
      }),
      CodeBlockLowlight.configure({
        lowlight,
        HTMLAttributes: {
          class: 'relative rounded-md bg-muted/50 my-4',
        },
        addKeyboardShortcuts: () => ({}),
        addAttributes() {
          return {
            ...this.parent?.(),
            class: {
              default: null,
              parseHTML: element => element.getAttribute('class'),
            },
          }
        },
        renderHTML({ node, HTMLAttributes }) {
          const languageClass = node.attrs.language ? ` language-${node.attrs.language}` : ''
          const codeBlockId = `code-block-${Math.random().toString(36).substr(2, 9)}`
          
          // Create wrapper div for the entire code block
          const wrapper = document.createElement('div')
          wrapper.className = `relative rounded-md bg-muted/50 my-4 group ${HTMLAttributes.class || ''}`
          
          // Create header with language indicator and copy button
          const header = document.createElement('div')
          header.className = 'flex items-center justify-between px-4 py-2 border-b border-muted'
          
          // Add language indicator
          const languageIndicator = document.createElement('span')
          languageIndicator.className = 'text-sm text-muted-foreground'
          languageIndicator.textContent = node.attrs.language || 'plain text'
          header.appendChild(languageIndicator)
          
          // Add copy button
          const copyButton = document.createElement('button')
          copyButton.className = 'copy-button opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground'
          copyButton.setAttribute('data-code', node.textContent)
          copyButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>'
          header.appendChild(copyButton)
          
          // Add header to wrapper
          wrapper.appendChild(header)
          
          // Create pre element with proper styling
          const pre = document.createElement('pre')
          pre.className = 'overflow-x-auto p-4 text-sm'
          
          // Create code element with syntax highlighting classes
          const code = document.createElement('code')
          code.className = `hljs${languageClass}`
          code.id = codeBlockId
          
          // Assemble the elements
          pre.appendChild(code)
          wrapper.appendChild(pre)
          
          return wrapper
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
    editable: editable && isEditing,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML(), editor.getJSON());

      if (onTitleChange) {
        const titleNode = editor.getJSON().content.find((node: any) => node.type === 'title');
        const title = titleNode?.content?.[0]?.text || '';
        onTitleChange(title);
      }
    },
    editorProps: {
      handleKeyDown: (view, event) => {
        if (editor?.isActive('title')) {
          if (event.key === 'b' && (event.ctrlKey || event.metaKey)) return true;
          if (event.key === 'i' && (event.ctrlKey || event.metaKey)) return true;
        }
      },
    },
    autofocus: 'start',
  });

  useEffect(() => {
    if (editor) {
      editor.setEditable(editable && isEditing);
      if (editable && isEditing) {
        editor.commands.focus('start');
      }

      // Add click handlers for copy buttons
      const copyButtons = document.querySelectorAll('.copy-button');
      copyButtons.forEach(button => {
        button.addEventListener('click', (e) => {
          e.preventDefault();
          const code = (e.currentTarget as HTMLElement).getAttribute('data-code');
          if (code) {
            navigator.clipboard.writeText(code);
            toast({
              title: "Copied to clipboard",
              duration: 1000,
            });
          }
        });
      });
    }
  }, [editor, editable, isEditing]);

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
        <div className={`rounded-md flex gap-1 items-center p-1 flex-wrap z-50 ${isEditing ? 'sticky top-4 bg-muted/50 shadow-sm backdrop-blur-sm' : ''}`}>
          {isEditing && (
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
              </div>
            </>
          )}

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
        </div>
      )}
      <div className={`prose dark:prose-invert prose-slate w-full max-w-none p-8 flex-1 [&_.ProseMirror:focus]:outline-none bg-background ${isMobile ? 'text-base' : 'text-lg'}`}>
        <EditorContent editor={editor} className="[&>div>ul]:list-disc [&>div>ul]:ml-4 [&>div>ol]:list-decimal [[&>div>blockquote]:border-l-4 [&>div>blockquote]:border-primary [&>div>blockquote]:pl-4 [&>div>blockquote]:italic [&>div>blockquote]:my-4 [&>div>p>code]:rounded-md [&>div>p>code]:bg-muted [&>div>p>code]:px-[0.3rem] [&>div>p>code]:py-[0.2rem] [&>div>p>code]:font-mono [&>div>p>code]:text-sm" />
      </div>
    </div>
  );
};
