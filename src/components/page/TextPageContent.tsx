import { TipTapEditor } from "@/components/editor/TipTapEditor";
import { PageHistory } from "./PageHistory";
import { useEffect, useState } from "react";

interface TextPageContentProps {
  content: string;
  isEditing: boolean;
  onChange: (html: string, json: any) => void;
  title: string;
  onToggleEdit?: () => void;
  canEdit?: boolean;
  onRevert: (content: string) => Promise<void>;
  pageId?: string;
}

export const TextPageContent = ({ 
  content, 
  isEditing, 
  onChange, 
  title, 
  onToggleEdit,
  canEdit = false,
  onRevert,
  pageId
}: TextPageContentProps) => {
  // Create initial content with title if it's empty
  const [initialContent, setInitialContent] = useState(content || `<h1 class="page-title">${title}</h1><p></p>`);

  // Update initialContent when content or title changes
  useEffect(() => {
    console.log("TextPageContent: Content or title changed, updating initialContent");
    setInitialContent(content || `<h1 class="page-title">${title}</h1><p></p>`);
  }, [content, title]);

  return (
    <div className={`flex-1 ${!isEditing ? '' : ''}`}>
      <TipTapEditor 
        content={initialContent}
        onChange={onChange}
        editable={canEdit}
        isEditing={isEditing}
        onToggleEdit={canEdit ? onToggleEdit : undefined}
        customButtons={canEdit && pageId ? <PageHistory pageId={parseInt(pageId) || 0} currentContent={content} onRevert={onRevert} /> : undefined}
      />
    </div>
  );
};
