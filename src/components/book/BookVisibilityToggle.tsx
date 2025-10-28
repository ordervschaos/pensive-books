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
    <Button
      onClick={isPublic ? onUnpublish : onPublish}
      disabled={publishing}
      variant="ghost"
      size="sm"
      className="h-8 gap-1.5 text-xs"
    >
      {isPublic ? (
        <>
          <Lock className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Unpublish</span>
        </>
      ) : (
        <>
          <Globe className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Publish</span>
        </>
      )}
    </Button>
  );
}; 