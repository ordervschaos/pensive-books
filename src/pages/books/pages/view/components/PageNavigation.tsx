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
    <div className="mt-8">
      {/* Navigation Footer */}
      <div className=" rounded-lg p-4 md:p-6">
        {/* Navigation buttons row: Previous | Add | Next */}
        <div className="flex items-center justify-between gap-2 mb-4">
          {/* Previous Button */}
          <Button
            variant="outline"
            onClick={() => onNavigate(currentIndex - 1)}
            disabled={currentIndex === 0}
            className="flex items-center gap-2 px-4 md:px-6 py-2"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Previous</span>
          </Button>

          {/* Add button (center) */}
          {canEdit && onNewPage && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onNewPage()}
              className="h-8 w-8 p-0 rounded-full"
              title="Add new page after current"
            >
              <Plus className="h-4 w-4" />
            </Button>
          )}

          {/* Next Button or Back to Contents */}
          {isLastPage ? (
            <Button
              onClick={() => navigate(`/books/${bookId}`)}
              className="flex items-center gap-2 px-4 md:px-6 py-2"
            >
              <TableOfContents className="h-4 w-4" />
              <span className="hidden sm:inline">Back to Contents</span>
            </Button>
          ) : (
            <Button
              onClick={handleNextClick}
              className="flex items-center gap-2 px-4 md:px-6 py-2"
            >
              <span className="hidden sm:inline">Next</span>
              <ArrowRight className="h-4 w-4" />
            </Button>
          )}
        </div>

        {/* Page counter and Next page preview row */}
        <div className="flex items-center justify-between gap-2">
          {/* Page counter */}
          <div className="text-sm text-muted-foreground">
            Page {displayCurrentIndex} / {displayTotalPages}
          </div>

          {/* Next page preview */}
          {!isLastPage && nextPageTitle && (
            <div className="text-sm text-muted-foreground">
              Next: <span className="font-medium text-foreground">{nextPageTitle}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
