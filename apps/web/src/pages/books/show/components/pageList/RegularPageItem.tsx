import { Trash2, BookmarkCheck, MoreVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageItemProps } from "./types";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";
import {
  getPageStatus,
  getPageWords,
  STATUS_LABEL,
  STATUS_PILL,
  STATUS_DOT_COLOR,
} from "./pageUtils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export const RegularPageItem = forwardRef<HTMLDivElement, PageItemProps>(({ page, onNavigate, onDelete, isBookmarked, sectionNumber, sectionMeta, displayNumber, flat }, ref) => {
  if (page.page_type === "section") {
    return (
      <div
        ref={ref}
        className={cn(
          "flex items-baseline justify-between gap-4 border-b border-[hsl(var(--pv-border-soft))] px-3 pb-2",
          flat ? "pt-4 first:pt-1" : "pt-7 first:pt-2"
        )}
      >
        <button
          type="button"
          className="min-w-0 text-left"
          onClick={() => onNavigate(page.id)}
        >
          <h3 className="pv-display line-clamp-2 break-words text-[22px] italic leading-tight text-foreground transition-colors hover:text-[hsl(var(--pv-text-muted))]">
            {page.title || `Untitled Section ${sectionNumber ?? 1}`}
          </h3>
        </button>
        <div className="flex shrink-0 items-baseline gap-3">
          {sectionMeta && (
            <span className="pv-mono text-[11px] uppercase tracking-[0.15em] text-[hsl(var(--pv-text-faint))]">
              {sectionMeta.pages} {sectionMeta.pages === 1 ? "page" : "pages"} ·{" "}
              {sectionMeta.words.toLocaleString()} w
            </span>
          )}
          {onDelete && <RowMenu onDelete={() => onDelete(page.id)} />}
        </div>
      </div>
    );
  }

  const status = getPageStatus(page);
  const words = getPageWords(page);

  return (
    <div
      ref={ref}
      className="flex items-center gap-3 border-b border-dashed border-[hsl(var(--pv-border-soft))] px-3 py-3 transition-colors last:border-0 hover:bg-[hsl(var(--pv-surface-2))]/50"
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-3.5 text-left"
        onClick={() => onNavigate(page.id)}
      >
        <span
          className="pv-mono w-7 shrink-0 text-[11px] tabular-nums text-[hsl(var(--pv-text-faint))]"
        >
          {String(displayNumber ?? page.page_index + 1).padStart(2, "0")}
        </span>
        <span
          className={cn(
            "h-[9px] w-[9px] shrink-0 rounded-full",
            status === "blank" && "border-[1.5px] border-dashed border-[hsl(var(--pv-text-faint))]"
          )}
          style={status === "blank" ? undefined : { background: STATUS_DOT_COLOR[status] }}
          aria-hidden
        />
        <h3
          className={cn(
            "min-w-0 flex-1 truncate pv-serif text-[18px] text-foreground",
            status === "blank" && "italic text-[hsl(var(--pv-text-muted))]"
          )}
        >
          {page.title || `Untitled Page ${page.page_index + 1}`}
        </h3>
        {isBookmarked && (
          <span className="pv-mono inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-[10px] uppercase tracking-[0.15em] text-[hsl(var(--pv-text-muted))]">
            <BookmarkCheck className="h-3 w-3" />
            bookmark
          </span>
        )}
        <span
          className={cn(
            "pv-mono shrink-0 rounded-full px-2 py-0.5 text-[9.5px] font-medium uppercase tracking-[0.14em]",
            STATUS_PILL[status]
          )}
        >
          {STATUS_LABEL[status]}
        </span>
        <span className="pv-mono w-12 shrink-0 text-right text-[11px] tabular-nums text-[hsl(var(--pv-text-muted))]">
          {words ? `${words.toLocaleString()} w` : "—"}
        </span>
      </button>
      {onDelete && <RowMenu onDelete={() => onDelete(page.id)} />}
    </div>
  );
});

function RowMenu({ onDelete }: { onDelete: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={(e) => e.stopPropagation()}
          className="h-8 w-8 shrink-0 rounded-full text-[hsl(var(--pv-text-muted))] hover:bg-[hsl(var(--pv-surface-2))] hover:text-foreground"
        >
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="flex items-center gap-2 text-destructive focus:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
          <span>Delete Page</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
