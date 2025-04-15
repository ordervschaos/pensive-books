import React from "react";
import { useNavigate } from "react-router-dom";
import { List } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { PreloadLink } from "./PreloadLink";

type PageItem = {
  id: number;
  title: string;
  page_index: number;
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
  const navigate = useNavigate();

  const handlePageClick = (pageId: number) => {
    const page = pages.find(p => p.id === pageId);
    if (!page) return;
    
    const slug = page.title ? 
      `${pageId}-${page.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` : 
      pageId.toString();
      
    navigate(`/book/${bookId}/page/${slug}`);
    
    if (onPageSelect) {
      onPageSelect();
    }
  };

  if (!pages.length) {
    return (
      <div className="py-4 text-center text-muted-foreground">
        No pages found
      </div>
    );
  }

  return (
    <div className="py-2">
      <div className="px-4 py-2">
        <h2 className="mb-2 text-lg font-semibold">Table of Contents</h2>
      </div>
      <Separator />
      <nav className="grid items-start gap-2 p-2">
        {pages.map((page) => {
          const isActive = page.id === currentPageId;
          const slug = page.title ? 
            `${page.id}-${page.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` : 
            page.id.toString();
          
          return (
            <PreloadLink
              key={page.id}
              to={`/book/${bookId}/page/${slug}`}
              bookId={parseInt(bookId)}
              pageId={page.id}
              className={cn(
                "group flex items-center rounded-md px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground",
                isActive && "bg-accent"
              )}
              onClick={() => onPageSelect && onPageSelect()}
            >
              <span className="truncate">{page.title || `Page ${page.page_index + 1}`}</span>
            </PreloadLink>
          );
        })}
      </nav>
    </div>
  );
}
