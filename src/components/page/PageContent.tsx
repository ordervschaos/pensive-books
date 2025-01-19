import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Eye, Pencil } from "lucide-react";
import { TipTapEditor } from "@/components/editor/TipTapEditor";
import { Input } from "@/components/ui/input";
import { debounce } from "lodash";

interface PageContentProps {
  content: string;
  title: string;
  onSave: (html: string, json: any, title?: string) => void;
  saving: boolean;
  pageType?: 'text' | 'section';
}

export const PageContent = ({ content, title, onSave, saving, pageType = 'text' }: PageContentProps) => {
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
        <div className="flex justify-between items-center p-2 border-b">
          {isEditing ? (
            <Input
              id="page-title"
              value={currentTitle}
              onChange={handleTitleChange}
              placeholder="Untitled"
              className="text-lg font-semibold border-none focus-visible:ring-0 max-w-md px-2 bg-background"
            />
          ) : (
            <h2 className="text-lg font-semibold px-2">
              {currentTitle || 'Untitled'}
            </h2>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsEditing(!isEditing)}
            className="ml-auto"
          >
            {isEditing ? (
              <>
                <Eye className="mr-2 h-4 w-4" />
                Preview
              </>
            ) : (
              <>
                <Pencil className="mr-2 h-4 w-4" />
                Edit
              </>
            )}
          </Button>
        </div>
        
        {pageType === 'section' ? (
          <div className="flex-1 flex items-center justify-center">
            <h1 className="text-4xl font-bold text-center py-8">
              {currentTitle || 'Untitled Section'}
            </h1>
          </div>
        ) : (
          <div className="flex-1">
            <TipTapEditor 
              content={currentContent} 
              onChange={handleContentChange}
              editable={isEditing}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
};