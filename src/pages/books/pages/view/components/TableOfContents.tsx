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
    <div className="h-full flex flex-col py-4 pl-4 pr-0">
      {/* Back to Book Navigation */}
      <div className="mb-4 pr-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate(`/books/${bookId}`)}
          className="w-full justify-start px-2 h-auto py-2"
        >
          <ArrowLeft className="h-4 w-4 mr-2 flex-shrink-0" />
          <span className="truncate text-sm">{bookName || "Back to Book"}</span>
        </Button>
      </div>

      {/* Pages Header */}
      <div className="mb-4 pr-4 flex items-center justify-between">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-2">Pages</h2>
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
                "flex items-center rounded-md px-2 transition-colors",
                isSection ? "py-2 mt-2" : "py-1.5",
                "hover:bg-accent/50 hover:text-foreground",
                isActive
                  ? "text-foreground font-medium bg-accent/30"
                  : isSection
                  ? "text-foreground font-bold border-l-2 border-primary/50 pl-2"
                  : "text-muted-foreground"
              )}
              onClick={() => onPageSelect && onPageSelect()}
            >
              <span className={cn("truncate", isSection && "text-base uppercase tracking-wide")}>
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
            className="flex-1"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add page
          </Button>
          {renderAddMenu(
            <Button
              variant="outline"
              size="sm"
              className="px-2"
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
