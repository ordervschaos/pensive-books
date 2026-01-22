import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { debounce } from "lodash";
import { TipTapEditor } from "@/components/editor/TipTapEditor";
import { FloatingActions } from "./FloatingActions";
import { useAudioHighlighting } from "@/hooks/use-audio-highlighting";
import { useAdaptiveTextToSpeech } from "@/hooks/use-adaptive-text-to-speech";
import { EditorJSON, PageSaveHandler } from "@/types/editor";
import { usePageDisplaySettings, FontFamily } from "@/contexts/PageDisplaySettingsContext";
import { cn } from "@/lib/utils";


interface PageContentProps {
  jsonContent: EditorJSON | null;  // Primary content source
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
      // Use JSON content directly
      setCurrentContent(jsonContent);
      setInitialLoad(true);
      currentPageIdRef.current = pageId;
    }
  }, [isEditing, jsonContent, pageId]);

  // Create debounced save function
  useEffect(() => {
    debouncedSaveRef.current = debounce(async (json: EditorJSON | null) => {
      onSave(json);
    }, 200);

    // Cleanup: flush any pending saves immediately before unmounting
    // This ensures content is saved even when navigating away quickly
    return () => {
      debouncedSaveRef.current?.flush();
    };
  }, [onSave]);

  const handleContentChange = useCallback((json: EditorJSON | null) => {
    if (!editable) return;
    setCurrentContent(json);
    setInitialLoad(false);
    debouncedSaveRef.current?.(json);
  }, [editable]);

  // Add beforeunload handler to flush pending saves when closing/refreshing browser
  useEffect(() => {
    const handleBeforeUnload = () => {
      // Flush any pending saves immediately
      debouncedSaveRef.current?.flush();
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

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

  const getFontFamilyStyle = () => {
    const fontMap: Record<FontFamily, string> = {
      default: '',
      // Serif fonts
      merriweather: 'Merriweather, serif',
      lora: 'Lora, serif',
      crimson: '"Crimson Pro", serif',
      'libre-baskerville': '"Libre Baskerville", serif',
      'eb-garamond': '"EB Garamond", serif',
      literata: 'Literata, serif',
      'source-serif': '"Source Serif Pro", serif',
      georgia: 'Georgia, serif',
      // Sans-serif fonts
      inter: 'Inter, sans-serif',
      'open-sans': '"Open Sans", sans-serif',
      'source-sans': '"Source Sans Pro", sans-serif',
      roboto: 'Roboto, sans-serif',
      lato: 'Lato, sans-serif',
      // Slab serif
      'roboto-slab': '"Roboto Slab", serif',
    };
    return fontMap[settings.fontFamily] ? { fontFamily: fontMap[settings.fontFamily] } : {};
  };

  // Removed getFontFamilyClass - using inline styles instead for better compatibility

  const getFontStyleClass = () => {
    if (settings.fontStyle === 'italic') {
      return '[&_.ProseMirror_p]:italic [&_.ProseMirror_h1]:italic [&_.ProseMirror_h2]:italic [&_.ProseMirror_h3]:italic [&_.ProseMirror_h4]:italic [&_.ProseMirror_h5]:italic [&_.ProseMirror_h6]:italic [&_.ProseMirror_li]:italic';
    }
    return '[&_.ProseMirror_p]:not-italic [&_.ProseMirror_h1]:not-italic [&_.ProseMirror_h2]:not-italic [&_.ProseMirror_h3]:not-italic [&_.ProseMirror_h4]:not-italic [&_.ProseMirror_h5]:not-italic [&_.ProseMirror_h6]:not-italic [&_.ProseMirror_li]:not-italic';
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

  // Memoize font settings to prevent unnecessary re-renders
  const fontSizeClassName = useMemo(() => {
    return cn(getFontSizeClass(), getFontStyleClass());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.fontSize, settings.fontStyle]);

  const fontFamilyStyle = useMemo(() => {
    return getFontFamilyStyle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.fontFamily]);

  const marginClass = useMemo(() => {
    return getMarginClass();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.marginSize]);

  return (
    <div className="flex-1 flex flex-col bg-background">
      <div className="p-0 flex-1 flex flex-col">
        <div className="flex-1 flex justify-center">
          <div className="w-full max-w-3xl">
            <div className={cn("flex-1 relative", marginClass)}>
              <TipTapEditor
                content={currentContent}
                onChange={handleContentChange}
                editable={canEdit}
                isEditing={isEditing && editable}
                onToggleEdit={() => handleEditingChange(!isEditing)}
                centerContent={pageType === 'section'}
                pageType={pageType}
                onPageTypeChange={onPageTypeChange}
                onDeletePage={onDeletePage}
                bookId={bookId}
                fontSizeClassName={fontSizeClassName}
                fontFamilyStyle={fontFamilyStyle}
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
