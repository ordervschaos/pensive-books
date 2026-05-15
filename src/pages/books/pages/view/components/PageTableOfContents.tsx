import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

interface Heading {
  id: string;
  text: string;
  level: number;
}

interface PageTableOfContentsProps {
  className?: string;
  pageId?: number | null;
}

export const PageTableOfContents = ({ className, pageId }: PageTableOfContentsProps) => {
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [activeId, setActiveId] = useState<string>('');

  useEffect(() => {
    // Reset headings when page changes
    setHeadings([]);
    setActiveId('');

    // Extract headings from the page
    const extractHeadings = () => {
      const headingElements = document.querySelectorAll('.ProseMirror h1, .ProseMirror h2, .ProseMirror h3, .ProseMirror h4, .ProseMirror h5, .ProseMirror h6');
      const headingData: Heading[] = [];

      headingElements.forEach((element) => {
        const id = element.id || element.textContent?.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || '';
        const text = element.textContent || '';
        const level = parseInt(element.tagName.charAt(1));

        // Ensure the element has an ID for linking
        if (!element.id && id) {
          element.id = id;
        }

        headingData.push({ id, text, level });
      });

      setHeadings(headingData);
    };

    // Delay initial extraction to ensure content is rendered
    const timeoutId = setTimeout(extractHeadings, 100);

    // Set up a MutationObserver to watch for changes in the editor
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

  useEffect(() => {
    // Set up Intersection Observer to highlight active section
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

    // Observe all heading elements
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
      element.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    }
  };

  

  return (
    <aside className={cn('sticky top-0 h-screen w-56 flex-shrink-0 overflow-hidden border-l border-border/40 bg-background/50', className)}>
      <div className="flex h-full flex-col p-4">
        <h3 className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">This Page</h3>
        <nav className="sidebar-scroll flex-1 overflow-y-auto pr-2">
          <ul className="space-y-1">
            {headings.map((heading) => (
              <li
                key={heading.id}
                style={{ paddingLeft: `${(heading.level - 1) * 0.75}rem` }}
              >
                <button
                  onClick={() => scrollToHeading(heading.id)}
                  className={cn(
                    'w-full rounded-md px-3 py-1.5 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground',
                    activeId === heading.id
                      ? 'border-l-2 border-primary bg-accent pl-[10px] text-accent-foreground'
                      : 'text-muted-foreground'
                  )}
                >
                  <span className={cn('block leading-5', activeId === heading.id ? 'whitespace-normal break-words' : 'truncate')}>
                    {heading.text}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </aside>
  );
};
