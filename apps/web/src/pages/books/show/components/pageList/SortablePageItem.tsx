import { GripVertical, BookmarkCheck } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { Badge } from "@/components/ui/badge";
import { PageItemProps } from "./types";
import { forwardRef } from "react";
import { getWordCountFromContent } from "@/utils/tiptapHelpers";

export const SortablePageItem = forwardRef<HTMLDivElement, PageItemProps>(({ page, onNavigate, isBookmarked, sectionNumber }, ref) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: page.id });

  const style = transform ? {
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
    transition,
  } : undefined;

  const wordCount = page.page_type === 'text' && page.content
    ? getWordCountFromContent(page.content)
    : 0;

  // Combine the sortable ref with our custom ref
  const combinedRef = (node: HTMLDivElement) => {
    setNodeRef(node);
    if (ref) {
      if (typeof ref === 'function') {
        ref(node);
      } else {
        ref.current = node;
      }
    }
  };

  if (page.page_type === "section") {
    return (
      <div
        ref={combinedRef}
        style={style}
        className="group flex items-center gap-3 border-b border-border px-4 py-3 transition-colors last:border-0"
      >
        <div {...attributes} {...listeners} className="cursor-grab text-muted-foreground hover:text-foreground">
          <GripVertical className="h-5 w-5 transition-opacity" />
        </div>
        <button
          type="button"
          className="flex flex-1 items-center justify-between gap-4 rounded-md bg-muted/40 px-4 py-3 text-left transition-colors hover:bg-accent/40"
          onClick={() => onNavigate(page.id)}
        >
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Section</p>
            <h3 className="mt-1 line-clamp-2 break-words text-sm font-semibold uppercase tracking-wide text-foreground">
              {page.title || `Untitled Section ${page.page_index + 1}`}
            </h3>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {isBookmarked && (
              <Badge variant="secondary" className="h-5 gap-1 px-2">
                <BookmarkCheck className="h-3 w-3" />
              </Badge>
            )}
            <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
              Section {sectionNumber ?? page.page_index + 1}
            </Badge>
          </div>
        </button>
      </div>
    );
  }

  return (
    <div 
      ref={combinedRef}
      style={style}
      className="group flex items-center gap-3 border-b border-border px-6 py-4 transition-colors hover:bg-accent/30 last:border-0"
    >
      <div {...attributes} {...listeners} className="cursor-grab text-muted-foreground hover:text-foreground">
        <GripVertical className="h-5 w-5 transition-opacity" />
      </div>
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
    </div>
  );
});
