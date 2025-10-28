import { Lock, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BookVisibilityToggleProps {
  isPublic: boolean;
  onPublish: () => void;
  onUnpublish: () => void;
  publishing: boolean;
}

export const BookVisibilityToggle = ({
  isPublic,
  onPublish,
  onUnpublish,
  publishing
}: BookVisibilityToggleProps) => {
  return (
    <div className="flex items-center gap-2">
      {isPublic ? (
        <Button
          onClick={onUnpublish}
          disabled={publishing}
          variant="outline"
          size="sm"
          className="gap-2"
        >
          <Lock className="h-4 w-4" />
          Unpublish
        </Button>
      ) : (
        <Button
          onClick={onPublish}
          disabled={publishing}
          variant="default"
          size="sm"
          className="gap-2"
        >
          <Globe className="h-4 w-4" />
          Publish
        </Button>
      )}
    </div>
  );
}; 