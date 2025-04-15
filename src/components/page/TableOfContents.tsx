
import React from "react";
import { useNavigate } from "react-router-dom";
import { List } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

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
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 flex items-center gap-2 font-medium">
        <List className="h-5 w-5" />
        <span>Table of Contents</span>
      </div>
      <Separator />
      <div className="flex-1 overflow-auto">
        <div className="py-2">
          {pages.map((page) => (
            <button
              key={page.id}
              onClick={() => handlePageClick(page.id)}
              className={cn(
                "w-full px-4 py-2 text-left text-sm hover:bg-sidebar-accent transition-colors flex items-center",
                page.id === currentPageId ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium" : ""
              )}
            >
              <span className="mr-2 text-muted-foreground">{page.page_index + 1}.</span>
              <span className="truncate">{page.title || "Untitled"}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
