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
  const [currentContent, setCurrentContent] = useState(content || '');
  const [currentTitle, setCurrentTitle] = useState(title || '');
  const [editorJson, setEditorJson] = useState<any>(null);

  const debouncedSave = useCallback(
    debounce((html: string) => {
      if (!initialLoad) {
        // Extract title from the first h1 in the content
        // const firstHeading = editorJson.content?.find(
        //   (node: any) => node.type === 'heading' && node.attrs?.level === 1
        // );

        // let extractedTitle = '';
        // if (firstHeading?.content) {
        //   extractedTitle = firstHeading.content
        //     .filter((node: any) => node.type === 'text')
        //     .map((node: any) => node.text)
        //     .join('');
        // }

        // // Only use 'Untitled' if there's no title content
        // const finalTitle = extractedTitle.trim() || title || 'Untitled';
        onSave(html);
      }
    }, 200),
    [onSave, initialLoad, title]
  );

  const handleContentChange = (html: string, json: any) => {
    if (!editable) return;
    setCurrentContent(html);
    setEditorJson(json);
    setInitialLoad(false);
    debouncedSave(html, json);
  };

  const handleTitleChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (!editable) return;
    setCurrentTitle(e.target.value);
    setInitialLoad(false);
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
            content={currentContent}
            title={currentTitle}
            isEditing={isEditing && editable}
            onChange={handleContentChange}
            onToggleEdit={() => handleEditingChange(!isEditing)}
            canEdit={canEdit}
          />
        ) : (
          <TextPageContent
            content={currentContent}
            isEditing={isEditing && editable}
            onChange={handleContentChange}
            title={currentTitle}
            onToggleEdit={() => handleEditingChange(!isEditing)}
            canEdit={canEdit}
          />
        )}
      </div>
    </div>
  );
};
