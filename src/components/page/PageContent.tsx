import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { BookOpen, Eye, Pencil, Save } from "lucide-react";
import { TipTapEditor } from "@/components/editor/TipTapEditor";

interface PageContentProps {
  content: string;
  onSave: (html: string, json: any) => void;
  saving: boolean;
}

export const PageContent = ({ content, onSave, saving }: PageContentProps) => {
  const [isEditing, setIsEditing] = useState(!content);
  const [currentContent, setCurrentContent] = useState(content || '');
  const [editorJson, setEditorJson] = useState<any>(null);

  const handleSave = () => {
    onSave(currentContent, editorJson);
    setIsEditing(false);
  };

  const handleContentChange = (html: string, json: any) => {
    setCurrentContent(html);
    setEditorJson(json);
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
            <div className="flex justify-end">
              <Button 
                disabled={saving} 
                onClick={handleSave}
              >
                {saving ? 'Saving...' : 'Save'}
                {!saving && <Save className="ml-2 h-4 w-4" />}
              </Button>
            </div>
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
          {isEditing && (
            <div className="flex justify-end">
              <Button 
                disabled={saving} 
                onClick={handleSave}
              >
                {saving ? 'Saving...' : 'Save'}
                {!saving && <Save className="ml-2 h-4 w-4" />}
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};