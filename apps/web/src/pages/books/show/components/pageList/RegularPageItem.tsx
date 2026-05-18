import { Trash2, BookmarkCheck, MoreVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
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
      <div
        ref={ref}
        className="flex items-center gap-2 border-b border-dashed border-[hsl(var(--pv-border-soft))] px-3 py-3 last:border-0"
      >
        <button
          type="button"
          className="flex flex-1 items-baseline justify-between gap-4 rounded-xl bg-[hsl(var(--pv-surface-2))]/60 px-4 py-3 text-left transition-colors hover:bg-[hsl(var(--pv-surface-2))]"
          onClick={() => onNavigate(page.id)}
        >
          <div className="min-w-0">
            <p className="pv-eyebrow">Section {sectionNumber ?? 1}</p>
            <h3 className="pv-display mt-1 line-clamp-2 break-words text-[20px] italic text-foreground">
              {page.title || `Untitled Section ${sectionNumber ?? 1}`}
            </h3>
          </div>
          {isBookmarked && (
            <span className="pv-mono inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-[10px] uppercase tracking-[0.15em] text-[hsl(var(--pv-text-muted))]">
              <BookmarkCheck className="h-3 w-3" />
              bookmark
            </span>
          )}
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
                className="h-8 w-8 rounded-full text-[hsl(var(--pv-text-muted))] hover:bg-[hsl(var(--pv-surface-2))] hover:text-foreground"
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
      className="flex items-center justify-between gap-4 border-b border-dashed border-[hsl(var(--pv-border-soft))] px-6 py-3.5 transition-colors hover:bg-[hsl(var(--pv-surface-2))]/50 last:border-0"
    >
      <div
        className="flex-1 cursor-pointer"
        onClick={() => onNavigate(page.id)}
      >
        <div className="flex items-baseline justify-between gap-4">
          <div className="flex min-w-0 items-baseline gap-2.5">
            <span
              className="pv-mono shrink-0 text-[11px] tabular-nums text-[hsl(var(--pv-text-faint))]"
              style={{ fontVariantNumeric: "oldstyle-nums" }}
            >
              {page.page_index + 1}.
            </span>
            <h3 className="pv-serif line-clamp-2 break-words text-[15px] text-foreground">
              {page.title || `Untitled Page ${page.page_index + 1}`}
            </h3>
            {isBookmarked && (
              <span className="pv-mono inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-[10px] uppercase tracking-[0.15em] text-[hsl(var(--pv-text-muted))]">
                <BookmarkCheck className="h-3 w-3" />
                bookmark
              </span>
            )}
          </div>
          <span className="pv-mono shrink-0 text-[11px] uppercase tracking-[0.15em] text-[hsl(var(--pv-text-faint))]">
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
              className="h-8 w-8 rounded-full text-[hsl(var(--pv-text-muted))] hover:bg-[hsl(var(--pv-surface-2))] hover:text-foreground"
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
