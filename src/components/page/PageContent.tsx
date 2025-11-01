import { useState, useCallback, useEffect, useRef } from "react";
import { debounce } from "lodash";
import { TipTapEditor } from "@/components/editor/TipTapEditor";
import { FloatingActions } from "./FloatingActions";
import { useAudioHighlighting } from "@/hooks/use-audio-highlighting";
import { useAdaptiveTextToSpeech } from "@/hooks/use-adaptive-text-to-speech";
import { EditorJSON, PageSaveHandler } from "@/types/editor";
import { usePageDisplaySettings } from "@/contexts/PageDisplaySettingsContext";
import { cn } from "@/lib/utils";


interface PageContentProps {
  jsonContent: EditorJSON | null;  // Primary content source
  title: string;
  onSave: PageSaveHandler;
  saving: boolean;
  pageType?: 'text' | 'section';
  onPageTypeChange?: (newPageType: 'text' | 'section') => void;
  editable?: boolean;
  onEditingChange?: (isEditing: boolean) => void;
  canEdit?: boolean;
  pageId?: string;
  isEditing?: boolean;
  setIsEditing?: (isEditing: boolean) => void;
  onToggleChat?: () => void;
  hasActiveChat?: boolean;
  bookId?: string;
  onDeletePage?: () => void;
}

export const PageContent = ({
  jsonContent,
  title,
  onSave,
  pageType = 'text',
  onPageTypeChange,
  editable = false,
  onEditingChange,
  canEdit = false,
  pageId,
  isEditing = false,
  setIsEditing,
  onToggleChat,
  hasActiveChat,
  bookId,
  onDeletePage,
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
      onSave(json);
    }, 200);

    // Cleanup: cancel any pending debounced calls
    return () => {
      debouncedSaveRef.current?.cancel();
    };
  }, [onSave]);

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

  // Display settings
  const { settings } = usePageDisplaySettings();

  // Generate CSS classes based on settings
  const getFontSizeClass = () => {
    switch (settings.fontSize) {
      case 'small':
        return '[&_.ProseMirror_p]:!text-base [&_.ProseMirror_h1]:!text-3xl [&_.ProseMirror_h2]:!text-2xl [&_.ProseMirror_h3]:!text-xl [&_.ProseMirror_h4]:!text-lg [&_.ProseMirror_h5]:!text-base [&_.ProseMirror_h6]:!text-sm [&_.ProseMirror_li]:!text-base [&_.ProseMirror_code]:!text-sm [&_.ProseMirror_pre]:!text-sm [&_.ProseMirror]:!text-base';
      case 'medium':
        return '[&_.ProseMirror_p]:!text-lg [&_.ProseMirror_h1]:!text-4xl [&_.ProseMirror_h2]:!text-3xl [&_.ProseMirror_h3]:!text-2xl [&_.ProseMirror_h4]:!text-xl [&_.ProseMirror_h5]:!text-lg [&_.ProseMirror_h6]:!text-base [&_.ProseMirror_li]:!text-lg [&_.ProseMirror_code]:!text-base [&_.ProseMirror_pre]:!text-base [&_.ProseMirror]:!text-lg';
      case 'large':
        return '[&_.ProseMirror_p]:!text-xl [&_.ProseMirror_h1]:!text-5xl [&_.ProseMirror_h2]:!text-4xl [&_.ProseMirror_h3]:!text-3xl [&_.ProseMirror_h4]:!text-2xl [&_.ProseMirror_h5]:!text-xl [&_.ProseMirror_h6]:!text-lg [&_.ProseMirror_li]:!text-xl [&_.ProseMirror_code]:!text-lg [&_.ProseMirror_pre]:!text-lg [&_.ProseMirror]:!text-xl';
      case 'xl':
        return '[&_.ProseMirror_p]:!text-2xl [&_.ProseMirror_h1]:!text-6xl [&_.ProseMirror_h2]:!text-5xl [&_.ProseMirror_h3]:!text-4xl [&_.ProseMirror_h4]:!text-3xl [&_.ProseMirror_h5]:!text-2xl [&_.ProseMirror_h6]:!text-xl [&_.ProseMirror_li]:!text-2xl [&_.ProseMirror_code]:!text-xl [&_.ProseMirror_pre]:!text-xl [&_.ProseMirror]:!text-2xl';
      default:
        return '[&_.ProseMirror_p]:!text-lg [&_.ProseMirror_h1]:!text-4xl [&_.ProseMirror_h2]:!text-3xl [&_.ProseMirror_h3]:!text-2xl [&_.ProseMirror_h4]:!text-xl [&_.ProseMirror_h5]:!text-lg [&_.ProseMirror_h6]:!text-base [&_.ProseMirror_li]:!text-lg [&_.ProseMirror_code]:!text-base [&_.ProseMirror_pre]:!text-base [&_.ProseMirror]:!text-lg';
    }
  };

  const getMarginClass = () => {
    switch (settings.marginSize) {
      case 'narrow':
        return 'px-4 py-6';
      case 'normal':
        return 'px-8 py-8';
      case 'wide':
        return 'px-12 py-12';
      default:
        return 'px-8 py-8';
    }
  };

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
            <div className={cn("flex-1 relative", getMarginClass())}>
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
                pageType={pageType}
                onPageTypeChange={onPageTypeChange}
                onDeletePage={onDeletePage}
                fontSizeClassName={getFontSizeClass()}
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
