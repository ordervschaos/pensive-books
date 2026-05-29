import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { debounce } from "lodash";
import type { Editor } from "@tiptap/react";
import { Sparkles, Loader2 } from "lucide-react";
import { TipTapEditor } from "@/components/editor/TipTapEditor";
import { useToast } from "@/hooks/use-toast";
import { FloatingActions } from "./FloatingActions";
import { useAudioHighlighting } from "@/hooks/use-audio-highlighting";
import { useAdaptiveTextToSpeech } from "@/hooks/use-adaptive-text-to-speech";
import { EditorJSON, PageSaveHandler } from "@/types/editor";
import { usePageDisplaySettings, FontFamily } from "@/contexts/PageDisplaySettingsContext";
import { cn } from "@/lib/utils";
import { proseToParagraphs } from "@/lib/inlineMarkdown";
import { supabase } from "@/integrations/supabase/client";

const BRIDGE = import.meta.env.VITE_EVAL_BRIDGE_URL as string | undefined;


interface PageContentProps {
  jsonContent: EditorJSON | null;  // Primary content source
  onSave: PageSaveHandler;
  saving: boolean;
  pageType?: 'text' | 'section';
  onPageTypeChange?: (newPageType: 'text' | 'section') => void;
  editable?: boolean;
  onEditingChange?: (isEditing: boolean) => void;
  canEdit?: boolean;
  /** Author-only page objective (pages.metadata.objective) + setter. Shown only to editors. */
  objective?: string | null;
  onObjectiveChange?: (next: string | null) => void;
  /** Book-level master switch; objective UI only shows when true. */
  objectivesEnabled?: boolean;
  pageId?: string;
  isEditing?: boolean;
  setIsEditing?: (isEditing: boolean) => void;
  onToggleChat?: () => void;
  hasActiveChat?: boolean;
  bookId?: string;
  onDeletePage?: () => void;
  lastSavedAt?: Date | null;
  /** Page position in the book (1-based) — used for the "page X of Y" eyebrow. */
  currentIndex?: number;
  totalPages?: number;
  /** Name of the nearest preceding section, surfaced in the eyebrow as "Chapter". */
  sectionLabel?: string | null;
  /** Items appended to the editor toolbar's meatball menu. */
  extraMenuItems?: React.ReactNode;
}

export const PageContent = ({
  jsonContent,
  onSave,
  saving,
  pageType = 'text',
  onPageTypeChange,
  editable = false,
  onEditingChange,
  canEdit = false,
  objective,
  onObjectiveChange,
  objectivesEnabled = false,
  pageId,
  isEditing = false,
  setIsEditing,
  onToggleChat,
  hasActiveChat,
  bookId,
  onDeletePage,
  lastSavedAt,
  currentIndex,
  totalPages,
  sectionLabel,
  extraMenuItems,
}: PageContentProps) => {
  const { toast } = useToast();
  const [initialLoad, setInitialLoad] = useState(true);
  const [currentContent, setCurrentContent] = useState<EditorJSON | null>(jsonContent);
  const debouncedSaveRef = useRef<ReturnType<typeof debounce>>();
  const currentPageIdRef = useRef<string | undefined>(pageId);
  const editorRef = useRef<Editor | null>(null);
  const [generatingPage, setGeneratingPage] = useState(false);
  const handleEditorReady = useCallback((e: Editor | null) => { editorRef.current = e; }, []);
  // Local draft for the page objective bar; resynced when the page or its objective changes.
  const [objectiveDraft, setObjectiveDraft] = useState(objective ?? '');
  useEffect(() => {
    setObjectiveDraft(objective ?? '');
  }, [objective, pageId]);

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

  // Render prose from a block's objective via the generate-unit edge function (or local bridge).
  // Paragraph-level for now; the page objective is passed as parent context.
  const handleGenerate = useCallback(async (objective: string): Promise<string> => {
    if (!bookId || !pageId) throw new Error("Missing book or page id");
    const unitBody = {
      bookId: Number(bookId),
      pageId: Number(pageId),
      level: "paragraph",
      objective,
      pageObjective: objectiveDraft.trim() || undefined,
    };
    if (BRIDGE) {
      const r = await fetch(`${BRIDGE}/unit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(unitBody),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      if (!d.text) throw new Error("No text returned");
      return d.text as string;
    }
    const { data, error } = await supabase.functions.invoke("generate-unit", { body: unitBody });
    if (error) throw error;
    if (!data?.text) throw new Error(data?.error || "No text returned");
    return data.text as string;
  }, [bookId, pageId, objectiveDraft]);

  // Generate the whole page's prose from the page objective and append it as paragraphs.
  const handleGeneratePage = useCallback(async () => {
    const objective = objectiveDraft.trim();
    const editor = editorRef.current;
    if (!objective || !editor || !bookId || !pageId || generatingPage) return;
    try {
      setGeneratingPage(true);
      const unitBody = { bookId: Number(bookId), pageId: Number(pageId), level: "page", objective };
      let text: string;
      if (BRIDGE) {
        const r = await fetch(`${BRIDGE}/unit`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(unitBody),
        });
        const d = await r.json();
        if (d.error) throw new Error(d.error);
        text = String(d.text ?? "").trim();
      } else {
        const { data, error } = await supabase.functions.invoke("generate-unit", { body: unitBody });
        if (error) throw error;
        text = String(data?.text ?? "").trim();
      }
      if (!text) throw new Error("No text returned");
      // Paragraph nodes with inline marks (so *italic* / **bold** render, not literal *).
      const paras = proseToParagraphs(text);
      if (paras.length) editor.chain().focus("end").insertContent(paras).run();
    } catch (e) {
      toast({ title: "Couldn't generate page", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally {
      setGeneratingPage(false);
    }
  }, [objectiveDraft, bookId, pageId, generatingPage, toast]);

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
      default: '"Newsreader", "Iowan Old Style", Georgia, serif',
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
                objectivesEnabled={objectivesEnabled}
                onGenerate={objectivesEnabled ? handleGenerate : undefined}
                onEditorReady={handleEditorReady}
                fontSizeClassName={fontSizeClassName}
                fontFamilyStyle={fontFamilyStyle}
                saving={saving}
                lastSavedAt={lastSavedAt}
                extraMenuItems={extraMenuItems}
                currentIndex={currentIndex}
                totalPages={totalPages}
                sectionLabel={sectionLabel}
                topContent={canEdit && onObjectiveChange && objectivesEnabled ? (
                  <div className="px-8 pt-4 pb-2 flex items-center gap-2">
                    <input
                      type="text"
                      value={objectiveDraft}
                      onChange={(e) => setObjectiveDraft(e.target.value)}
                      onBlur={() => {
                        const next = objectiveDraft.trim();
                        if (next !== (objective ?? '')) onObjectiveChange(next || null);
                      }}
                      placeholder="Objective for this page — only you see this"
                      title="Page objective (author-only — not shown to readers)"
                      className="flex-1 bg-transparent text-sm italic text-muted-foreground placeholder:text-muted-foreground/50 focus:outline-none border-l-2 border-transparent focus:border-muted-foreground/30 pl-2 -ml-0.5"
                    />
                    {pageType !== 'section' && objectiveDraft.trim() && (
                      <button
                        type="button"
                        onClick={handleGeneratePage}
                        disabled={generatingPage}
                        title="Generate this page's prose from its objective"
                        className="flex-none inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
                      >
                        {generatingPage ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                        Write page
                      </button>
                    )}
                  </div>
                ) : undefined}
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
