import { Editor } from '@tiptap/react';
import { useEffect, useState } from 'react';

interface EditorStatusBarProps {
  editor: Editor;
  /** Saved status is only meaningful for editors; readers just see word/reading/page. */
  editable?: boolean;
  saving?: boolean;
  lastSavedAt?: Date | null;
  /** 0-based page position; combined with totalPages for the "page X / Y" counter. */
  currentIndex?: number;
  totalPages?: number;
  /** Nearest preceding section name, prefixed to the page counter when present. */
  sectionLabel?: string | null;
}

const Sep = () => (
  <span className="h-[3px] w-[3px] rounded-full bg-[hsl(var(--pv-text-faint))]" aria-hidden />
);

/**
 * Thin footer status bar (the "status moves down" decision from the editor redesign).
 * Consolidates save state, word count, reading time, and the page counter — pulling them
 * out of the toolbar / top eyebrow so the toolbar can shrink.
 */
export const EditorStatusBar = ({
  editor,
  editable,
  saving,
  lastSavedAt,
  currentIndex,
  totalPages,
  sectionLabel,
}: EditorStatusBarProps) => {
  // Live word count, recomputed as the document changes.
  const [words, setWords] = useState(0);
  useEffect(() => {
    const recount = () => {
      const text = editor.getText().trim();
      setWords(text ? text.split(/\s+/).length : 0);
    };
    recount();
    editor.on('update', recount);
    return () => {
      editor.off('update', recount);
    };
  }, [editor]);

  const savedAgo = (() => {
    if (saving) return 'saving…';
    if (!lastSavedAt) return null;
    const diff = Date.now() - lastSavedAt.getTime();
    if (diff < 60_000) return 'just now';
    const mins = Math.floor(diff / 60_000);
    if (mins < 60) return `${mins} min ago`;
    return `${Math.floor(mins / 60)}h ago`;
  })();

  // 200 wpm — the design's "58 words → 17s read" ratio.
  const readingSeconds = Math.round((words / 200) * 60);
  const readingLabel =
    readingSeconds < 60 ? `${readingSeconds}s read` : `${Math.max(1, Math.round(readingSeconds / 60))} min read`;

  const showPage =
    typeof currentIndex === 'number' && typeof totalPages === 'number' && totalPages > 0;

  return (
    <>
      {/* Reserve space so the last lines clear the fixed bar (mirrors the toolbar's top spacer). */}
      <div className="h-9 flex-shrink-0" aria-hidden />
      <div className="fixed bottom-0 left-0 right-0 lg:left-64 lg:right-64 z-40 border-t border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto max-w-3xl px-4">
          <div className="flex min-h-[36px] items-center gap-3 py-1.5 pv-mono text-[10px] uppercase tracking-[0.18em] text-[hsl(var(--pv-text-faint))]">
            {editable && savedAgo && (
              <>
                <span className="inline-flex items-center gap-2">
                  <span
                    className="h-[7px] w-[7px] rounded-full"
                    style={{
                      background: saving ? 'hsl(var(--pv-text-faint))' : '#5a8a4a',
                      boxShadow: saving ? undefined : '0 0 0 3px rgba(90,138,74,0.18)',
                    }}
                  />
                  {saving ? savedAgo : `saved · ${savedAgo}`}
                </span>
                <Sep />
              </>
            )}
            <span>{words} words</span>
            <Sep />
            <span>{readingLabel}</span>
            <span className="flex-1" />
            {showPage && (
              <span>
                {sectionLabel ? `${sectionLabel} · ` : ''}page {(currentIndex ?? 0) + 1} / {totalPages}
              </span>
            )}
          </div>
        </div>
      </div>
    </>
  );
};
