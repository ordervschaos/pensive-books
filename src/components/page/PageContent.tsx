import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Eye, Pencil } from "lucide-react";
import { TipTapEditor } from "@/components/editor/TipTapEditor";
import { debounce } from "lodash";

interface PageContentProps {
  content: string;
  onSave: (html: string, json: any) => void;
  saving: boolean;
}

export const PageContent = ({ content, onSave, saving }: PageContentProps) => {
  const [isEditing, setIsEditing] = useState(!content);
  const [currentContent, setCurrentContent] = useState(content || '');
  const [editorJson, setEditorJson] = useState<any>(null);

  const debouncedSave = useCallback(
    debounce((html: string, json: any) => {
      onSave(html, json);
    }, 1000),
    [onSave]
  );

  const handleContentChange = (html: string, json: any) => {
    setCurrentContent(html);
    setEditorJson(json);
    debouncedSave(html, json);
  };

  if (!content) {
    return (
      <Card className="flex-1">
        <CardContent className="p-0">
          <TipTapEditor 
            content={currentContent} 
            onChange={handleContentChange}
            editable={true}
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="flex-1">
      <CardContent className="p-0">
        <div className="flex justify-end p-2 border-b">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsEditing(!isEditing)}
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
        <TipTapEditor 
          content={currentContent} 
          onChange={handleContentChange}
          editable={isEditing}
        />
      </CardContent>
    </Card>
  );
};