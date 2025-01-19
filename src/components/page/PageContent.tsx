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
}

export const PageContent = ({ content, title, onSave, pageType = 'text' }: PageContentProps) => {
  const [isEditing, setIsEditing] = useState(!content);
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
    setCurrentContent(html);
    setEditorJson(json);
    debouncedSave(html, json, currentTitle);
  };

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTitle = e.target.value;
    setCurrentTitle(newTitle);
    
    if (pageType === 'section') {
      const sectionHtml = `<h1 class="text-4xl font-bold text-center py-8">${newTitle}</h1>`;
      const sectionJson = {
        type: 'doc',
        content: [{
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: newTitle }]
        }]
      };
      setCurrentContent(sectionHtml);
      setEditorJson(sectionJson);
      debouncedSave(sectionHtml, sectionJson, newTitle);
    } else {
      debouncedSave(currentContent, editorJson, newTitle);
    }
  };

  return (
    <Card className="flex-1 flex flex-col bg-background border">
      <CardContent className="p-0 flex-1 flex flex-col">
        {pageType !== 'section' && (
          <PageHeader
            title={currentTitle}
            isEditing={isEditing}
            onTitleChange={handleTitleChange}
            onToggleEdit={() => setIsEditing(!isEditing)}
          />
        )}
        
        {pageType === 'section' ? (
          <SectionPageContent
            title={currentTitle}
            isEditing={isEditing}
            onTitleChange={handleTitleChange}
          />
        ) : (
          <TextPageContent
            content={currentContent}
            isEditing={isEditing}
            onChange={handleContentChange}
          />
        )}
      </CardContent>
    </Card>
  );
};