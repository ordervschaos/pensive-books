import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { Wand2, Plus } from "lucide-react";

interface BookHeaderProps {
  title?: string;
  description?: string;
  action?: React.ReactNode;
}

export const BookHeader = ({ title = "My Books", description, action }: BookHeaderProps) => {
  const navigate = useNavigate();
  
  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        {description && (
          <p className="text-muted-foreground mt-1">{description}</p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {title === "My Books" && (
          <>
            <Button 
              onClick={() => navigate('/create-book')} 
              className="flex items-center gap-2"
              variant="default"
            >
              <Wand2 className="h-4 w-4" />
              <span>AI Book Creator</span>
            </Button>
            <Button 
              onClick={() => navigate('/new-book')}
              className="flex items-center gap-2"
              variant="outline"
            >
              <Plus className="h-4 w-4" />
              <span>New Book</span>
            </Button>
          </>
        )}
        {action}
      </div>
    </div>
  );
};
