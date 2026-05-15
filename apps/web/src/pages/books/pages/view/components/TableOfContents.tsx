import { useEffect, useRef } from "react";
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

export function TableOfContents({
  pages,
  bookId,
  currentPageId,
  onPageSelect,
  onNewPage,
  canEdit = false,
  bookName
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


  if (!pages.length) {
    return (
      <div className="py-4 text-center text-muted-foreground">
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
    <div className="h-full flex flex-col bg-background/50 py-4 pl-4 pr-0">
      {/* Back to Book Navigation */}
      <div className="mb-4 pr-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate(`/books/${bookId}`)}
          className="h-auto w-full justify-start rounded-md px-3 py-2"
        >
          <ArrowLeft className="h-4 w-4 mr-2 flex-shrink-0" />
          <span className="truncate text-sm">{bookName || "Back to Book"}</span>
        </Button>
      </div>

      {/* Pages Header */}
      <div className="mb-4 pr-4 flex items-center justify-between">
        <h2 className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pages</h2>
        {canEdit && onNewPage && renderAddMenu(
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            title="Add new"
          >
            <Plus className="h-4 w-4" />
          </Button>
        )}
      </div>
      <nav ref={containerRef} className="flex-1 flex flex-col gap-0.5 overflow-y-auto sidebar-scroll pr-2">
        {pages.map((page) => {
          const isActive = page.id === currentPageId;
          const isSection = page.page_type === 'section';
          const slug = page.title ?
            `${page.id}-${page.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` :
            page.id.toString();

          return (
            <PreloadLink
              key={page.id}
              data-page-id={page.id}
              to={`/books/${bookId}/pages/${slug}`}
              bookId={parseInt(bookId)}
              pageId={page.id}
              className={cn(
                "block rounded-md transition-colors",
                isSection
                  ? "px-3 py-2 text-xs font-semibold uppercase tracking-wide"
                  : "px-3 py-1.5 text-sm",
                isActive
                  ? "border-l-2 border-primary bg-accent pl-[10px] text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
              onClick={() => onPageSelect && onPageSelect()}
            >
              <span className={cn("block leading-5", isActive ? "whitespace-normal break-words" : "truncate")}>
                {page.title || `Page ${page.page_index + 1}`}
              </span>
            </PreloadLink>
          );
        })}
      </nav>
      {canEdit && onNewPage && (
        <div className="pt-4 pr-4 flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onNewPage('text')}
            className="h-9 flex-1"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add page
          </Button>
          {renderAddMenu(
            <Button
              variant="outline"
              size="sm"
              className="h-9 px-2"
              title="More options"
            >
              <ChevronDown className="h-4 w-4" />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
