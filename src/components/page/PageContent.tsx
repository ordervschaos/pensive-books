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

const getFirstParagraphContent = (data: any) => {
  if (!data?.content?.[0]) return null;
  
  // Look for the first paragraph with text content
  const firstParagraph = data.content.find(
    (node: any) => node.type === 'paragraph' && node.content?.[0]?.text
  );
  
  if (firstParagraph?.content?.[0]?.text) {
    const text = firstParagraph.content[0].text.trim();
    // Take first 50 characters, trim to last complete word
    return text.substring(0, 50).split(' ').slice(0, -1).join(' ');
  }
  
  return null;
};

const getFirstHeadingContent = (data: any) => {
  const firstNode = data.content?.[0];

  if (firstNode?.type === "heading" && firstNode.content) {
    return firstNode.content
      .filter((content: any) => content.type === 'text')
      .map((contentNode: any) => contentNode.text)
      .join(" ")
      .trim();
  }

  return null;
};

const getPageTitleFromContent = (content: any) => {
  if (!content) {
    return "Untitled";
  }
  
  let title = getFirstHeadingContent(content);

  if (!title) {
    title = getFirstParagraphContent(content);
  }

  if (!title) {
    title = "Untitled";
  }

  return title;
};

const deriveTitle = (content: string): string => {
  if (!content) return 'Untitled';
  
  try {
    const jsonContent = JSON.parse(content);
    return getPageTitleFromContent(jsonContent);
  } catch (error) {
    console.error('Error parsing content JSON:', error);
    return 'Untitled';
  }
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
      const derivedTitle = deriveTitle(JSON.stringify(editorJson));
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