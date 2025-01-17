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
  const [isEditing, setIsEditing] = useState(false);
  const [currentContent, setCurrentContent] = useState(content);

  const handleSave = (html: string, json: any) => {
    onSave(html, json);
    setIsEditing(false);
  };

  const handleContentChange = (html: string, json: any) => {
    setCurrentContent(html);
  };

  if (!content) {
    return (
      <Card>
        <CardContent className="text-center py-12">
          <BookOpen className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
          <p className="text-muted-foreground mb-4">This page is empty</p>
          <Button 
            onClick={() => setIsEditing(true)}
            className="flex items-center gap-2"
          >
            <Pencil className="h-4 w-4" />
            Start Writing
          </Button>
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
                onClick={() => handleSave(currentContent, null)}
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