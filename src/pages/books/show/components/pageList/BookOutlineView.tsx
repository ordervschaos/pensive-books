import { useState } from 'react';
import { ChevronRight, ChevronDown, FileText, BookOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import { parsePagesIntoOutline, HeadingNode, ContentNode } from '@/utils/contentParser';
import { jsonToHtml } from '@/utils/tiptapHelpers';
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
            "flex items-center gap-2 py-2.5 hover:bg-accent/50 cursor-pointer transition-colors group",
            "border-l border-transparent hover:border-primary/20"
          )}
          style={{ paddingLeft: `${paddingLeft}px` }}
          onClick={() => hasAnyChildren ? toggleHeading(key) : onNavigate(pageId)}
        >
          {/* Fixed width chevron container for alignment */}
          <div className="w-4 h-4 flex items-center justify-center flex-shrink-0">
            {hasAnyChildren && (
              isExpanded ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              )
            )}
          </div>

          <span
            className={cn(
              "text-sm leading-relaxed flex-1 min-w-0",
              heading.level === 1 && "font-semibold text-foreground",
              heading.level === 2 && "font-medium text-foreground/90",
              heading.level >= 3 && "font-normal text-muted-foreground"
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
                    dangerouslySetInnerHTML={{ __html: contentHtml }}
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
      <div key={pageOutline.pageId} className="border-b border-border/50 last:border-b-0">
        {/* Page Title - always shown */}
        <div
          className={cn(
            "flex items-center gap-3 py-3 hover:bg-accent/50 cursor-pointer transition-colors group",
            isSection ? "bg-muted/30 pl-2 pr-4" : "pl-6 pr-4"
          )}
          onClick={() => {
            // Section pages always navigate directly
            if (isSection) {
              onNavigate(pageOutline.pageId);
              return;
            }

            if (titleIsExpandable) {
              toggleTitle(pageOutline.pageId);
            } else if (isCollapsible) {
              // Auto-expand title if first heading matches and has heading children
              const shouldAutoExpandTitle = !isExpanded && firstHeadingMatchesTitle && firstH1HasHeadingChildren;
              togglePage(pageOutline.pageId, shouldAutoExpandTitle);
            } else {
              onNavigate(pageOutline.pageId);
            }
          }}
        >
          {/* Fixed width chevron container */}
          <div className="w-5 h-5 flex items-center justify-center flex-shrink-0">
            {!isSection && (
              titleIsExpandable ? (
                titleExpanded ? (
                  <ChevronDown className="h-5 w-5 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-5 w-5 text-muted-foreground" />
                )
              ) : isCollapsible ? (
                isExpanded ? (
                  <ChevronDown className="h-5 w-5 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-5 w-5 text-muted-foreground" />
                )
              ) : null
            )}
          </div>

          {/* Page icon */}
          <div className="w-5 h-5 flex items-center justify-center flex-shrink-0">
            {pageOutline.pageType === 'section' ? (
              <BookOpen className="h-5 w-5 text-primary" />
            ) : (
              <FileText className="h-5 w-5 text-muted-foreground" />
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className={cn(
                "font-semibold truncate leading-relaxed",
                pageOutline.pageType === 'section' ? "text-base" : "text-sm"
              )}>
                {pageOutline.pageTitle}
              </span>
              {!pageOutline.hasContent && (
                <span className="text-xs text-muted-foreground/70">(empty)</span>
              )}
            </div>
          </div>

          <span className="text-xs text-muted-foreground flex-shrink-0 font-mono tabular-nums">
            {pageOutline.pageIndex + 1}
          </span>
        </div>

        {/* Show first H1's heading children (H2s) when title is expanded */}
        {titleIsExpandable && titleExpanded && firstHeading.children && (
          <div className="bg-muted/10">
            {firstHeading.children
              .filter((child): child is HeadingNode => child.type === 'heading')
              .map((child, idx: number) =>
                renderHeading(
                  child,
                  pageOutline.pageId,
                  `title-h1-${idx}`,
                  0,
                  isSection
                )
              )}
          </div>
        )}

        {/* Expanded Headings - skip first if it matches title */}
        {isExpanded && hasHeadings && (
          <div className="bg-muted/10">
            {pageOutline.topLevelHeadings
              .slice(firstHeadingMatchesTitle ? 1 : 0) // Skip first heading if it matches title
              .map((heading: HeadingNode, idx: number) => {
                const actualIdx = firstHeadingMatchesTitle ? idx + 1 : idx;
                return renderHeading(
                  heading,
                  pageOutline.pageId,
                  `h${actualIdx}`,
                  0,
                  isSection
                );
              })}
          </div>
        )}
      </div>
    );
  };

  if (outline.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <FileText className="h-12 w-12 text-muted-foreground mb-4" />
        <p className="text-muted-foreground">No pages in this book</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-border/30">
      {outline.map(renderPageSection)}
    </div>
  );
};
