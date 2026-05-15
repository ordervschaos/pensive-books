import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import { Flashcard } from "@/hooks/use-flashcards";
import { cn } from "@/lib/utils";

interface FlashcardModalProps {
  flashcard: Flashcard | null;
  flashcards: Flashcard[];
  currentIndex: number;
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (index: number) => void;
}

export const FlashcardModal = ({ flashcard, flashcards, currentIndex, isOpen, onClose, onNavigate }: FlashcardModalProps) => {
  const [isFlipped, setIsFlipped] = useState(true);

  const handleFlip = () => {
    setIsFlipped(!isFlipped);
  };

  const handleClose = () => {
    setIsFlipped(false);
    onClose();
  };

  const handlePrevious = () => {
    if (currentIndex > 0) {
      setIsFlipped(false); // Show front when navigating
      onNavigate(currentIndex - 1);
    }
  };

  const handleNext = () => {
    if (currentIndex < flashcards.length - 1) {
      setIsFlipped(false); // Show front when navigating
      onNavigate(currentIndex + 1);
    }
  };

  if (!flashcard) return null;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-hidden p-4">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <div className="flex items-start gap-2 text-xs text-muted-foreground/50">
              <span>Flashcard</span>
              <span># {currentIndex + 1} of {flashcards.length}</span>
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col items-center space-y-2 py-1">
          {/* Flashcard content */}
          <div 
            className="w-full min-h-[250px] flex items-center justify-center text-center relative cursor-pointer group"
            onClick={handleFlip}
          >
            <div className={cn(
              "w-full flex items-center justify-center p-4 transition-all duration-500 transform",
              isFlipped ? "rotate-y-180 opacity-0 absolute" : "rotate-y-0 opacity-100"
            )}>
              <div className="w-full max-w-lg">
                <div className="text-xs text-muted-foreground/40 mb-1 font-medium">FRONT</div>
                <div className="text-lg font-medium whitespace-pre-wrap break-words leading-relaxed">
                  {flashcard.front}
                </div>
              </div>
            </div>
            
            <div className={cn(
              "w-full flex items-center justify-center p-4 transition-all duration-500 transform",
              isFlipped ? "rotate-y-0 opacity-100" : "rotate-y-180 opacity-0 absolute"
            )}>
              <div className="w-full max-w-lg">
                <div className="text-xs text-muted-foreground/40 mb-1 font-medium">BACK</div>
                <div className="text-lg font-medium whitespace-pre-wrap break-words leading-relaxed">
                  {flashcard.back}
                </div>
              </div>
            </div>
          </div>

          {/* Navigation and instruction in one row */}
          <div className="flex items-center justify-between w-full max-w-lg">
            <Button
              variant="ghost"
              size="sm"
              onClick={handlePrevious}
              disabled={currentIndex === 0}
              className="flex items-center gap-1 text-xs px-2 py-1 opacity-50 hover:opacity-70 disabled:opacity-20"
            >
              <ChevronLeft className="h-3 w-3" />
              Prev
            </Button>
            
            <p className="text-xs text-muted-foreground/30">
              Click to flip
            </p>
            
            <Button
              variant="ghost"
              size="sm"
              onClick={handleNext}
              disabled={currentIndex === flashcards.length - 1}
              className="flex items-center gap-1 text-xs px-2 py-1 opacity-50 hover:opacity-70 disabled:opacity-20"
            >
              Next
              <ChevronRight className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
