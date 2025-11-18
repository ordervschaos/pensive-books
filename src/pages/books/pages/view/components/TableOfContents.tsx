import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { PreloadLink } from "./PreloadLink";

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
}

export function TableOfContents({ 
  pages, 
  bookId, 
  currentPageId,
  onPageSelect 
}: TableOfContentsProps) {
  const containerRef = useRef<HTMLDivElement>(null);

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

  return (
    <div className="h-full flex flex-col py-6 px-4">
      <div className="mb-4">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-2">Pages</h2>
      </div>
      <nav ref={containerRef} className="flex-1 flex flex-col gap-0.5 overflow-y-auto scrollbar-hide">
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
                  ? "text-foreground font-semibold"
                  : "text-muted-foreground"
              )}
              onClick={() => onPageSelect && onPageSelect()}
            >
              <span className={cn("truncate", isSection && "text-base")}>
                {page.title || `Page ${page.page_index + 1}`}
              </span>
            </PreloadLink>
          );
        })}
      </nav>
    </div>
  );
}
