import { TipTapEditor } from "@/components/editor/TipTapEditor";

interface TextPageContentProps {
  content: string;
  isEditing: boolean;
  onChange: (html: string, json: any) => void;
  onTitleChange: (title: string) => void;
  title: string;
}

export const TextPageContent = ({ content, isEditing, onChange, onTitleChange, title }: TextPageContentProps) => {
  // Create initial content with title if it's empty
  const initialContent = content || `<h1 class="page-title">${title}</h1><p></p>`;

  return (
    <div className={`flex-1 ${!isEditing ? 'max-w-3xl mx-auto' : ''}`}>
      <TipTapEditor 
        content={initialContent}
        onChange={onChange}
        onTitleChange={onTitleChange}
        editable={isEditing}
      />
    </div>
  );
};

