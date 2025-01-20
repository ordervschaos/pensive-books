import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface PageNavigationProps {
  bookId: string;
  currentIndex: number;
  totalPages: number;
  onNavigate: (index: number) => void;
  nextPageTitle?: string;
  bookTitle?: string;
}

export const PageNavigation = ({ 
  bookId, 
  currentIndex, 
  totalPages, 
  onNavigate,
  nextPageTitle,
  bookTitle = 'Untitled'
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
    <div className="flex items-center justify-center">
      <Button
        variant="outline"
        onClick={handleNextClick}
        className="flex items-center gap-2 px-6 py-6 rounded-full bg-background border-border"
        disabled={currentIndex === -1}
      >
        <span className="text-lg">
          {isLastPage ? `Table of contents: ${bookTitle}` : `Next: ${nextPageTitle || 'Untitled'}`}
        </span>
        {displayCurrentIndex}/{displayTotalPages}
        <ArrowRight className="h-5 w-5" />
      </Button>
    </div>
  );
};