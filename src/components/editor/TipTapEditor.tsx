import { useEditor, EditorContent } from '@tiptap/react';
import { useEffect } from 'react';
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from '@/hooks/use-mobile';
import { getEditorConfig } from './config/editorConfig';
import { EditorToolbar } from './EditorToolbar';

interface TipTapEditorProps {
  content: string;
  onChange: (html: string, json: any) => void;
  editable?: boolean;
  isEditing?: boolean;
  onToggleEdit?: () => void;
  editorConfig?: any;
  hideToolbar?: boolean;
  className?: string;
  customButtons?: React.ReactNode;
}

export const TipTapEditor = ({ 
  content,
  onChange,
  editable = true,
  isEditing = true,
  onToggleEdit,
  editorConfig,
  hideToolbar = false,
  className,
  customButtons
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
    <div className={cn("flex flex-col w-full", className)}>
      {!hideToolbar && (
        <EditorToolbar 
          editor={editor} 
          isEditing={isEditing} 
          onToggleEdit={onToggleEdit}
          editable={editable}
          customButtons={customButtons}
        />
      )}
      <EditorContent editor={editor} className="flex-1 px-4 py-2" />
    </div>
  );
};
