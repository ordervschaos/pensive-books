import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

interface ContinueReadingButtonProps {
  onClick: () => void;
  bookmarkedPageIndex: number | null;
  totalPages: number;
  className?: string;
}

export const ContinueReadingButton = ({
  onClick,
  bookmarkedPageIndex,
  totalPages,
  className
}: ContinueReadingButtonProps) => {
  const getContinueReadingText = () => {
    if (!totalPages) return "No pages available";
    
    if (bookmarkedPageIndex !== null && bookmarkedPageIndex < totalPages) {
      return (
        <>
          Continue reading <span className="text-xs font-normal">{bookmarkedPageIndex + 1}/{totalPages}</span>
        </>
      );
    }
    
    return `Start reading`;
  };

  if (!totalPages) return null;

  return (
    <Button 
      onClick={onClick}
      className={className}
    >
      {getContinueReadingText()}
      <ArrowRight className="ml-2 h-4 w-4" />
    </Button>
  );
};
