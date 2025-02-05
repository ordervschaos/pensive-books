import { useState, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { debounce } from "lodash";
import { PageHeader } from "./PageHeader";
import { SectionPageContent } from "./SectionPageContent";
import { TextPageContent } from "./TextPageContent";

interface PageContentProps {
  content: string;
  title: string;
  onSave: (html: string, json: any, title?: string) => void;
  saving: boolean;
  pageType?: 'text' | 'section';
  editable?: boolean;
}

export const PageContent = ({ content, title, onSave, pageType = 'text', editable = false }: PageContentProps) => {
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
    if (!editable) return; // Don't update content if not editable
    setCurrentContent(html);
    setEditorJson(json);
    debouncedSave(html, json, currentTitle);
  };

  const handleTitleChange = (newTitle: string) => {
    if (!editable) return;
    setCurrentTitle(newTitle);
    debouncedSave(currentContent, editorJson, newTitle);
  };

  return (
    <Card className="flex-1 flex flex-col bg-background border">
      <CardContent className="p-0 flex-1 flex flex-col">
        {pageType !== 'section' && editable && (
          <PageHeader
            isEditing={isEditing}
            onToggleEdit={() => setIsEditing(!isEditing)}
          />
        )}
        
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
            onTitleChange={handleTitleChange}
            title={currentTitle}
          />
        )}
      </CardContent>
    </Card>
  );
};