import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface PageNavigationProps {
  bookId: string;
  currentIndex: number;
  totalPages: number;
  onNavigate: (index: number) => void;
}

export const PageNavigation = ({ bookId, currentIndex, totalPages, onNavigate }: PageNavigationProps) => {
  const navigate = useNavigate();

  return (
    <div className="flex items-center justify-between">
      <Button variant="ghost" onClick={() => navigate(`/book/${bookId}`)}>
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back to Book
      </Button>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          onClick={() => onNavigate(currentIndex - 1)}
          disabled={currentIndex <= 0}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm text-muted-foreground">
          Page {currentIndex + 1} of {totalPages}
        </span>
        <Button
          variant="outline"
          onClick={() => onNavigate(currentIndex + 1)}
          disabled={currentIndex === -1 || currentIndex >= totalPages - 1}
        >
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};