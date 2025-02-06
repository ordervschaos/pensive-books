import { useState, useCallback, ChangeEvent } from "react";
import { debounce } from "lodash";
import { SectionPageContent } from "./SectionPageContent";
import { TextPageContent } from "./TextPageContent";

interface PageContentProps {
  content: string;
  title: string;
  onSave: (html: string, json: any, title?: string) => void;
  saving: boolean;
  pageType?: 'text' | 'section';
  editable?: boolean;
  onEditingChange?: (isEditing: boolean) => void;
}

export const PageContent = ({ 
  content, 
  title, 
  onSave, 
  pageType = 'text', 
  editable = false,
  onEditingChange 
}: PageContentProps) => {
  const [isEditing, setIsEditing] = useState(!content && editable);
  const [currentContent, setCurrentContent] = useState(content || '');
  const [currentTitle, setCurrentTitle] = useState(title || '');
  const [editorJson, setEditorJson] = useState<any>(null);

  const debouncedSave = useCallback(
    debounce((html: string, json: any, title: string) => {
      const finalTitle = title.trim() || (document.activeElement !== document.getElementById('page-title') ? 'Untitled' : '');
      onSave(html, json, finalTitle);
    }, 1000),
    [onSave]
  );

  const handleContentChange = (html: string, json: any) => {
    if (!editable) return;
    setCurrentContent(html);
    setEditorJson(json);
    debouncedSave(html, json, currentTitle);
  };

  const handleTitleChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (!editable) return;
    const newTitle = e.target.value;
    setCurrentTitle(newTitle);
    debouncedSave(currentContent, editorJson, newTitle);
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
            title={currentTitle}
            isEditing={isEditing && editable}
            onTitleChange={handleTitleChange}
          />
        ) : (
          <TextPageContent
            content={currentContent}
            isEditing={isEditing && editable}
            onChange={handleContentChange}
            onTitleChange={(title: string) => {
              handleTitleChange({ target: { value: title } } as ChangeEvent<HTMLInputElement>);
            }}
            title={currentTitle}
            onToggleEdit={() => handleEditingChange(!isEditing)}
          />
        )}
      </div>
    </div>
  );
};