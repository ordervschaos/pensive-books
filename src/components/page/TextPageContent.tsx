import { TipTapEditor } from "@/components/editor/TipTapEditor";

interface TextPageContentProps {
  content: string;
  isEditing: boolean;
  onChange: (html: string, json: any) => void;
}

export const TextPageContent = ({ content, isEditing, onChange }: TextPageContentProps) => {
  return (
    <div className={`flex-1 ${!isEditing ? 'max-w-3xl mx-auto' : ''}`}>
      <TipTapEditor 
        content={content} 
        onChange={onChange}
        editable={isEditing}
      />
    </div>
  );
};