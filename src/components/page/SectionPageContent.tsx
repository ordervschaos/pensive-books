
import { Button } from "@/components/ui/button";
import { TipTapEditor } from "@/components/editor/TipTapEditor";
import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { Save, Edit } from "lucide-react";
import { Page } from "@/components/book/pageList/types";

interface SectionPageContentProps {
  page: Page;
  bookId: number;
  canEdit: boolean;
  onChange?: (content: string, title: string, htmlContent?: string) => void;
  onBookmarkToggle?: () => void;
  isBookmarked?: boolean;
  isPublished?: boolean;
}

export function SectionPageContent({
  page,
  bookId,
  canEdit,
  onChange,
  onBookmarkToggle,
  isBookmarked = false,
  isPublished = false,
}: SectionPageContentProps) {
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [content, setContent] = useState(page.html_content || "");
  const [title, setTitle] = useState(page.title || "");
  const [htmlContent, setHtmlContent] = useState(page.html_content || "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setContent(page.html_content || "");
    setTitle(page.title || "");
  }, [page]);

  const toggleEdit = () => {
    setIsEditing(!isEditing);
  };

  const handleContentChange = (html: string, json?: any) => {
    setContent(html);
    setHtmlContent(html);
  };

  const handleSave = async () => {
    if (onChange) {
      onChange(content, title, htmlContent);
    }
    setIsEditing(false);
  };

  return (
    <div className="w-full h-full flex flex-col">
      <div className="flex justify-between items-center mb-4">
        {canEdit && (
          <Button
            variant="outline"
            size="sm"
            onClick={isEditing ? handleSave : toggleEdit}
            className="flex items-center gap-2"
          >
            {isEditing ? (
              <>
                <Save className="h-4 w-4" />
                <span>Save</span>
              </>
            ) : (
              <>
                <Edit className="h-4 w-4" />
                <span>Edit</span>
              </>
            )}
          </Button>
        )}
      </div>

      <div className="flex-1">
        <TipTapEditor
          content={content}
          onChange={handleContentChange}
          editable={canEdit && isEditing}
          isEditing={isEditing}
          onToggleEdit={toggleEdit}
        />
      </div>
    </div>
  );
}

export default SectionPageContent;
