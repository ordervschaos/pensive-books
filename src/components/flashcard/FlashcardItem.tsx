import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Edit, Trash2, RotateCcw, Eye } from "lucide-react";
import { Flashcard } from "@/hooks/use-flashcards";
import { cn } from "@/lib/utils";

interface FlashcardItemProps {
  flashcard: Flashcard;
  onEdit: (flashcard: Flashcard) => void;
  onDelete: (id: number) => void;
  onView: (flashcard: Flashcard) => void;
}

export const FlashcardItem = ({ flashcard, onEdit, onDelete, onView }: FlashcardItemProps) => {
  const [isFlipped, setIsFlipped] = useState(false);

  const handleFlip = () => {
    setIsFlipped(!isFlipped);
  };

  const handleEdit = () => {
    onEdit(flashcard);
  };

  const handleDelete = () => {
    if (confirm('Are you sure you want to delete this flashcard?')) {
      onDelete(flashcard.id);
    }
  };

  const handleView = () => {
    onView(flashcard);
  };

  return (
    <Card className="w-full cursor-pointer group hover:shadow-lg transition-all duration-200">
      <CardContent className="p-4 flex flex-col">
        {/* Flashcard content */}
        <div 
          className="flex items-center justify-center text-center relative min-h-48"
          onClick={handleView}
        >
          <div className={cn(
            "w-full flex items-center justify-center p-4 transition-all duration-500 transform",
            isFlipped ? "rotate-y-180 opacity-0 absolute" : "rotate-y-0 opacity-100"
          )}>
            <div className="w-full">
              <div className="text-sm text-muted-foreground mb-2">Front</div>
              <div className="text-lg font-medium whitespace-pre-wrap break-words">
                {flashcard.front}
              </div>
            </div>
          </div>
          
          <div className={cn(
            "w-full flex items-center justify-center p-4 transition-all duration-500 transform",
            isFlipped ? "rotate-y-0 opacity-100" : "rotate-y-180 opacity-0 absolute"
          )}>
            <div className="w-full">
              <div className="text-sm text-muted-foreground mb-2">Back</div>
              <div className="text-lg font-medium whitespace-pre-wrap break-words">
                {flashcard.back}
              </div>
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex justify-between items-center mt-4 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleFlip}
            className="flex items-center gap-2"
          >
            <RotateCcw className="h-4 w-4" />
            {isFlipped ? "Show Front" : "Show Back"}
          </Button>
          
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleView}
              className="h-8 w-8 p-0"
            >
              <Eye className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleEdit}
              className="h-8 w-8 p-0"
            >
              <Edit className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDelete}
              className="h-8 w-8 p-0 text-destructive hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
