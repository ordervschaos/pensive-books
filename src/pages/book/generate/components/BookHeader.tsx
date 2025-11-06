import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

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
    </div>
  );
};