import { Trash2, BookmarkCheck, MoreVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AudioPlayer } from "@/pages/books/pages/view/components/AudioPlayer";
import { PageItemProps } from "./types";
import { forwardRef } from "react";
import { getWordCountFromContent, convertJSONToHTML } from "@/utils/tiptapHelpers";
import { sanitizeHtml } from "@/lib/sanitize";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export const PageCard = forwardRef<HTMLDivElement, PageItemProps>(({ page, onNavigate, onDelete, isBookmarked, sectionNumber }, ref) => {
  const wordCount = page.page_type === 'text' && page.content
    ? getWordCountFromContent(page.content)
    : 0;

  const htmlContent = page.content ? convertJSONToHTML(page.content) : '';
  const excerpt = htmlContent ? htmlContent.replace(/<h1[^>]*>.*?<\/h1>/g, '') : '';

  if (page.page_type === "section") {
    return (
      <div ref={ref} className="col-span-full">
        <div className="relative flex items-start gap-2 rounded-md border border-border/60 bg-muted/30 p-2 transition-colors hover:bg-accent/20">
          <button
            type="button"
            onClick={() => onNavigate(page.id)}
            className="flex flex-1 items-center justify-between gap-4 rounded-md px-3 py-3 text-left"
          >
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Section</p>
              <h3 className="mt-1 line-clamp-2 break-words text-sm font-semibold uppercase tracking-wide text-foreground">
                {page.title || `Untitled Section ${sectionNumber ?? 1}`}
              </h3>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {isBookmarked && (
                <Badge variant="secondary" className="h-5 gap-1 px-2">
                  <BookmarkCheck className="h-3 w-3" />
                </Badge>
              )}
              <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                Section {sectionNumber ?? 1}
              </Badge>
            </div>
          </button>

          {onDelete && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                  className="h-8 w-8 hover:bg-accent"
                >
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(page.id);
                  }}
                  className="text-destructive focus:text-destructive flex items-center gap-2"
                >
                  <Trash2 className="h-4 w-4" />
                  <span>Delete Page</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
    );
  }

  return (
    <Card 
      ref={ref}
      onClick={() => onNavigate(page.id)}
      className="group relative cursor-pointer overflow-hidden border border-border/60 bg-card/80 transition-all hover:shadow-md"
    >
      <div className="aspect-[3/4] relative">
        <CardContent className="absolute inset-0 p-4 flex flex-col overflow-hidden">
          {/* Page Header */}
          <div className="mb-3 border-b border-border/50 pb-3">
            <div className="flex items-start justify-between gap-2">
              <h3 className="line-clamp-2 text-base font-medium text-foreground">
                {page.title || `Untitled Page ${page.page_index + 1}`}
              </h3>
              {isBookmarked && (
                <Badge variant="secondary" className="h-5 shrink-0 gap-1 px-2">
                  <BookmarkCheck className="h-3 w-3" />
                </Badge>
              )}
            </div>
          </div>
          
          {/* Page Content Preview - Only show for text pages */}
          <div className="relative flex-1 overflow-hidden">
            <div
              className="prose space-y-2 overflow-hidden text-xs text-muted-foreground"
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(excerpt) }}
            />
            <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-card to-transparent" />
          </div>

          {/* Footer */}
          <div className="mt-auto pt-2 flex items-center justify-between text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <span>{wordCount} words</span>
              <AudioPlayer
                pageId={page.id}
                content={htmlContent}
                compact={true}
              />
            </div>
            <span className="ml-auto">Page {page.page_index + 1}</span>
          </div>
        </CardContent>
      </div>

      {onDelete && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => {
                e.stopPropagation();
              }}
              className="absolute top-2 right-2 h-8 w-8 opacity-0 transition-opacity hover:bg-accent group-hover:opacity-100"
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                onDelete(page.id);
              }}
              className="text-destructive focus:text-destructive flex items-center gap-2"
            >
              <Trash2 className="h-4 w-4" />
              <span>Delete Page</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </Card>
  );
}); 
