import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Eye, Pencil } from "lucide-react";

interface PageHeaderProps {
  title: string;
  isEditing: boolean;
  onTitleChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onToggleEdit: () => void;
}

export const PageHeader = ({ title, isEditing, onTitleChange, onToggleEdit }: PageHeaderProps) => {
  return (
    <div className="flex justify-between items-center p-2 border-b">
      {isEditing ? (
        <Input
          id="page-title"
          value={title}
          onChange={onTitleChange}
          placeholder="Untitled"
          className="text-lg font-semibold border-none focus-visible:ring-0 max-w-md px-2 bg-background"
        />
      ) : (
        <h2 className="text-lg font-semibold px-2">
          {title || 'Untitled'}
        </h2>
      )}
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