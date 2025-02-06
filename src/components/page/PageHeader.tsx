import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Eye, Pencil } from "lucide-react";

interface PageHeaderProps {
  isEditing: boolean;
  onToggleEdit: () => void;
}

export const PageHeader = ({ isEditing, onToggleEdit }: PageHeaderProps) => {
  return (
    <div className="flex justify-between items-center p-2">
      <Button
        variant="ghost"
        size="sm"
        onClick={onToggleEdit}
        className="ml-auto"
      >
        {isEditing ? (
          <>
            <Eye className="mr-2 h-4 w-4" />
            Preview
          </>
        ) : (
          <>
            <Pencil className="mr-2 h-4 w-4" />
            Edit
          </>
        )}
      </Button>
    </div>
  );
};