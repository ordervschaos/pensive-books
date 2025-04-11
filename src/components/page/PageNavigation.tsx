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
    onNavigate(currentIndex + 1);
  };

  const handleBackToTableOfContents = () => {
    navigate(`/book/${bookId}`);
  };

  const handleBackToPreviousPage = () => {
    onNavigate(currentIndex - 1);
  };

  return (
    <div className="flex max-w-screen-lg items-center justify-center gap-2 flex-col">
      <span className="text-sm text-muted-foreground"> Page {displayCurrentIndex}/{displayTotalPages} </span>
      
      <div className="flex flex-row items-center gap-2 justify-center w-full">
        {currentIndex > 0 && (
          <Button
            variant="ghost"
            onClick={handleBackToPreviousPage}
            className="flex items-center gap-2 px-4 py-4 rounded-full bg-background border-border max-w-[80vw]"
          >
            <ArrowLeft className="h-5 w-5 flex-shrink-0" />
          </Button>
        )}
        {!isLastPage && (
          <Button
            variant="outline"
            onClick={handleNextClick}
          className="flex items-center gap-2 px-4 py-4 rounded-full bg-background border-border max-w-[80vw]"
          disabled={currentIndex === -1}
        >
          <span className="text-lg truncate">
            {`Next: ${nextPageTitle || `Page ${currentIndex + 1}`}`}
          </span>
            <ArrowRight className="h-5 w-5 flex-shrink-0" />
          </Button>
        )}
        {isLastPage && (
           <Button
           variant="outline"
           onClick={handleBackToTableOfContents}
           className="px-4 py-4 rounded-full bg-background border-border"
           title="Back to table of contents"
         >
           <Undo2 className="h-5 w-5 flex-shrink-0" /> {`Back to table of contents: ${bookTitle}`}
         </Button>
        )}

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
      {!isLastPage && (
        <Button
          variant="muted"
          onClick={handleBackToTableOfContents}
          className="px-4 py-4 rounded-full mt-12 bg-background border-border"
          title="Back to table of contents"
        >
          <Undo2 className="h-5 w-5 flex-shrink-0" /> {`Back to table of contents: ${bookTitle}`}
        </Button>
      )}
    </div>
  );
};