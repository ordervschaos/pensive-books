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

  // Handle case where there are no pages yet
  const displayCurrentIndex = totalPages > 0 ? currentIndex + 1 : 0;
  const displayTotalPages = Math.max(totalPages, 0);

  return (
    <div className="flex items-center justify-center">
      <div className="flex items-center gap-2">
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