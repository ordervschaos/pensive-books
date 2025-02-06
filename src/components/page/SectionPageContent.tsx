import { Input } from "@/components/ui/input";
import { ChangeEvent } from "react";

interface SectionPageContentProps {
  title: string;
  isEditing: boolean;
  onTitleChange: (e: ChangeEvent<HTMLInputElement>) => void;
}

export const SectionPageContent = ({ title, isEditing, onTitleChange }: SectionPageContentProps) => {
  return (
    <div className="flex-1 flex items-center justify-center">
      {isEditing ? (
        <Input
          value={title}
          onChange={onTitleChange}
          placeholder="Untitled Section"
          className="text-4xl font-bold text-center py-8 border-none focus-visible:ring-0 bg-transparent w-auto min-w-[300px]"
          style={{ fontSize: '2.25rem' }}
        />
      ) : (
        <h1 className="text-4xl font-bold text-center py-8">
          {title || 'Untitled Section'}
        </h1>
      )}
    </div>
  );
};