import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Flashcard, CreateFlashcardData } from "@/hooks/use-flashcards";

interface FlashcardEditorProps {
  flashcard?: Flashcard | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: CreateFlashcardData) => Promise<void>;
  loading?: boolean;
}

export const FlashcardEditor = ({ 
  flashcard, 
  isOpen, 
  onClose, 
  onSave, 
  loading = false 
}: FlashcardEditorProps) => {
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");

  useEffect(() => {
    if (flashcard) {
      setFront(flashcard.front);
      setBack(flashcard.back);
    } else {
      setFront("");
      setBack("");
    }
  }, [flashcard, isOpen]);

  const handleSave = async () => {
    if (!front.trim() || !back.trim()) {
      return;
    }

    await onSave({ front: front.trim(), back: back.trim() });
    onClose();
  };

  const handleClose = () => {
    setFront("");
    setBack("");
    onClose();
  };

  const isEditing = !!flashcard;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Edit Flashcard" : "Create New Flashcard"}
          </DialogTitle>
          <DialogDescription>
            {isEditing 
              ? "Update the front and back content of your flashcard."
              : "Add a new flashcard with front and back content."
            }
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="front">Front (Question)</Label>
            <Textarea
              id="front"
              placeholder="Enter the question or prompt..."
              value={front}
              onChange={(e) => setFront(e.target.value)}
              className="min-h-[100px]"
              disabled={loading}
            />
          </div>
          
          <div className="grid gap-2">
            <Label htmlFor="back">Back (Answer)</Label>
            <Textarea
              id="back"
              placeholder="Enter the answer or explanation..."
              value={back}
              onChange={(e) => setBack(e.target.value)}
              className="min-h-[100px]"
              disabled={loading}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={handleClose}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={loading || !front.trim() || !back.trim()}
          >
            {loading ? "Saving..." : isEditing ? "Update" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
