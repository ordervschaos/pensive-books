
import React from "react";
import { useNavigate } from "react-router-dom";
import { Book, List, BookmarkCheck } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";

type PageItem = {
  id: number;
  title: string;
  page_index: number;
  html_content?: string;
  page_type?: string;
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

  const getExcerpt = (htmlContent?: string) => {
    if (!htmlContent) return '';
    
    // Remove HTML tags and get plain text
    const text = htmlContent.replace(/<[^>]*>/g, '');
    
    // Truncate to a reasonable length
    return text.length > 60 ? text.substring(0, 60) + '...' : text;
  };

  const getWordCount = (htmlContent?: string, pageType?: string) => {
    if (!htmlContent || pageType !== 'text') return 0;
    return htmlContent.replace(/<[^>]*>/g, '').trim().split(/\s+/).length;
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
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-4 py-3 flex items-center gap-2 font-medium bg-accent/30 backdrop-blur-sm sticky top-0 z-10">
        <List className="h-5 w-5 text-primary" />
        <span className="text-primary">Table of Contents</span>
      </div>
      <Separator />
      <ScrollArea className="flex-1 pr-2" type="auto">
        <div className="py-2 space-y-2">
          {pages.map((page) => {
            const wordCount = getWordCount(page.html_content, page.page_type);
            const excerpt = getExcerpt(page.html_content);
            const isActive = page.id === currentPageId;
            
            return (
              <Card
                key={page.id}
                onClick={() => handlePageClick(page.id)}
                className={cn(
                  "w-full p-3 m-2 cursor-pointer transition-all border-l-2 hover:bg-accent/30 overflow-hidden",
                  isActive ? 
                    "bg-accent/50 border-l-2 border-primary shadow-sm" : 
                    "border-transparent"
                )}
              >
                <div className="flex items-start gap-3">
                  <div className={cn(
                    "flex-shrink-0 flex items-center justify-center rounded-full h-6 w-6 text-xs font-medium transition-colors mt-1",
                    isActive ? 
                      "bg-primary text-primary-foreground" : 
                      "bg-muted text-muted-foreground"
                  )}>
                    {page.page_index + 1}
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <h3 className={cn(
                      "text-sm font-medium line-clamp-1 mb-1",
                      isActive ? "text-primary" : "text-foreground"
                    )}>
                      {page.title || `Untitled Page ${page.page_index + 1}`}
                    </h3>
                    
                    {page.page_type === 'text' && excerpt && (
                      <p className="text-xs text-muted-foreground line-clamp-2 break-words">
                        {excerpt}
                      </p>
                    )}
                    
                    <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
                      {page.page_type === 'text' && wordCount > 0 && (
                        <span>{wordCount} words</span>
                      )}
                      <span className={page.page_type === 'section' ? 'mx-auto' : 'ml-auto'}>
                        Page {page.page_index + 1}
                      </span>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
