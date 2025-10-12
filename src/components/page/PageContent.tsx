import { useState, useCallback, useEffect, useRef } from "react";
import { debounce } from "lodash";
import { TextPageContent } from "./TextPageContent";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { EditorJSON, PageSaveHandler } from "@/types/editor";

interface PageContentProps {
  content: string;
  title: string;
  onSave: PageSaveHandler;
  saving: boolean;
  pageType?: 'text' | 'section';
  editable?: boolean;
  onEditingChange?: (isEditing: boolean) => void;
  canEdit?: boolean;
  pageId?: string;
  isEditing?: boolean;
  setIsEditing?: (isEditing: boolean) => void;
  onToggleChat?: () => void;
  hasActiveChat?: boolean;
  jsonContent?: any;
}

export const PageContent = ({
  content,
  title,
  onSave,
  pageType = 'text',
  editable = false,
  onEditingChange,
  canEdit = false,
  pageId,
  isEditing = false,
  setIsEditing,
  onToggleChat,
  hasActiveChat,
  jsonContent,
}: PageContentProps) => {
  const [initialLoad, setInitialLoad] = useState(true);
  const [currentContent, setCurrentContent] = useState(content || '');
  const [currentTitle, setCurrentTitle] = useState(title || '');
  const { toast } = useToast();
  const debouncedSaveRef = useRef<ReturnType<typeof debounce>>();

  useEffect(() => {
    // Only update content if not currently editing to prevent overwriting user input
    if (!isEditing) {
      console.log("PageContent: Content prop changed, updating state");
      setCurrentContent(content || '');
      setCurrentTitle(title || '');
      setInitialLoad(true);
    }
  }, [content, title, isEditing]);

  // Create debounced save function
  useEffect(() => {
    debouncedSaveRef.current = debounce(async (html: string, json: EditorJSON | null) => {
      if (!initialLoad && pageId) {
        try {
          // Get the current user's ID
          const { data: { user } } = await supabase.auth.getUser();
          if (!user?.id) throw new Error('User not authenticated');

          // Upsert the history - will update if entry exists within last minute
          await supabase
            .from('page_history')
            .upsert(
              {
                page_id: parseInt(pageId),
                html_content: html,
                created_by: user.id,
                created_at: new Date().toISOString()
              },
              {
                onConflict: 'page_id,created_at_minute'
              }
            );

          // Then save the new content
          onSave(html, json);
        } catch (error) {
          console.error('Error saving history:', error);
        }
      } else {
        onSave(html, json);
      }
    }, 200);

    // Cleanup: cancel any pending debounced calls
    return () => {
      debouncedSaveRef.current?.cancel();
    };
  }, [onSave, initialLoad, pageId]);

  const handleContentChange = useCallback((html: string, json: EditorJSON | null) => {
    if (!editable) return;
    setCurrentContent(html);
    setInitialLoad(false);
    debouncedSaveRef.current?.(html, json);
  }, [editable]);

  const handleEditingChange = useCallback((editing: boolean) => {
    setIsEditing?.(editing);
    onEditingChange?.(editing);
  }, [setIsEditing, onEditingChange]);

  return (
    <div className="flex-1 flex flex-col bg-background">
      <div className="p-0 flex-1 flex flex-col">
        
          <div className="flex-1 flex items-center justify-center">
            <div className="w-full max-w-3xl">
              <TextPageContent
                content={currentContent}
                isEditing={isEditing && editable}
                onChange={handleContentChange}
                title={currentTitle}
                onToggleEdit={() => handleEditingChange(!isEditing)}
                canEdit={canEdit}
                pageId={pageId}
                onToggleChat={onToggleChat}
                hasActiveChat={hasActiveChat}
                centerContent={pageType === 'section'}
                jsonContent={jsonContent}
              />
            </div>
          </div>
      </div>
    </div>
  );
};
