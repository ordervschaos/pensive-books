import { Button } from "@/components/ui/button";
import { useEffect } from "react";
import { ArrowRight, Plus, Undo2, ArrowLeft, TableOfContents, List, Check } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useSidebar } from "@/components/ui/sidebar";
import { PreloadLink } from "./PreloadLink";


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
  bookTitle = 'Untitled',
  onNewPage,
  canEdit = false,
  nextPageId,
  isEditing = false,
  setIsEditing
}: PageNavigationProps) => {
  const navigate = useNavigate();
  const { toggleSidebar } = useSidebar();

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
    <div className="flex max-w-screen-lg items-center justify-center gap-4 flex-col my-4">
      <div className="flex items-center gap-2 justify-center">
        <Button
          variant="ghost"
          onClick={toggleSidebar}
          className="flex items-center gap-2 px-4 py-4 rounded-full bg-background border-border max-w-[80vw]"
        >
          <span className="text-sm text-muted-foreground">Page {displayCurrentIndex}/{displayTotalPages}</span>
        </Button>
        
      </div>

      {!isEditing && (
        <div className="flex flex-row items-center gap-2 justify-center w-full">
        <Button
          variant="ghost"
          onClick={() => onNavigate(currentIndex - 1)}
          className="flex items-center gap-2 px-4 py-4 rounded-full bg-background border-border max-w-[80vw]"
        >
          <ArrowLeft className="h-5 w-5 flex-shrink-0" />
        </Button>
        
        {isLastPage ? (
          <Button
            variant="outline"
            onClick={() => navigate(`/book/${bookId}`)}
            className="flex items-center gap-2 px-4 py-4 rounded-full bg-background border-border max-w-[80vw]"
          >
            <span className="text-lg truncate">
              Table of contents: {bookTitle}
            </span>
            <Undo2 className="h-5 w-5 flex-shrink-0" />
          </Button>
        ) : nextPageId ? (
          <Button
            variant="outline"
            onClick={() => onNavigate(currentIndex + 1)}
            className="flex items-center gap-2 px-4 py-4 rounded-full bg-background border-border max-w-[80vw]"
          >
            <span className="text-lg truncate">
              Next: {nextPageTitle || 'Untitled'}
            </span>
            <ArrowRight className="h-5 w-5 flex-shrink-0" />
          </Button>
        ) : (
          <Button
            variant="outline"
            onClick={handleNextClick}
            className="flex items-center gap-2 px-4 py-4 rounded-full bg-background border-border max-w-[80vw]"
          >
            <span className="text-lg truncate">
              Next: {nextPageTitle || 'Untitled'}
            </span>
            <ArrowRight className="h-5 w-5 flex-shrink-0" />
          </Button>
        )}

        {canEdit && onNewPage && (
          <Button
            variant="ghost"
            onClick={() => onNewPage()}
            className="px-4 py-4 rounded-full bg-background border-border"
            title="Add new page"
          >
            <Plus className="h-5 w-5" />
          </Button>
        )}
      </div>
      )}

      {
        isEditing && (
          <div className="flex items-center gap-2 justify-center">
            <Button variant="default" className="rounded-full" onClick={() => setIsEditing(false)}>
              <Check className="h-5 w-5 flex-shrink-0" /> I'm done editing
            </Button>
          </div>
        )
      }
     
    </div>
  );
};
