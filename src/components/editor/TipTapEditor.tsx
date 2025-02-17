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
  editorConfig?: Record<string, unknown>;
  hideToolbar?: boolean;
  className?: string;
}

export const TipTapEditor = ({ 
  content, 
  onChange, 
  onTitleChange, 
  editable = true, 
  isEditing = true, 
  onToggleEdit,
  editorConfig,
  hideToolbar = false,
  className = ''
}: TipTapEditorProps) => {
  const { toast } = useToast();
  const isMobile = useIsMobile();

  const defaultConfig = getEditorConfig(content, onChange, editable, isEditing);
  const config = editorConfig || defaultConfig;

  const editor = useEditor(config);

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
      {!hideToolbar && (
        <EditorToolbar 
          editor={editor} 
          isEditing={isEditing} 
          onToggleEdit={onToggleEdit}
          editable={editable}
        />
      )}
      <div className={`prose dark:prose-invert prose-slate w-full max-w-none p-8 flex-1 [&_.ProseMirror:focus]:outline-none bg-background ${isMobile ? 'text-xl' : 'text-2xl'} ${className} [&_img]:mx-auto [&_img]:block [&_p]:text-xl [&_p]:md:text-2xl [&_p]:leading-relaxed [&_p]:mb-6`}>
        <EditorContent editor={editor} className="
          [&>div>h1]:text-4xl [&>div>h1]:font-bold [&>div>h1]:mb-8 [&>div>h1]:mt-0
          [&>div>h2]:text-3xl [&>div>h2]:font-bold [&>div>h2]:mb-6 [&>div>h2]:mt-8
          [&>div>h3]:text-2xl [&>div>h3]:font-bold [&>div>h3]:mb-4 [&>div>h3]:mt-6
          [&>div>h4]:text-xl [&>div>h4]:font-bold [&>div>h4]:mb-4 [&>div>h4]:mt-6
          [&>div>h5]:text-lg [&>div>h5]:font-bold [&>div>h5]:mb-4 [&>div>h5]:mt-6
          [&>div>h6]:text-base [&>div>h6]:font-bold [&>div>h6]:mb-4 [&>div>h6]:mt-6
          [&>div>h1,h2,h3,h4,h5,h6]:tracking-tight [&>div>h1,h2,h3,h4,h5,h6]:text-foreground
        " />
      </div>
    </div>
  );
};
