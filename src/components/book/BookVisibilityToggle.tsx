import { Lock, Globe } from "lucide-react";
import { Switch } from "@/components/ui/switch";

interface BookVisibilityToggleProps {
  isPublic: boolean;
  onTogglePublish: () => void;
  publishing: boolean;
}

export const BookVisibilityToggle = ({
  isPublic,
  onTogglePublish,
  publishing
}: BookVisibilityToggleProps) => {
  return (
    <div className="flex items-center gap-2">
      <Lock className="h-4 w-4 text-muted-foreground" />
      <Switch
        checked={isPublic}
        onCheckedChange={onTogglePublish}
        disabled={publishing}
      />
      <Globe className="h-4 w-4 text-muted-foreground" />
    </div>
  );
}; 