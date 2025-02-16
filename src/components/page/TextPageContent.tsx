import { TipTapEditor } from "@/components/editor/TipTapEditor";

interface TextPageContentProps {
  content: string;
  isEditing: boolean;
  onChange: (html: string, json: any) => void;
  title: string;
  onToggleEdit?: () => void;
}

export const TextPageContent = ({ content, isEditing, onChange, title, onToggleEdit }: TextPageContentProps) => {
  // Create initial content with title if it's empty
  const initialContent = content || `<h1 class="page-title">${title}</h1><p></p>`;

  return (
    <div className={`flex-1 ${!isEditing ? '' : ''}`}>
      <TipTapEditor 
        content={initialContent}
        onChange={onChange}
        editable={true}
        isEditing={isEditing}
        onToggleEdit={onToggleEdit}
      />
    </div>
  );
};

