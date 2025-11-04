import { useEditor, EditorContent } from '@tiptap/react';
import { useEffect, useCallback, useMemo } from 'react';
import { useToast } from "@/hooks/use-toast";
import { useSupabaseUpload } from '@/hooks/use-supabase-upload';
import { getEditorConfig } from './config/editorConfig';
import { EditorToolbar } from './EditorToolbar';
import { cn } from "@/lib/utils";
import { EditorChangeHandler, EditorJSON } from '@/types/editor';
import { useNavigate } from 'react-router-dom';
import 'tippy.js/dist/tippy.css';

interface TipTapEditorProps {
  content: string | EditorJSON | null;
  onChange: EditorChangeHandler;
  editable?: boolean;
  isEditing?: boolean;
  onToggleEdit?: () => void;
  editorConfig?: Record<string, unknown>;
  className?: string;
  fontSizeClassName?: string;
  fontFamilyStyle?: React.CSSProperties;
  customButtons?: React.ReactNode;
  onToggleChat?: () => void;
  hasActiveChat?: boolean;
  centerContent?: boolean;
  pageType?: 'text' | 'section';
  onPageTypeChange?: (newPageType: 'text' | 'section') => void;
  onDeletePage?: () => void;
  bookId?: string | null;
}

export const TipTapEditor = ({
  content,
  onChange,
  editable = true,
  isEditing = true,
  onToggleEdit,
  editorConfig,
  className = '',
  fontSizeClassName = '',
  fontFamilyStyle = {},
  customButtons,
  onToggleChat,
  hasActiveChat,
  centerContent,
  pageType,
  onPageTypeChange,
  onDeletePage,
  bookId
}: TipTapEditorProps) => {
  const { toast } = useToast();
  const uploadImage = useSupabaseUpload();
  const navigate = useNavigate();

  // Handle page link clicks
  const handlePageLinkClick = useCallback((pageId: string, linkBookId: string) => {
    navigate(`/book/${linkBookId}/page/${pageId}`);
  }, [navigate]);

  // Memoize the editor config to prevent unnecessary recreations
  // CRITICAL FIX: Only depend on bookId and editable
  // - content: Updated via editor.commands.setContent() in useEffect
  // - onChange/uploadImage/handlePageLinkClick: Callbacks don't need to trigger recreation
  // - isEditing: Updated via editor.setEditable() in useEffect
  const defaultConfig = useMemo(() => {
    return getEditorConfig(
      content,
      onChange,
      editable,
      isEditing,
      uploadImage,
      bookId,
      handlePageLinkClick
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, editable]);

  const config = editorConfig || defaultConfig;

  const editor = useEditor(config);

  // Add useEffect to update editor content when content prop changes
  // BUT only if the editor is not currently being edited (to avoid overwriting user input)
  useEffect(() => {
    if (editor && !isEditing) {
      // Handle both JSON and HTML content
      const currentContent = editor.getJSON();
      const contentChanged = JSON.stringify(content) !== JSON.stringify(currentContent);

      if (contentChanged) {
        editor.commands.setContent(content);
      }
    }
  }, [editor, content, isEditing]);

  // Memoize the copy button click handler
  const handleCopyClick = useCallback((e: Event) => {
    e.preventDefault();
    const code = (e.currentTarget as HTMLElement).getAttribute('data-code');
    if (code) {
      navigator.clipboard.writeText(code);
      toast({
        title: "Copied to clipboard",
        duration: 1000,
      });
    }
  }, [toast]);

  // Apply font-family directly to ProseMirror element
  useEffect(() => {
    if (editor && fontFamilyStyle?.fontFamily) {
      // Wait a bit for font to load, then apply
      const timeoutId = setTimeout(() => {
        const editorElement = editor.view.dom;
        if (editorElement) {
          const element = editorElement as HTMLElement;
          element.style.fontFamily = fontFamilyStyle.fontFamily;
          
          // Also apply to all child elements to ensure it cascades
          const allElements = element.querySelectorAll('*');
          allElements.forEach((el) => {
            (el as HTMLElement).style.fontFamily = fontFamilyStyle.fontFamily;
          });
        }
      }, 100);

      return () => clearTimeout(timeoutId);
    }
  }, [editor, fontFamilyStyle]);

  useEffect(() => {
    if (editor) {
      editor.setEditable(editable && isEditing);
      if (editable && isEditing) {
        editor.commands.focus('start');
      }

      // Add click handlers for copy buttons
      const copyButtons = document.querySelectorAll('.copy-button');
      copyButtons.forEach(button => {
        button.addEventListener('click', handleCopyClick);
      });

      // Cleanup: remove event listeners
      return () => {
        copyButtons.forEach(button => {
          button.removeEventListener('click', handleCopyClick);
        });
      };
    }
  }, [editor, editable, isEditing, handleCopyClick]);

  if (!editor) {
    return null;
  }

  return (
    <div className="h-full flex flex-col min-h-[600px]">
        <EditorToolbar 
          editor={editor} 
          isEditing={isEditing} 
          onToggleEdit={onToggleEdit}
          editable={editable}
          customButtons={customButtons}
          onToggleChat={onToggleChat}
          hasActiveChat={hasActiveChat}
          pageType={pageType}
          onPageTypeChange={onPageTypeChange}
          onDeletePage={onDeletePage}
        />
      <div 
        className={cn(
          `${centerContent ? 'flex items-center justify-center text-center' : ''} prose dark:prose-invert prose-slate w-full max-w-none p-8 flex-1 [&_.ProseMirror:focus]:outline-none bg-background`,
          className,
          `[&_img]:mx-auto [&_img]:block [&_p]:leading-relaxed [&_p]:mb-6 [&_table]:border-collapse [&_table]:w-full [&_th]:border [&_th]:border-muted [&_th]:p-2 [&_td]:border [&_td]:border-muted [&_td]:p-2 [&_.selectedCell]:bg-muted/30`,
          fontSizeClassName // Apply font size classes last to override prose defaults
        )}
        style={fontFamilyStyle && Object.keys(fontFamilyStyle).length > 0 ? fontFamilyStyle : undefined}
        onClick={() => {
          // When clicking anywhere in the editor container, focus the editor
          if (editable && isEditing && editor) {
            editor.commands.focus();
          }
        }}
      >
        <EditorContent editor={editor} className={cn(
          centerContent && "w-full min-h-full cursor-text",
          `[&>div>h1]:font-bold [&>div>h1]:mb-8 [&>div>h1]:mt-0
          [&>div>h2]:font-bold [&>div>h2]:mb-6 [&>div>h2]:mt-8
          [&>div>h3]:font-bold [&>div>h3]:mb-4 [&>div>h3]:mt-6
          [&>div>h4]:font-bold [&>div>h4]:mb-4 [&>div>h4]:mt-6
          [&>div>h5]:font-bold [&>div>h5]:mb-4 [&>div>h5]:mt-6
          [&>div>h6]:font-bold [&>div>h6]:mb-4 [&>div>h6]:mt-6
          [&>div>h1,h2,h3,h4,h5,h6]:tracking-tight [&>div>h1,h2,h3,h4,h5,h6]:text-foreground
          [&_.ProseMirror]:min-h-full [&_.ProseMirror]:cursor-text`
        )} />
      </div>
    </div>
  );
};
