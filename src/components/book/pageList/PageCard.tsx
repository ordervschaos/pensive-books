import { Trash2, BookmarkCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AudioPlayer } from "@/components/page/AudioPlayer";
import { PageItemProps } from "./types";
import { forwardRef } from "react";

export const PageCard = forwardRef<HTMLDivElement, PageItemProps>(({ page, onNavigate, onDelete, isBookmarked }, ref) => {
  const wordCount = page.html_content && page.page_type === 'text' ? 
    page.html_content.replace(/<[^>]*>/g, '').trim().split(/\s+/).length : 
    0;

  const excerpt = page.html_content ? page.html_content.replace(/<h1[^>]*>.*?<\/h1>/g, '') : '';

  return (
    <Card 
      ref={ref}
      onClick={() => onNavigate(page.id)}
      className="cursor-pointer hover:bg-accent/5 transition-colors relative group overflow-hidden"
    >
      <div className="aspect-[3/4] relative">
        <CardContent className="absolute inset-0 p-4 flex flex-col overflow-hidden">
          {/* Page Header */}
          <div className={`mb-3 pb-3 border-b border-border/50 ${page.page_type === 'section' ? 'flex-1 flex items-center justify-center' : ''}`}>
            <div className="flex items-center gap-2 justify-between">
              <h3 className={`${page.page_type === 'section' ? 'text-xl font-bold text-center' : 'text-base font-medium'} line-clamp-2`}>
                {page.title || `Untitled Page ${page.page_index + 1}`}
              </h3>
              {isBookmarked && (
                <Badge variant="default" color="green" className="h-5 shrink-0">
                  <BookmarkCheck className="h-3 w-3 mr-1" />
                </Badge>
              )}
            </div>
          </div>
          
          {/* Page Content Preview - Only show for text pages */}
          {page.page_type === 'text' && (
            <div className="flex-1 relative overflow-hidden">
              <div className="text-xs prose text-muted-foreground space-y-2 overflow-hidden"
                dangerouslySetInnerHTML={{ __html: excerpt }}
              >
              </div>
              {/* Gradient fade out effect */}
              <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-background to-transparent" />
            </div>
          )}

          {/* Footer */}
          <div className="mt-auto pt-2 flex items-center justify-between text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              {page.page_type === 'text' && <span>{wordCount} words</span>}
              {page.page_type === 'text' && (
                <AudioPlayer 
                  pageId={page.id} 
                  content={page.html_content}
                  compact={true}
                />
              )}
            </div>
            <span className={`${page.page_type === 'section' ? 'mx-auto' : 'ml-auto'}`}>Page {page.page_index + 1}</span>
          </div>
        </CardContent>
      </div>

      {onDelete && (
        <Button
          variant="ghost"
          size="icon"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(page.id);
          }}
          className="absolute top-2 right-2 text-destructive opacity-0 group-hover:opacity-100 transition-opacity hover:text-destructive hover:bg-destructive/10"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      )}
    </Card>
  );
}); 