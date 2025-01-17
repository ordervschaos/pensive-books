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

  // Debounced save function
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

  const handleStartEditing = () => {
    setIsEditing(true);
    if (!content) {
      setCurrentContent('');
      setEditorJson(null);
    }
  };

  if (!content) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="space-y-4">
            <TipTapEditor 
              content={currentContent} 
              onChange={handleContentChange}
              editable={true}
            />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="space-y-4">
          <div className="flex justify-end mb-4">
            <Button
              variant="outline"
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
        </div>
      </CardContent>
    </Card>
  );
};