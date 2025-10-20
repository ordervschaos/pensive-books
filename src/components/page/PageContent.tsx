import { useState, useCallback, useEffect, useRef } from "react";
import { debounce } from "lodash";
import { TipTapEditor } from "@/components/editor/TipTapEditor";
import { PageHistory } from "./PageHistory";
import { FloatingActions } from "./FloatingActions";
import { useAudioHighlighting } from "@/hooks/use-audio-highlighting";
import { useAdaptiveTextToSpeech } from "@/hooks/use-adaptive-text-to-speech";
import { supabase } from "@/integrations/supabase/client";
import { EditorJSON, PageSaveHandler } from "@/types/editor";


interface PageContentProps {
  jsonContent: EditorJSON | null;  // Primary content source
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
  bookId?: string;
}

export const PageContent = ({
  jsonContent,
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
  bookId,
}: PageContentProps) => {
  const [initialLoad, setInitialLoad] = useState(true);
  const [currentContent, setCurrentContent] = useState<EditorJSON | null>(jsonContent);
  const debouncedSaveRef = useRef<ReturnType<typeof debounce>>();
  const currentPageIdRef = useRef<string | undefined>(pageId);

  useEffect(() => {
    // Update content when pageId changes (even in edit mode) or when not editing
    // This ensures content loads properly when navigating between pages
    if (!isEditing || pageId !== currentPageIdRef.current) {
      console.log("PageContent: Content prop changed, updating state");
      // Use JSON content directly
      setCurrentContent(jsonContent);
      setInitialLoad(true);
      currentPageIdRef.current = pageId;
    }
  }, [title, isEditing, jsonContent, pageId]);

  // Create debounced save function
  useEffect(() => {
    debouncedSaveRef.current = debounce(async (json: EditorJSON | null) => {
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
                content: json,  // Store JSON content for history
                created_by: user.id,
                created_at: new Date().toISOString()
              },
              {
                onConflict: 'page_id,created_at_minute'
              }
            );

          // Then save the new content (only pass JSON)
          onSave(json);
        } catch (error) {
          console.error('Error saving history:', error);
        }
      } else {
        onSave(json);
      }
    }, 200);

    // Cleanup: cancel any pending debounced calls
    return () => {
      debouncedSaveRef.current?.cancel();
    };
  }, [onSave, initialLoad, pageId]);

  const handleContentChange = useCallback((json: EditorJSON | null) => {
    if (!editable) return;
    setCurrentContent(json);
    setInitialLoad(false);
    debouncedSaveRef.current?.(json);
  }, [editable]);

  const handleEditingChange = useCallback((editing: boolean) => {
    setIsEditing?.(editing);
    onEditingChange?.(editing);
  }, [setIsEditing, onEditingChange]);

  // Always use the current content - don't maintain separate state for display
  

  // Audio state management
  const audioState = useAdaptiveTextToSpeech({
    pageId: pageId ? parseInt(pageId) : undefined,
    content: currentContent,
  });

  // Apply audio highlighting with click-to-play
  // Only enable click-to-play when NOT editing
  useAudioHighlighting({
    currentBlockIndex: audioState.currentBlockIndex,
    isPlaying: audioState.isPlaying,
    autoScroll: true,
    onBlockClick: isEditing ? undefined : audioState.playBlockByIndex,
  });

  return (
    <div className="flex-1 flex flex-col bg-background">
      <div className="p-0 flex-1 flex flex-col">
        <div className="flex-1 flex justify-center">
          <div className="w-full max-w-3xl">
            <div className={`flex-1 ${!isEditing ? '' : ''} relative`}>
              <TipTapEditor
                key={pageId} // Force remount on page change to ensure fresh content
                content={currentContent}
                onChange={handleContentChange}
                editable={canEdit}
                isEditing={isEditing && editable}
                onToggleEdit={() => handleEditingChange(!isEditing)} // Edit button in toolbar and FloatingActions
                onToggleChat={undefined} // Chat button now handled by FloatingActions
                hasActiveChat={hasActiveChat}
                centerContent={pageType === 'section'}
                customButtons={canEdit && pageId && <PageHistory pageId={parseInt(pageId)} />}
              />

              {/* Floating action buttons */}
              <FloatingActions
                isEditing={isEditing && editable}
                onToggleEdit={() => handleEditingChange(!isEditing)}
                canEdit={canEdit}
                onToggleChat={onToggleChat}
                hasActiveChat={hasActiveChat}
                pageId={pageId}
                audioState={audioState}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
