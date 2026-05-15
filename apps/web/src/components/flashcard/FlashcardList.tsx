import { Flashcard } from "@/hooks/use-flashcards";
import { FlashcardItem } from "./FlashcardItem";

interface FlashcardListProps {
  flashcards: Flashcard[];
  onEdit: (flashcard: Flashcard) => void;
  onDelete: (id: number) => void;
  onView: (flashcard: Flashcard) => void;
  loading?: boolean;
}

export const FlashcardList = ({ flashcards, onEdit, onDelete, onView, loading }: FlashcardListProps) => {
  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="h-48 bg-muted animate-pulse rounded-lg" />
        ))}
      </div>
    );
  }

  if (flashcards.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="text-muted-foreground text-lg mb-2">No flashcards yet</div>
        <div className="text-muted-foreground text-sm">
          Create your first flashcard or generate some from your book content
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {flashcards.map((flashcard) => (
        <FlashcardItem
          key={flashcard.id}
          flashcard={flashcard}
          onEdit={onEdit}
          onDelete={onDelete}
          onView={onView}
        />
      ))}
    </div>
  );
};
