
import { TipTapEditor } from "@/components/editor/TipTapEditor";
import { PageHistory } from "./PageHistory";

interface TextPageContentProps {
  content: string;
  isEditing: boolean;
  onChange: (html: string, json: any) => void;
  title: string;
  onToggleEdit?: () => void;
  canEdit?: boolean;
  onRevert: (content: string) => Promise<void>;
}

export const TextPageContent = ({ 
  content, 
  isEditing, 
  onChange, 
  title, 
  onToggleEdit,
  canEdit = false,
  onRevert
}: TextPageContentProps) => {
  const initialContent = content || `<h1 class="page-title">${title}</h1><p></p>`;

  return (
    <div className={`flex-1 ${!isEditing ? '' : ''}`}>
      <TipTapEditor 
        content={initialContent}
        onChange={onChange}
        editable={canEdit}
        isEditing={isEditing}
        onToggleEdit={canEdit ? onToggleEdit : undefined}
        customButtons={canEdit ? <PageHistory pageId={pageId} currentContent={content} onRevert={onRevert} /> : undefined}
      />
    </div>
  );
};
