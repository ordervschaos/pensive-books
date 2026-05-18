import { useState } from 'react';
import { ChevronRight, ChevronDown, FileText, BookOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import { parsePagesIntoOutline, HeadingNode, ContentNode } from '@/utils/contentParser';
import { jsonToHtml } from '@/utils/tiptapHelpers';
import { sanitizeHtml } from '@/lib/sanitize';
import { Page } from './types';

interface BookOutlineViewProps {
  pages: Page[];
  bookId: number;
  onNavigate: (pageId: number) => void;
}

interface ExpandedState {
  [key: string]: boolean;
}

export const BookOutlineView = ({ pages, bookId, onNavigate }: BookOutlineViewProps) => {
  const [expandedPages, setExpandedPages] = useState<ExpandedState>({});
  const [expandedHeadings, setExpandedHeadings] = useState<ExpandedState>({});
  const [expandedTitles, setExpandedTitles] = useState<ExpandedState>({}); // For title-H1 merges

  const outline = parsePagesIntoOutline(pages);

  const togglePage = (pageId: number, autoExpandTitle: boolean = false) => {
    setExpandedPages(prev => {
      const newExpanded = !prev[pageId];

      // If expanding the page and autoExpandTitle is true, also expand the title
      if (newExpanded && autoExpandTitle) {
        setExpandedTitles(prevTitles => ({
          ...prevTitles,
          [pageId]: true
        }));
      }

      // If collapsing the page, also collapse the title
      if (!newExpanded) {
        setExpandedTitles(prevTitles => ({
          ...prevTitles,
          [pageId]: false
        }));
      }

      return {
        ...prev,
        [pageId]: newExpanded
      };
    });
  };

  const toggleHeading = (key: string) => {
    setExpandedHeadings(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  const toggleTitle = (pageId: number) => {
    setExpandedTitles(prev => ({
      ...prev,
      [pageId]: !prev[pageId]
    }));
  };

  const renderHeading = (
    heading: HeadingNode,
    pageId: number,
    path: string,
    level: number = 0,
    isParentSection: boolean = false
  ) => {
    const key = `${pageId}-${path}-${heading.text}`;
    const isExpanded = expandedHeadings[key];

    // Separate heading children from content children
    const headingChildren = heading.children?.filter(child => child.type === 'heading') as HeadingNode[] || [];
    const contentChildren = heading.children?.filter(child => child.type !== 'heading') || [];

    const hasHeadingChildren = headingChildren.length > 0;
    const hasContentChildren = contentChildren.length > 0;
    const hasAnyChildren = hasHeadingChildren || hasContentChildren;

    // Calculate consistent indentation (32px per level)
    // Section pages start at 8px (pl-2), regular pages at 24px (pl-6)
    const basePadding = isParentSection ? 40 : 56; // 8 + 32 for sections, 24 + 32 for regular
    const paddingLeft = level === 0 ? basePadding : basePadding + (level * 32);

    return (
      <div key={key}>
        <div
          className={cn(
            "group flex cursor-pointer items-center gap-2 py-2 transition-colors",
            "hover:bg-[hsl(var(--pv-surface-2))]/60",
          )}
          style={{ paddingLeft: `${paddingLeft}px` }}
          onClick={() => hasAnyChildren ? toggleHeading(key) : onNavigate(pageId)}
        >
          {/* Fixed width chevron container for alignment */}
          <div className="w-4 h-4 flex items-center justify-center flex-shrink-0">
            {hasAnyChildren && (
              isExpanded ? (
                <ChevronDown className="h-3.5 w-3.5 text-[hsl(var(--pv-text-faint))]" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 text-[hsl(var(--pv-text-faint))]" />
              )
            )}
          </div>

          <span
            className={cn(
              "pv-serif min-w-0 flex-1 leading-relaxed",
              heading.level === 1 && "text-[15px] text-foreground",
              heading.level === 2 && "text-[14px] italic text-foreground/90",
              heading.level >= 3 && "text-[13px] italic text-[hsl(var(--pv-text-muted))]",
            )}
          >
            {heading.text}
          </span>
        </div>

        {/* Render children if expanded */}
        {isExpanded && (
          <>
            {/* First, render heading children (H2, H3, etc.) */}
            {hasHeadingChildren && headingChildren.map((child, idx) =>
              renderHeading(
                child,
                pageId,
                `${path}-${idx}`,
                level + 1,
                isParentSection
              )
            )}

            {/* Then, render content only if there are no heading children */}
            {!hasHeadingChildren && hasContentChildren && contentChildren.map((child, idx) => {
              const contentHtml = child.content ? jsonToHtml(child.content) : child.text;
              const contentPaddingLeft = basePadding + ((level + 1) * 32);
              return (
                <div
                  key={`${key}-content-${idx}`}
                  className="py-2 hover:bg-accent/30 cursor-pointer transition-colors outline-content-preview"
                  style={{ paddingLeft: `${contentPaddingLeft}px` }}
                  onClick={() => onNavigate(pageId)}
                >
                  <div
                    className="text-xs text-muted-foreground line-clamp-3 leading-relaxed pr-4"
                    dangerouslySetInnerHTML={{ __html: sanitizeHtml(contentHtml) }}
                  />
                </div>
              );
            })}
          </>
        )}
      </div>
    );
  };

  const renderPageSection = (pageOutline: any) => {
    const isExpanded = expandedPages[pageOutline.pageId];
    const hasHeadings = pageOutline.topLevelHeadings.length > 0;
    const isSection = pageOutline.pageType === 'section';

    // Check if first heading matches page title (case-insensitive)
    const firstHeading = hasHeadings ? pageOutline.topLevelHeadings[0] : null;
    const firstHeadingMatchesTitle = firstHeading &&
      firstHeading.text?.trim().toLowerCase() === pageOutline.pageTitle?.trim().toLowerCase();

    // When title matches first H1, the title becomes expandable to show H1's heading children (H2s)
    const firstH1HasHeadingChildren = firstHeading?.children?.some((child: ContentNode) => child.type === 'heading');
    const titleIsExpandable = isExpanded && firstHeadingMatchesTitle && firstH1HasHeadingChildren;

    const titleExpanded = expandedTitles[pageOutline.pageId];

    // Section pages are not collapsible
    const isCollapsible = !isSection && hasHeadings;

    return (
      <div
        key={pageOutline.pageId}
        className="border-b border-dashed border-[hsl(var(--pv-border-soft))] last:border-b-0"
      >
        {/* Page Title - always shown */}
        <div
          className={cn(
            "group flex cursor-pointer items-center gap-3 py-3 transition-colors hover:bg-[hsl(var(--pv-surface-2))]/60",
            isSection
              ? "bg-[hsl(var(--pv-surface-2))]/40 pl-3 pr-5"
              : "pl-6 pr-5",
          )}
          onClick={() => {
            if (isSection) {
              onNavigate(pageOutline.pageId);
              return;
            }

            if (titleIsExpandable) {
              toggleTitle(pageOutline.pageId);
            } else if (isCollapsible) {
              const shouldAutoExpandTitle =
                !isExpanded && firstHeadingMatchesTitle && firstH1HasHeadingChildren;
              togglePage(pageOutline.pageId, shouldAutoExpandTitle);
            } else {
              onNavigate(pageOutline.pageId);
            }
          }}
        >
          {/* Fixed width chevron container */}
          <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center">
            {!isSection &&
              (titleIsExpandable ? (
                titleExpanded ? (
                  <ChevronDown className="h-4 w-4 text-[hsl(var(--pv-text-faint))]" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-[hsl(var(--pv-text-faint))]" />
                )
              ) : isCollapsible ? (
                isExpanded ? (
                  <ChevronDown className="h-4 w-4 text-[hsl(var(--pv-text-faint))]" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-[hsl(var(--pv-text-faint))]" />
                )
              ) : null)}
          </div>

          {/* Page icon */}
          <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center">
            {pageOutline.pageType === "section" ? (
              <BookOpen className="h-4 w-4 text-[hsl(var(--pv-text-muted))]" />
            ) : (
              <FileText className="h-4 w-4 text-[hsl(var(--pv-text-faint))]" />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span
                className={cn(
                  "pv-serif truncate leading-snug",
                  pageOutline.pageType === "section"
                    ? "pv-display text-[18px] italic text-foreground"
                    : "text-[15px] text-foreground",
                )}
              >
                {pageOutline.pageTitle}
              </span>
              {!pageOutline.hasContent && (
                <span className="pv-serif text-[12px] italic text-[hsl(var(--pv-text-faint))]">
                  (empty)
                </span>
              )}
            </div>
          </div>

          <span
            className="pv-mono flex-shrink-0 text-[11px] tabular-nums text-[hsl(var(--pv-text-faint))]"
            style={{ fontVariantNumeric: "oldstyle-nums" }}
          >
            {pageOutline.pageIndex + 1}
          </span>
        </div>

        {/* Show first H1's heading children (H2s) when title is expanded */}
        {titleIsExpandable && titleExpanded && firstHeading.children && (
          <div>
            {firstHeading.children
              .filter((child): child is HeadingNode => child.type === "heading")
              .map((child, idx: number) =>
                renderHeading(
                  child,
                  pageOutline.pageId,
                  `title-h1-${idx}`,
                  0,
                  isSection,
                ),
              )}
          </div>
        )}

        {/* Expanded Headings - skip first if it matches title */}
        {isExpanded && hasHeadings && (
          <div>
            {pageOutline.topLevelHeadings
              .slice(firstHeadingMatchesTitle ? 1 : 0)
              .map((heading: HeadingNode, idx: number) => {
                const actualIdx = firstHeadingMatchesTitle ? idx + 1 : idx;
                return renderHeading(
                  heading,
                  pageOutline.pageId,
                  `h${actualIdx}`,
                  0,
                  isSection,
                );
              })}
          </div>
        )}
      </div>
    );
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

  return <div>{outline.map(renderPageSection)}</div>;
};
