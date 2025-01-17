import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
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
      <Button
        onClick={onTogglePublish}
        disabled={publishing}
        variant={isPublic ? "destructive" : "default"}
      >
        {isPublic ? (
          <>
            <Lock className="mr-2 h-4 w-4" />
            Make Private
          </>
        ) : (
          <>
            <Globe className="mr-2 h-4 w-4" />
            Publish
          </>
        )}
      </Button>
    </div>
  );
};