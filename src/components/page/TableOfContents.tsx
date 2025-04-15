
import React from "react";
import { useNavigate } from "react-router-dom";
import { Book, List } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
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
      <div className="py-6 text-center text-muted-foreground flex flex-col items-center gap-2">
        <Book className="h-12 w-12 opacity-20" />
        <p>No pages found</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 flex items-center gap-2 font-medium bg-accent/30 backdrop-blur-sm">
        <List className="h-5 w-5 text-primary" />
        <span className="text-primary">Table of Contents</span>
      </div>
      <Separator />
      <ScrollArea className="flex-1">
        <div className="py-2">
          {pages.map((page, index) => (
            <button
              key={page.id}
              onClick={() => handlePageClick(page.id)}
              className={cn(
                "w-full px-4 py-3 text-left text-sm hover:bg-accent/50 transition-all flex items-center gap-3 group border-l-2 border-transparent",
                page.id === currentPageId ? 
                  "bg-accent font-medium border-l-2 border-primary text-primary" : 
                  "text-foreground/80"
              )}
            >
              <span className={cn(
                "flex items-center justify-center rounded-full h-6 w-6 text-xs font-medium transition-colors",
                page.id === currentPageId ? 
                  "bg-primary text-primary-foreground" : 
                  "bg-muted text-muted-foreground group-hover:bg-accent-foreground/20"
              )}>
                {page.page_index + 1}
              </span>
              <span className="truncate flex-1">{page.title || "Untitled"}</span>
            </button>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
