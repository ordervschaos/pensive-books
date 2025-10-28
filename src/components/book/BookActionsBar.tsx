
import { BookVisibilityToggle } from "@/components/book/BookVisibilityToggle";
import { Button } from "@/components/ui/button";
import { Settings } from "lucide-react";

interface BookActionsBarProps {
  isPublic: boolean;
  onPublish: () => void;
  onUnpublish: () => void;
  publishing: boolean;
  onEditClick: () => void;
}

export const BookActionsBar = ({
  isPublic,
  onPublish,
  onUnpublish,
  publishing,
  onEditClick
}: BookActionsBarProps) => {
  return (
    <div className="flex justify-center my-4 gap-2 justify-between">
      <BookVisibilityToggle
        isPublic={isPublic}
        onPublish={onPublish}
        onUnpublish={onUnpublish}
        publishing={publishing}
      />
      <Button onClick={onEditClick} variant="ghost">
        <Settings className="h-4 w-4" />
      </Button>
    </div>
  );
};
