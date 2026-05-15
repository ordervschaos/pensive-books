import { Trash2, BookmarkCheck, MoreVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageItemProps } from "./types";
import { forwardRef } from "react";
import { getWordCountFromContent } from "@/utils/tiptapHelpers";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export const RegularPageItem = forwardRef<HTMLDivElement, PageItemProps>(({ page, onNavigate, onDelete, isBookmarked, sectionNumber }, ref) => {
  const wordCount = page.page_type === 'text' && page.content
    ? getWordCountFromContent(page.content)
    : 0;

  if (page.page_type === "section") {
    return (
      <div ref={ref} className="flex items-center gap-2 border-b border-border px-4 py-3 last:border-0">
        <button
          type="button"
          className="flex flex-1 items-center justify-between gap-4 rounded-md bg-muted/40 px-4 py-3 text-left transition-colors hover:bg-accent/40"
          onClick={() => onNavigate(page.id)}
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
    );
  }

  return (
    <div 
      ref={ref}
      className="flex items-center justify-between gap-4 border-b border-border px-6 py-4 transition-colors hover:bg-accent/30 last:border-0"
    >
      <div 
        className="flex-1 cursor-pointer"
        onClick={() => onNavigate(page.id)}
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="line-clamp-2 break-words text-base font-medium text-foreground">
              {page.title || `Untitled Page ${page.page_index + 1}`}
            </h3>
            {isBookmarked && (
              <Badge variant="secondary" className="h-5 gap-1 px-2">
                <BookmarkCheck className="h-3 w-3" />
              </Badge>
            )}
          </div>
          <span className="shrink-0 text-sm text-muted-foreground">
            {wordCount} words
          </span>
        </div>
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
  );
}); 
