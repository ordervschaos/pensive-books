import { Button } from "@/components/ui/button";
import { ArrowRight, Plus, Undo2, ArrowLeft } from "lucide-react";
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
}

export const PageNavigation = ({ 
  bookId, 
  currentIndex, 
  totalPages, 
  onNavigate,
  nextPageTitle,
  bookTitle = 'Untitled',
  isEditing = false,
  onNewPage,
  canEdit = false
}: PageNavigationProps) => {
  const navigate = useNavigate();

  // Handle case where there are no pages yet
  const displayCurrentIndex = totalPages > 0 ? currentIndex + 1 : 0;
  const displayTotalPages = Math.max(totalPages, 0);

  const isLastPage = currentIndex >= totalPages - 1;

  const handleNextClick = () => {
    if (isLastPage) {
      navigate(`/book/${bookId}`);
    } else {
      onNavigate(currentIndex + 1);
    }
  };

  return (
    <div className="flex max-w-screen-lg items-center justify-center gap-2 flex-col">
      <span className="text-sm text-muted-foreground"> Page {displayCurrentIndex}/{displayTotalPages} </span>
      
      <div className="flex flex-row items-center gap-2 justify-center w-full">
        <Button
          variant="ghost"
          onClick={() => navigate(`/book/${bookId}`)}
          className="flex items-center gap-2 px-4 py-4 rounded-full bg-background border-border max-w-[80vw]"
        >
          <ArrowLeft className="h-5 w-5 flex-shrink-0" />
        </Button>
        <Button
          variant="outline"
          onClick={handleNextClick}
          className="flex items-center gap-2 px-4 py-4 rounded-full bg-background border-border max-w-[80vw]"
          disabled={currentIndex === -1}
        >
          <span className="text-lg truncate">
            {isLastPage ? `Table of contents: ${bookTitle}` : `Next: ${nextPageTitle || 'Untitled'}`}
          </span>
          {isLastPage ? (
            <Undo2 className="h-5 w-5 flex-shrink-0" />
          ) : (
            <ArrowRight className="h-5 w-5 flex-shrink-0" />
          )}
        </Button>

        {canEdit && onNewPage && (
          <Button
            variant="ghost"
            onClick={() => onNewPage(currentIndex)}
            className="px-4 py-4 rounded-full bg-background border-border"
            title="Add new page"
          >
            <Plus className="h-5 w-5" />
          </Button>
        )}
      </div>
    </div>
  );
};