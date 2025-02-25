
import { BookVisibilityToggle } from "@/components/book/BookVisibilityToggle";
import { Button } from "@/components/ui/button";
import { Settings } from "lucide-react";

interface BookActionsBarProps {
  isPublic: boolean;
  onTogglePublish: () => void;
  publishing: boolean;
  onEditClick: () => void;
}

export const BookActionsBar = ({
  isPublic,
  onTogglePublish,
  publishing,
  onEditClick
}: BookActionsBarProps) => {
  return (
    <div className="flex justify-center my-4 gap-2 justify-between">
      <BookVisibilityToggle
        isPublic={isPublic}
        onTogglePublish={onTogglePublish}
        publishing={publishing}
      />
      <Button onClick={onEditClick} variant="ghost">
        <Settings className="h-4 w-4" />
      </Button>
    </div>
  );
};
