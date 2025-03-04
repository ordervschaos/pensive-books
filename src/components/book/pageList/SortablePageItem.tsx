import { GripVertical, BookmarkCheck } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { Badge } from "@/components/ui/badge";
import { PageItemProps } from "./types";

export const SortablePageItem = ({ page, onNavigate, isBookmarked }: PageItemProps) => {
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

  const wordCount = page.html_content && page.page_type === 'text' ? 
    page.html_content.replace(/<[^>]*>/g, '').trim().split(/\s+/).length : 
    0;

  return (
    <div 
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 py-4 px-6 hover:bg-accent/5 transition-colors group border-b border-border last:border-0"
    >
      <div {...attributes} {...listeners} className="cursor-grab hover:text-primary">
        <GripVertical className="h-5 w-5 transition-opacity" />
      </div>
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
              <Badge variant="default" className="h-5">
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
    </div>
  );
}; 