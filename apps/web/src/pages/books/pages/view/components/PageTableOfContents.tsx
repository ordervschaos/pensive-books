import { useEffect, useMemo, useState } from 'react';
import { Bookmark, Share2, X } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import { getWordCountFromContent } from '@/utils/tiptapHelpers';

interface Heading {
  id: string;
  text: string;
  level: number;
}

interface PageTableOfContentsProps {
  className?: string;
  pageId?: number | null;
  pageContent?: unknown;
  updatedAt?: string | null;
  saving?: boolean;
  hasUnsavedChanges?: boolean;
}

export const PageTableOfContents = ({
  className,
  pageId,
  pageContent,
  updatedAt,
  saving = false,
  hasUnsavedChanges = false,
}: PageTableOfContentsProps) => {
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [activeId, setActiveId] = useState<string>('');
  const [open, setOpen] = useState(true);

  // ── Extract headings from the editor DOM ──
  useEffect(() => {
    setHeadings([]);
    setActiveId('');

    const extractHeadings = () => {
      const headingElements = document.querySelectorAll(
        '.ProseMirror h1, .ProseMirror h2, .ProseMirror h3, .ProseMirror h4, .ProseMirror h5, .ProseMirror h6'
      );
      const headingData: Heading[] = [];

      headingElements.forEach((element) => {
        const id =
          element.id ||
          element.textContent?.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') ||
          '';
        const text = element.textContent || '';
        const level = parseInt(element.tagName.charAt(1));

        if (!element.id && id) {
          element.id = id;
        }

        headingData.push({ id, text, level });
      });

      setHeadings(headingData);
    };

    const timeoutId = setTimeout(extractHeadings, 100);

    const observer = new MutationObserver(() => {
      extractHeadings();
    });

    const proseMirror = document.querySelector('.ProseMirror');
    if (proseMirror) {
      observer.observe(proseMirror, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    }

    return () => {
      clearTimeout(timeoutId);
      observer.disconnect();
    };
  }, [pageId]);

  // ── Active-section highlight via IntersectionObserver ──
  useEffect(() => {
    const observerOptions = {
      rootMargin: '-80px 0px -80% 0px',
      threshold: 0,
    };

    const observerCallback = (entries: IntersectionObserverEntry[]) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          setActiveId(entry.target.id);
        }
      });
    };

    const observer = new IntersectionObserver(observerCallback, observerOptions);

    headings.forEach((heading) => {
      const element = document.getElementById(heading.id);
      if (element) {
        observer.observe(element);
      }
    });

    return () => observer.disconnect();
  }, [headings]);

  const scrollToHeading = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  // ── Page meta: words, reading time, updated, status ──
  const wordCount = useMemo(() => {
    if (!pageContent) return 0;
    try {
      return getWordCountFromContent(pageContent as any);
    } catch {
      return 0;
    }
  }, [pageContent]);

  const readingLabel = useMemo(() => {
    if (!wordCount) return '—';
    const seconds = Math.round((wordCount / 200) * 60); // ~200 wpm
    if (seconds < 60) return `${seconds}s`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return s > 0 ? `${m} min ${s}s` : `${m} min`;
  }, [wordCount]);

  const updatedLabel = useMemo(() => {
    if (!updatedAt) return '—';
    try {
      return formatDistanceToNow(new Date(updatedAt), { addSuffix: true });
    } catch {
      return '—';
    }
  }, [updatedAt]);

  const status = saving
    ? { text: 'saving…', accent: false }
    : hasUnsavedChanges
      ? { text: 'unsaved changes', accent: true }
      : { text: 'saved', accent: false };

  if (!open) {
    return null;
  }

  return (
    <aside
      className={cn(
        'sticky top-0 hidden h-screen w-64 shrink-0 flex-col overflow-hidden border-l border-border bg-background lg:flex',
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[hsl(var(--pv-border-soft))] px-6 py-5">
        <span className="pv-eyebrow">On this page</span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Hide outline"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[hsl(var(--pv-text-muted))] transition-colors hover:bg-[hsl(var(--pv-surface-2))] hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Headings outline */}
      <nav className="sidebar-scroll flex-1 overflow-y-auto px-3 py-3.5">
        <ol className="m-0 list-none p-0">
          {headings.map((heading) => {
            const isActive = activeId === heading.id;
            const indent = (heading.level - 1) * 14;
            const isTop = heading.level === 1;
            return (
              <li key={heading.id} style={{ paddingLeft: indent }}>
                <button
                  type="button"
                  onClick={() => scrollToHeading(heading.id)}
                  className={cn(
                    'block w-full rounded-md px-3 py-2 text-left transition-colors',
                    isActive
                      ? 'bg-[hsl(var(--pv-surface-2))] text-foreground'
                      : 'text-[hsl(var(--pv-text-muted))] hover:bg-[hsl(var(--pv-surface-2))]/60 hover:text-foreground',
                  )}
                  style={{
                    borderLeft: isActive
                      ? '2px solid hsl(var(--pv-text))'
                      : '2px solid transparent',
                  }}
                >
                  <span
                    className={cn(
                      'pv-serif block leading-snug',
                      isTop ? 'text-[14px]' : 'text-[13px]',
                      isActive ? 'italic' : '',
                    )}
                  >
                    {heading.text}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      {/* This-page meta */}
      <div className="border-t border-[hsl(var(--pv-border-soft))] px-6 py-5">
        <div className="pv-eyebrow">This page</div>
        <dl className="mt-3 space-y-1.5">
          <MetaRow k="Words" v={wordCount.toLocaleString()} />
          <MetaRow k="Reading" v={readingLabel} />
          <MetaRow k="Updated" v={updatedLabel} />
          <MetaRow
            k="Status"
            v={
              <span
                className={cn(
                  'pv-serif text-[13px]',
                  status.accent ? 'italic' : '',
                )}
                style={status.accent ? { color: 'hsl(var(--pv-accent))' } : undefined}
              >
                {status.text}
              </span>
            }
          />
        </dl>
      </div>

      {/* Bottom actions */}
      <div className="flex flex-col gap-2.5 border-t border-[hsl(var(--pv-border-soft))] px-6 py-5">
        <button
          type="button"
          className="pv-serif inline-flex items-center gap-2.5 text-[13px] text-[hsl(var(--pv-text-muted))] transition-colors hover:text-foreground"
        >
          <Bookmark className="h-3.5 w-3.5" />
          <span>Set as bookmark</span>
        </button>
        <button
          type="button"
          className="pv-serif inline-flex items-center gap-2.5 text-[13px] text-[hsl(var(--pv-text-muted))] transition-colors hover:text-foreground"
        >
          <Share2 className="h-3.5 w-3.5" />
          <span>Share preview link</span>
        </button>
      </div>
    </aside>
  );
};

function MetaRow({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between py-1">
      <dt className="pv-mono text-[10.5px] uppercase tracking-[0.18em] text-[hsl(var(--pv-text-faint))]">
        {k}
      </dt>
      <dd className="pv-serif m-0 text-[13px] text-foreground">{v}</dd>
    </div>
  );
}
