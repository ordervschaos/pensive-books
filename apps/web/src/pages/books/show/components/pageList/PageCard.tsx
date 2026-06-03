import { Trash2, BookmarkCheck, MoreVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageItemProps } from "./types";
import { forwardRef } from "react";
import { convertJSONToHTML } from "@/utils/tiptapHelpers";
import { sanitizeHtml } from "@/lib/sanitize";
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

export const PageCard = forwardRef<HTMLDivElement, PageItemProps>(({ page, onNavigate, onDelete, isBookmarked, sectionNumber }, ref) => {
  const status = getPageStatus(page);
  const words = getPageWords(page);
  const objective = page.metadata?.objective;

  const htmlContent = page.content ? convertJSONToHTML(page.content) : '';
  const excerpt = htmlContent ? htmlContent.replace(/<h1[^>]*>.*?<\/h1>/g, '') : '';

  if (page.page_type === "section") {
    return (
      <div ref={ref} className="col-span-full">
        <div className="relative flex items-baseline gap-2 rounded-xl border border-[hsl(var(--pv-border-soft))] bg-[hsl(var(--pv-surface-2))]/60 p-2 transition-colors hover:bg-[hsl(var(--pv-surface-2))]">
          <button
            type="button"
            onClick={() => onNavigate(page.id)}
            className="flex flex-1 items-baseline justify-between gap-4 rounded-xl px-3 py-3 text-left"
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
                  className="h-8 w-8 rounded-full text-[hsl(var(--pv-text-muted))] hover:bg-background hover:text-foreground"
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
    <div
      ref={ref}
      onClick={() => onNavigate(page.id)}
      className="group relative cursor-pointer overflow-hidden rounded-xl border border-[hsl(var(--pv-border-soft))] bg-[hsl(var(--pv-surface-2))]/40 transition-all hover:border-border hover:bg-[hsl(var(--pv-surface-2))]"
    >
      <div className="relative aspect-[3/4]">
        <div className="absolute inset-0 flex flex-col overflow-hidden p-4">
          {/* Page Header */}
          <div className="mb-3 border-b border-dashed border-[hsl(var(--pv-border-soft))] pb-3">
            <div className="flex items-baseline justify-between gap-2">
              <div className="flex min-w-0 items-baseline gap-2">
                <span
                  className={cn(
                    "mt-0.5 h-[9px] w-[9px] shrink-0 self-center rounded-full",
                    status === "blank" && "border-[1.5px] border-dashed border-[hsl(var(--pv-text-faint))]"
                  )}
                  style={status === "blank" ? undefined : { background: STATUS_DOT_COLOR[status] }}
                  aria-hidden
                />
                <h3
                  className={cn(
                    "pv-serif line-clamp-2 text-[15px] text-foreground",
                    status === "blank" && "italic text-[hsl(var(--pv-text-muted))]"
                  )}
                >
                  {page.title || `Untitled Page ${page.page_index + 1}`}
                </h3>
              </div>
              {isBookmarked && (
                <span className="pv-mono inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-[10px] uppercase tracking-[0.15em] text-[hsl(var(--pv-text-muted))]">
                  <BookmarkCheck className="h-3 w-3" />
                </span>
              )}
            </div>
          </div>

          {/* Preview — prose when written, else the page's objective (its plan) */}
          <div className="relative flex-1 overflow-hidden">
            {status === "written" ? (
              <div
                className="prose pv-serif space-y-2 overflow-hidden text-[12px] italic text-[hsl(var(--pv-text-muted))]"
                dangerouslySetInnerHTML={{ __html: sanitizeHtml(excerpt) }}
              />
            ) : objective ? (
              <p className="pv-serif overflow-hidden text-[12.5px] italic leading-relaxed text-[hsl(var(--pv-text-muted))]">
                ◎ {objective}
              </p>
            ) : (
              <p className="pv-serif text-[12.5px] italic text-[hsl(var(--pv-text-faint))]">
                No objective yet — plan it or write into it.
              </p>
            )}
            {status === "written" && (
              <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-[hsl(var(--pv-surface-2))] to-transparent" />
            )}
          </div>

          {/* Footer */}
          <div className="mt-auto flex items-center justify-between gap-2 pt-2">
            <span
              className={cn(
                "pv-mono shrink-0 rounded-full px-2 py-0.5 text-[9.5px] font-medium uppercase tracking-[0.14em]",
                STATUS_PILL[status]
              )}
            >
              {STATUS_LABEL[status]}
            </span>
            <div className="pv-mono flex items-center gap-2 text-[10.5px] uppercase tracking-[0.15em] text-[hsl(var(--pv-text-faint))]">
              <span className="tabular-nums">{words ? `${words.toLocaleString()} w` : "—"}</span>
            </div>
          </div>
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
              className="absolute right-2 top-2 h-8 w-8 rounded-full text-[hsl(var(--pv-text-muted))] opacity-0 transition-opacity hover:bg-background hover:text-foreground group-hover:opacity-100"
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
