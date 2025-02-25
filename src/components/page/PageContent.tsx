
import { useState, useCallback } from "react";
import { debounce } from "lodash";
import { SectionPageContent } from "./SectionPageContent";
import { TextPageContent } from "./TextPageContent";

interface PageContentProps {
  content: string;
  title: string;
  onSave: (html: string, json?: any) => void;
  saving: boolean;
  pageType?: 'text' | 'section';
  editable?: boolean;
  onEditingChange?: (isEditing: boolean) => void;
  canEdit?: boolean;
}

export const PageContent = ({ 
  content, 
  title, 
  onSave, 
  pageType = 'text', 
  editable = false,
  onEditingChange,
  canEdit = false
}: PageContentProps) => {
  const [isEditing, setIsEditing] = useState(!content && editable && canEdit);
  const [initialLoad, setInitialLoad] = useState(true);

  const debouncedSave = useCallback(
    debounce((html: string, json?: any) => {
      if (!initialLoad) {
        onSave(html, json);
      }
    }, 200),
    [onSave, initialLoad]
  );

  const handleContentChange = (html: string, json: any) => {
    if (!editable) return;
    setInitialLoad(false);
    debouncedSave(html, json);
  };

  const handleEditingChange = (editing: boolean) => {
    setIsEditing(editing);
    if (onEditingChange) {
      onEditingChange(editing);
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-background">
      <div className="p-0 flex-1 flex flex-col">
        {pageType === 'section' ? (
          <SectionPageContent
            content={content}
            title={title}
            isEditing={isEditing && editable}
            onChange={handleContentChange}
            onToggleEdit={() => handleEditingChange(!isEditing)}
            canEdit={canEdit}
          />
        ) : (
          <TextPageContent
            content={content}
            isEditing={isEditing && editable}
            onChange={handleContentChange}
            title={title}
            onToggleEdit={() => handleEditingChange(!isEditing)}
            canEdit={canEdit}
          />
        )}
      </div>
    </div>
  );
};
