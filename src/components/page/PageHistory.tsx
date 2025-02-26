
import { Button } from "@/components/ui/button";
import { History } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface PageHistoryProps {
  pageId: number;
  currentContent: string;
  onRevert: (content: string) => Promise<void>;
}

export const PageHistory = ({ pageId }: PageHistoryProps) => {
  const navigate = useNavigate();

  const handleViewHistory = () => {
    navigate(`history`);
  };

  return (
    <Button variant="outline" size="sm" onClick={handleViewHistory}>
      <History className="w-4 h-4 mr-2" />
      History
    </Button>
  );
};
