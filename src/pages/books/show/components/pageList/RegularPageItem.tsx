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

export const RegularPageItem = forwardRef<HTMLDivElement, PageItemProps>(({ page, onNavigate, onDelete, isBookmarked }, ref) => {
  const wordCount = page.page_type === 'text' && page.content
    ? getWordCountFromContent(page.content)
    : 0;

  return (
    <div 
      ref={ref}
      className="flex items-center justify-between py-4 px-6 hover:bg-accent/5 transition-colors border-b border-border last:border-0"
    >
      <div 
        className="flex-1 cursor-pointer"
        onClick={() => onNavigate(page.id)}
      >
        <div className={`flex items-center ${page.page_type === 'section' ? 'justify-center min-h-[60px]' : 'justify-between'}`}>
          <div className="flex items-center gap-2">
            <h3 className={`text-lg ${page.page_type === 'section' ? 'font-bold text-xl text-center' : ''}`}>
              {page.title || `Untitled Page ${page.page_index + 1}`}
            </h3>
            {isBookmarked && (
              <Badge variant="default" color="green" className="h-5">
                <BookmarkCheck className="h-3 w-3 mr-1" />
              </Badge>
            )}
          </div>
          {page.page_type === 'text' && (
            <span className="text-sm text-muted-foreground">
              {wordCount} words
            </span>
          )}
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
              className="ml-2 h-8 w-8 hover:bg-muted"
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