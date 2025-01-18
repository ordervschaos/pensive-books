import { useState, useCallback, useEffect } from "react";
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
}

const deriveTitle = (content: string): string => {
  if (!content) return 'Untitled';
  
  // Try to find H1 tag content first
  const h1Match = content.match(/<h1[^>]*>(.*?)<\/h1>/);
  if (h1Match && h1Match[1]) {
    const h1Content = h1Match[1].replace(/<[^>]*>/g, '').trim();
    if (h1Content) return h1Content;
  }
  
  // Remove all HTML tags
  const plainText = content.replace(/<[^>]*>/g, '');
  
  // Try to get first non-empty line
  const firstLine = plainText
    .split('\n')
    .map(line => line.trim())
    .find(line => line.length > 0);
    
  if (firstLine) {
    // Take first 50 characters of first line, trim to last complete word
    return firstLine.substring(0, 50).split(' ').slice(0, -1).join(' ');
  }
  
  // If no first line, take first 25 characters of content
  if (plainText.trim()) {
    const truncated = plainText.trim().substring(0, 25);
    return truncated + (plainText.length > 25 ? '...' : '');
  }
  
  return 'Untitled';
};

export const PageContent = ({ content, title, onSave, saving }: PageContentProps) => {
  const [isEditing, setIsEditing] = useState(!content);
  const [currentContent, setCurrentContent] = useState(content || '');
  const [currentTitle, setCurrentTitle] = useState(title || 'Untitled');
  const [editorJson, setEditorJson] = useState<any>(null);

  const debouncedSave = useCallback(
    debounce((html: string, json: any, title: string) => {
      onSave(html, json, title);
    }, 1000),
    [onSave]
  );

  useEffect(() => {
    if (currentTitle === 'Untitled' || !currentTitle.trim()) {
      const derivedTitle = deriveTitle(currentContent);
      if (derivedTitle !== 'Untitled') {
        setCurrentTitle(derivedTitle);
        debouncedSave(currentContent, editorJson, derivedTitle);
      }
    }
  }, [currentContent, currentTitle, editorJson, debouncedSave]);

  const handleContentChange = (html: string, json: any) => {
    setCurrentContent(html);
    setEditorJson(json);
    debouncedSave(html, json, currentTitle);
  };

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTitle = e.target.value || 'Untitled';
    setCurrentTitle(newTitle);
    debouncedSave(currentContent, editorJson, newTitle);
  };

  return (
    <Card className="flex-1 flex flex-col">
      <CardContent className="p-0 flex-1 flex flex-col">
        <div className="flex justify-between items-center p-2 border-b">
          <Input
            value={currentTitle}
            onChange={handleTitleChange}
            placeholder="Untitled"
            className="text-lg font-semibold border-none focus-visible:ring-0 max-w-md"
          />
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
        <div className="flex-1">
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