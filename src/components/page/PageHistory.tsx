
import { Button } from "@/components/ui/button";
import { History } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface PageHistoryProps {
  pageId: number;
}

export const PageHistory = ({ pageId }: PageHistoryProps) => {
  const navigate = useNavigate();

  const handleViewHistory = () => {
    navigate(`history`);
  };

  return (
    <Button variant="ghost" size="sm" onClick={handleViewHistory}>
      <History className="w-4 h-4" />
    </Button>
  );
};
