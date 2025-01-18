import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ArrowLeft, Globe, Lock } from "lucide-react";

interface BookHeaderProps {
  isPublic: boolean;
  onTogglePublish: () => void;
  publishing: boolean;
}

export const BookHeader = ({ isPublic, onTogglePublish, publishing }: BookHeaderProps) => {
  const navigate = useNavigate();

  return (
    <div className="flex items-center justify-between">
      <Button variant="ghost" onClick={() => navigate("/")}>
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back to Notebooks
      </Button>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Lock className="h-4 w-4 text-muted-foreground" />
          <Switch
            checked={isPublic}
            onCheckedChange={onTogglePublish}
            disabled={publishing}
          />
          <Globe className="h-4 w-4 text-muted-foreground" />
        </div>
      </div>
    </div>
  );
};