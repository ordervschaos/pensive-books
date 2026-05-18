import { Button } from "@/components/ui/button";
import { ArrowRight, Plus, ArrowLeft, TableOfContents } from "lucide-react";
import { useNavigate } from "react-router-dom";


interface PageNavigationProps {
  bookId: string;
  currentIndex: number;
  totalPages: number;
  onNavigate: (index: number) => void;
  nextPageTitle?: string;
  bookTitle?: string;
  isEditing?: boolean;
  onNewPage?: (insertAfterIndex?: number) => void;
  canEdit?: boolean;
  nextPageId?: number;
  setIsEditing?: (isEditing: boolean) => void;
}

export const PageNavigation = ({
  bookId,
  currentIndex,
  totalPages,
  onNavigate,
  nextPageTitle,
  onNewPage,
  canEdit = false,
}: PageNavigationProps) => {
  const navigate = useNavigate();

  // Handle case where there are no pages yet
  const displayCurrentIndex = totalPages > 0 ? currentIndex + 1 : 0;
  const displayTotalPages = Math.max(totalPages, 0);

  const isLastPage = currentIndex >= totalPages - 1;
 
  const handleNextClick = () => {
    if (isLastPage) {
      navigate(`/books/${bookId}`);
    } else {
      onNavigate(currentIndex + 1);
    }
  };

 

  return (
    <div className="mt-14">
      <div className="mx-auto grid max-w-[640px] grid-cols-[1fr_auto_1fr] items-center gap-4 border-t border-border pt-7">
        {/* Previous Button — paper pill */}
        <Button
          variant="outline"
          onClick={() => onNavigate(currentIndex - 1)}
          disabled={currentIndex === 0}
          className="pv-serif justify-self-start h-11 gap-2 rounded-full border-border bg-transparent px-5 text-[14px] tracking-[0.01em] text-foreground disabled:opacity-40"
        >
          <ArrowLeft className="h-4 w-4" />
          <span className="hidden sm:inline">Previous page</span>
        </Button>

        {/* Add button (center) */}
        {canEdit && onNewPage ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onNewPage()}
            className="h-9 w-9 rounded-full border-border bg-[hsl(var(--pv-surface-2))] p-0 text-[hsl(var(--pv-text-muted))]"
            title="Add new page after current"
          >
            <Plus className="h-4 w-4" />
          </Button>
        ) : (
          <span />
        )}

        {/* Next Button or Back to Contents — primary pill */}
        {isLastPage ? (
          <Button
            onClick={() => navigate(`/books/${bookId}`)}
            className="pv-serif justify-self-end h-11 gap-2 rounded-full bg-foreground px-5 text-[14px] tracking-[0.01em] text-background hover:opacity-90"
          >
            <TableOfContents className="h-4 w-4" />
            <span className="hidden sm:inline">Back to Contents</span>
          </Button>
        ) : (
          <Button
            onClick={handleNextClick}
            className="pv-serif justify-self-end h-11 gap-2 rounded-full bg-foreground px-5 text-[14px] tracking-[0.01em] text-background hover:opacity-90"
          >
            <span className="hidden sm:inline">
              Next: {nextPageTitle ? <em className="ml-1">{nextPageTitle}</em> : "next page"}
            </span>
            <ArrowRight className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Page counter sub-row */}
      <div className="pv-mono mt-3 text-center text-[11px] uppercase tracking-[0.18em] text-[hsl(var(--pv-text-faint))]">
        page {displayCurrentIndex} of {displayTotalPages}
      </div>
    </div>
  );
};
