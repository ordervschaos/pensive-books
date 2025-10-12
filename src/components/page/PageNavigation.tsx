import { Button } from "@/components/ui/button";
import { useEffect } from "react";
import { ArrowRight, Plus, Undo2, ArrowLeft, TableOfContents, List, Check, Pencil } from "lucide-react";
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
      <div className="flex flex-row items-center gap-2 justify-center w-full">
        <div className="flex items-center gap-2 justify-center">
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleSidebar}
            className="flex items-center gap-1 px-2 py-0.5 h-6 rounded-full bg-background border-border max-w-[80vw] text-[10px]"
          >
            <span className="text-muted-foreground">Page {displayCurrentIndex}/{displayTotalPages}</span>
          </Button>
          
        </div>

        {canEdit && (
          isEditing ? (
            <div className="flex items-center gap-2 justify-center">
              <Button variant="default" size="sm" className="rounded-full" onClick={() => setIsEditing(false)}>
                <Check className="h-4 w-4 flex-shrink-0" /> Done
              </Button>
            </div>
          ):(
            <div className="flex items-center text-muted-foreground text-xs gap-2 justify-center">
              <Button variant="ghost" size="sm" className="rounded-full h-6 px-2 text-[10px]" onClick={() => setIsEditing(true)}>
                <Pencil className="h-2.5 w-2.5 flex-shrink-0" /> Edit
              </Button>
            </div>  
          )
        )}
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

  
     
    </div>
  );
};
