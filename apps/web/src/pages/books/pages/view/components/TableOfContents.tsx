import { useEffect, useMemo, useRef } from "react";
import { cn } from "@/lib/utils";
import { PreloadLink } from "./PreloadLink";
import { Button } from "@/components/ui/button";
import { Plus, ArrowLeft, Type, Section, ChevronDown } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type PageItem = {
  id: number;
  title: string;
  page_index: number;
  page_type?: 'text' | 'section';
};

interface TableOfContentsProps {
  pages: PageItem[];
  bookId: string;
  currentPageId: number;
  onPageSelect?: () => void;
  onNewPage?: (pageType?: 'text' | 'section') => void;
  canEdit?: boolean;
  bookName?: string;
}

// Group pages so a `page_type === 'section'` row becomes a section heading and
// the text pages beneath it are the section's body. Pages before the first
// section land in an implicit "Untitled" group at the top.
type Group = { label: string | null; pages: PageItem[] };

function groupPages(pages: PageItem[]): Group[] {
  const groups: Group[] = [];
  let current: Group = { label: null, pages: [] };
  for (const p of pages) {
    if (p.page_type === 'section') {
      if (current.pages.length || current.label) {
        groups.push(current);
      }
      current = { label: p.title || `Section ${p.page_index + 1}`, pages: [] };
    } else {
      current.pages.push(p);
    }
  }
  if (current.pages.length || current.label) {
    groups.push(current);
  }
  return groups;
}

export function TableOfContents({
  pages,
  bookId,
  currentPageId,
  onPageSelect,
  onNewPage,
  canEdit = false,
  bookName,
}: TableOfContentsProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (containerRef.current) {
      const activeElement = containerRef.current.querySelector(`[data-page-id="${currentPageId}"]`);
      if (activeElement) {
        activeElement.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  }, [currentPageId]);

  const groups = useMemo(() => groupPages(pages), [pages]);

  if (!pages.length) {
    return (
      <div className="py-4 text-center text-[hsl(var(--pv-text-muted))]">
        No pages found
      </div>
    );
  }

  const renderAddMenu = (trigger: React.ReactNode) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => onNewPage?.('text')} className="flex items-center gap-2">
          <Type className="h-4 w-4" />
          <span>New page</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onNewPage?.('section')} className="flex items-center gap-2">
          <Section className="h-4 w-4" />
          <span>New section</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className="flex h-full flex-col bg-[hsl(var(--pv-surface-2))]">
      {/* Back to book — paper-style header with book title */}
      <div className="flex items-center justify-between px-6 pt-5">
        <button
          type="button"
          onClick={() => navigate(`/books/${bookId}`)}
          className="pv-serif inline-flex items-center gap-2 text-[14px] italic text-[hsl(var(--pv-text-muted))] transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span className="truncate">{bookName || "Back to book"}</span>
        </button>
        {canEdit && onNewPage && renderAddMenu(
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-[hsl(var(--pv-text-muted))]"
            title="Add new"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      <div className="pv-eyebrow px-6 pt-3 pb-3">
        Pages · {pages.length}
      </div>

      <nav ref={containerRef} className="sidebar-scroll flex-1 overflow-y-auto px-3 pb-3">
        {groups.map((group, gi) => (
          <div key={gi} className="mb-5">
            {group.label && (
              <div className="pv-mono px-3 pb-2 text-[10.5px] uppercase tracking-[0.2em] text-[hsl(var(--pv-text-faint))]">
                {group.label}
              </div>
            )}
            <ul className="m-0 list-none p-0">
              {group.pages.map((page) => {
                const isActive = page.id === currentPageId;
                const slug = page.title ?
                  `${page.id}-${page.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` :
                  page.id.toString();
                return (
                  <li key={page.id}>
                    <PreloadLink
                      data-page-id={page.id}
                      to={`/books/${bookId}/pages/${slug}`}
                      bookId={parseInt(bookId)}
                      pageId={page.id}
                      className={cn(
                        "block rounded-md transition-colors",
                        isActive
                          ? "bg-background text-foreground"
                          : "text-[hsl(var(--pv-text-muted))] hover:bg-background/60 hover:text-foreground"
                      )}
                      style={{
                        borderLeft: isActive
                          ? "2px solid hsl(var(--pv-text))"
                          : "2px solid transparent",
                      }}
                      onClick={() => onPageSelect && onPageSelect()}
                    >
                      <span
                        className={cn(
                          "pv-serif block px-3 py-2 text-[14px] leading-snug",
                          isActive ? "italic" : "",
                        )}
                      >
                        {page.title || `Page ${page.page_index + 1}`}
                      </span>
                    </PreloadLink>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Footer: add page pill + extras */}
      {canEdit && onNewPage && (
        <div className="flex items-center gap-2 border-t border-border px-3 py-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onNewPage('text')}
            className="pv-serif h-9 flex-1 rounded-lg border-border bg-background italic text-[13px] text-foreground"
          >
            <Plus className="h-3.5 w-3.5 mr-2" />
            Add page
          </Button>
          {renderAddMenu(
            <Button
              variant="ghost"
              size="sm"
              className="h-9 w-9 p-0 text-[hsl(var(--pv-text-muted))]"
              title="More options"
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
