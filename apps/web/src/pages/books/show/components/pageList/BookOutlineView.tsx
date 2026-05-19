import { useMemo, useState } from 'react';
import { ChevronRight, ChevronDown, FileText, BookOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import { parsePagesIntoOutline, HeadingNode, PageOutline } from '@/utils/contentParser';
import { Page } from './types';

interface BookOutlineViewProps {
  pages: Page[];
  bookId: number;
  onNavigate: (pageId: number) => void;
}

const LEVEL_INDENT = 20;
const TITLE_LEFT = 14;
const HEADING_BASE = 38;

export const BookOutlineView = ({ pages, onNavigate }: BookOutlineViewProps) => {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const outline = useMemo(() => parsePagesIntoOutline(pages), [pages]);

  const toggle = (key: string) => {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  if (outline.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <FileText className="mb-4 h-10 w-10 text-[hsl(var(--pv-text-faint))]" />
        <p className="pv-serif text-[14px] italic text-[hsl(var(--pv-text-muted))]">
          No pages in this book
        </p>
      </div>
    );
  }

  return (
    <div>
      {outline.map((page) => (
        <PageRow
          key={page.pageId}
          page={page}
          expanded={expanded}
          onToggle={toggle}
          onNavigate={onNavigate}
        />
      ))}
    </div>
  );
};

function PageRow({
  page,
  expanded,
  onToggle,
  onNavigate,
}: {
  page: PageOutline;
  expanded: Record<string, boolean>;
  onToggle: (key: string) => void;
  onNavigate: (pageId: number) => void;
}) {
  const isSection = page.pageType === 'section';

  // Strip a leading H1 when it duplicates the page title — keeps the outline tight.
  const firstHeading = page.topLevelHeadings[0];
  const firstHeadingMirrorsTitle =
    firstHeading?.text?.trim().toLowerCase() === page.pageTitle?.trim().toLowerCase();
  const displayedHeadings = firstHeadingMirrorsTitle
    ? [
        // Promote H1's children up so they remain accessible.
        ...(firstHeading?.children?.filter((c): c is HeadingNode => c.type === 'heading') ?? []),
        ...page.topLevelHeadings.slice(1),
      ]
    : page.topLevelHeadings;

  const pageKey = `page-${page.pageId}`;
  const isExpanded = Boolean(expanded[pageKey]);
  const hasHeadings = displayedHeadings.length > 0;
  // Sections are flat anchors; treat them as non-collapsible.
  const isCollapsible = !isSection && hasHeadings;

  return (
    <div className="border-b border-dashed border-[hsl(var(--pv-border-soft))] last:border-b-0">
      <div
        className={cn(
          'group flex cursor-pointer items-center gap-3 py-3 pr-5 transition-colors hover:bg-[hsl(var(--pv-surface-2))]/60',
          isSection ? 'bg-[hsl(var(--pv-surface-2))]/40 pl-3' : 'pl-3',
        )}
        onClick={() => {
          if (isCollapsible) {
            onToggle(pageKey);
          } else {
            onNavigate(page.pageId);
          }
        }}
      >
        <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center">
          {isCollapsible ? (
            isExpanded ? (
              <ChevronDown className="h-4 w-4 text-[hsl(var(--pv-text-faint))]" />
            ) : (
              <ChevronRight className="h-4 w-4 text-[hsl(var(--pv-text-faint))]" />
            )
          ) : null}
        </div>

        <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center">
          {isSection ? (
            <BookOpen className="h-4 w-4 text-[hsl(var(--pv-text-muted))]" />
          ) : (
            <FileText className="h-4 w-4 text-[hsl(var(--pv-text-faint))]" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <span
            className={cn(
              'pv-serif block truncate leading-snug',
              isSection
                ? 'pv-display text-[18px] italic text-foreground'
                : 'text-[15px] text-foreground',
            )}
          >
            {page.pageTitle}
          </span>
        </div>

        {/* Open the page even when the row is acting as an expander. */}
        {isCollapsible && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onNavigate(page.pageId);
            }}
            className="pv-serif opacity-0 transition-opacity group-hover:opacity-100 text-[12px] italic text-[hsl(var(--pv-text-muted))] hover:text-foreground"
          >
            open ›
          </button>
        )}

        <span
          className="pv-mono flex-shrink-0 text-[11px] tabular-nums text-[hsl(var(--pv-text-faint))]"
          style={{ fontVariantNumeric: 'oldstyle-nums' }}
        >
          {page.pageIndex + 1}
        </span>
      </div>

      {isExpanded && hasHeadings && (
        <div>
          {displayedHeadings.map((heading, idx) => (
            <HeadingRow
              key={`${pageKey}-h${idx}`}
              heading={heading}
              path={`${pageKey}-h${idx}`}
              level={0}
              expanded={expanded}
              onToggle={onToggle}
              onNavigate={() => onNavigate(page.pageId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function HeadingRow({
  heading,
  path,
  level,
  expanded,
  onToggle,
  onNavigate,
}: {
  heading: HeadingNode;
  path: string;
  level: number;
  expanded: Record<string, boolean>;
  onToggle: (key: string) => void;
  onNavigate: () => void;
}) {
  const childHeadings =
    heading.children?.filter((c): c is HeadingNode => c.type === 'heading') ?? [];
  const hasChildHeadings = childHeadings.length > 0;
  const isExpanded = Boolean(expanded[path]);

  const paddingLeft = TITLE_LEFT + HEADING_BASE + level * LEVEL_INDENT;

  return (
    <div>
      <div
        className="group flex cursor-pointer items-center gap-2 py-1.5 transition-colors hover:bg-[hsl(var(--pv-surface-2))]/60"
        style={{ paddingLeft: `${paddingLeft}px`, paddingRight: '20px' }}
        onClick={() => (hasChildHeadings ? onToggle(path) : onNavigate())}
      >
        <div className="flex h-4 w-4 flex-shrink-0 items-center justify-center">
          {hasChildHeadings ? (
            isExpanded ? (
              <ChevronDown className="h-3.5 w-3.5 text-[hsl(var(--pv-text-faint))]" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-[hsl(var(--pv-text-faint))]" />
            )
          ) : null}
        </div>

        <span
          className={cn(
            'pv-serif min-w-0 flex-1 truncate leading-relaxed',
            heading.level === 1 && 'text-[14.5px] text-foreground',
            heading.level === 2 && 'text-[13.5px] text-foreground/90',
            heading.level >= 3 && 'text-[13px] italic text-[hsl(var(--pv-text-muted))]',
          )}
        >
          {heading.text}
        </span>

        {hasChildHeadings && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onNavigate();
            }}
            className="pv-serif opacity-0 transition-opacity group-hover:opacity-100 text-[11px] italic text-[hsl(var(--pv-text-muted))] hover:text-foreground"
          >
            open ›
          </button>
        )}
      </div>

      {isExpanded && hasChildHeadings && (
        <>
          {childHeadings.map((child, idx) => (
            <HeadingRow
              key={`${path}-${idx}`}
              heading={child}
              path={`${path}-${idx}`}
              level={level + 1}
              expanded={expanded}
              onToggle={onToggle}
              onNavigate={onNavigate}
            />
          ))}
        </>
      )}
    </div>
  );
}
