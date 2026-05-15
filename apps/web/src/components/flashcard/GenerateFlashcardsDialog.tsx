import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Sparkles } from "lucide-react";

interface GenerateFlashcardsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onGenerate: () => Promise<void>;
  generating: boolean;
}

export const GenerateFlashcardsDialog = ({ 
  isOpen, 
  onClose, 
  onGenerate, 
  generating 
}: GenerateFlashcardsDialogProps) => {
  const handleGenerate = async () => {
    await onGenerate();
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            Generate Flashcards
          </DialogTitle>
          <DialogDescription>
            AI will analyze your book content and generate relevant flashcards automatically. 
            This may take a few moments depending on the book size.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <div className="bg-muted p-4 rounded-lg">
            <h4 className="font-medium mb-2">What will be generated:</h4>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>• Key concepts and definitions</li>
              <li>• Important facts and details</li>
              <li>• Questions and answers</li>
              <li>• Summary points for review</li>
            </ul>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={generating}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleGenerate}
            disabled={generating}
            className="gap-2"
          >
            {generating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Generate Flashcards
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
