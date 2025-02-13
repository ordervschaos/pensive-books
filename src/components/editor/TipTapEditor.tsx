import { useEditor, EditorContent } from '@tiptap/react';
import { useEffect } from 'react';
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from '@/hooks/use-mobile';
import { getEditorConfig } from './config/editorConfig';
import { EditorToolbar } from './EditorToolbar';

interface TipTapEditorProps {
  content: string;
  onChange: (html: string, json: any) => void;
  onTitleChange?: (title: string) => void;
  editable?: boolean;
  isEditing?: boolean;
  onToggleEdit?: () => void;
}

export const TipTapEditor = ({ 
  content, 
  onChange, 
  onTitleChange, 
  editable = true, 
  isEditing = true, 
  onToggleEdit 
}: TipTapEditorProps) => {
  const { toast } = useToast();
  const isMobile = useIsMobile();

  const editor = useEditor(getEditorConfig(content, onChange, onTitleChange, editable, isEditing));

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

  if (!editor) {
    return null;
  }

  return (
    <div className="h-full flex flex-col">
      <EditorToolbar 
        editor={editor} 
        isEditing={isEditing} 
        onToggleEdit={onToggleEdit}
        editable={editable}
      />
      <div className={`prose dark:prose-invert prose-slate w-full max-w-none p-8 flex-1 [&_.ProseMirror:focus]:outline-none bg-background ${isMobile ? 'text-base' : 'text-lg'}`}>
        <EditorContent editor={editor} className="
          [&>div>ul]:list-disc [&>div>ul]:ml-4 
          [&>div>ol]:list-decimal 
          [&>div>blockquote]:border-l-4 [&>div>blockquote]:border-primary [&>div>blockquote]:pl-4 [&>div>blockquote]:italic [&>div>blockquote]:my-4 
          [&>div>p>code]:rounded-md [&>div>p>code]:bg-muted [&>div>p>code]:px-[0.3rem] [&>div>p>code]:py-[0.2rem] [&>div>p>code]:font-mono [&>div>p>code]:text-sm
          [&>div>h1]:text-4xl [&>div>h1]:font-bold [&>div>h1]:mb-8 [&>div>h1]:mt-0
          [&>div>h2]:text-3xl [&>div>h2]:font-bold [&>div>h2]:mt-8 [&>div>h2]:mb-4
          [&>div>h3]:text-2xl [&>div>h3]:font-bold [&>div>h3]:mt-6 [&>div>h3]:mb-3
          [&>div>h4]:text-xl [&>div>h4]:font-bold [&>div>h4]:mt-5 [&>div>h4]:mb-2
          [&>div>h5]:text-lg [&>div>h5]:font-bold [&>div>h5]:mt-4 [&>div>h5]:mb-2
          [&>div>h6]:text-base [&>div>h6]:font-bold [&>div>h6]:mt-3 [&>div>h6]:mb-2
        " />
      </div>
    </div>
  );
};
