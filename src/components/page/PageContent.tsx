import { useState, useCallback, ChangeEvent } from "react";
import { debounce } from "lodash";
import { SectionPageContent } from "./SectionPageContent";
import { TextPageContent } from "./TextPageContent";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface PageContentProps {
  content: string;
  title: string;
  onSave: (html: string, json: any) => void;
  saving: boolean;
  pageType?: 'text' | 'section';
  editable?: boolean;
  onEditingChange?: (isEditing: boolean) => void;
  canEdit?: boolean;
  pageId?: string;
}

export const PageContent = ({ 
  content, 
  title, 
  onSave, 
  pageType = 'text', 
  editable = false,
  onEditingChange,
  canEdit = false,
  pageId
}: PageContentProps) => {
  const [isEditing, setIsEditing] = useState(!content && editable && canEdit);
  const [initialLoad, setInitialLoad] = useState(true);
  const [currentContent, setCurrentContent] = useState(content || '');
  const [currentTitle, setCurrentTitle] = useState(title || '');
  const [editorJson, setEditorJson] = useState<any>(null);
  const { toast } = useToast();

  const debouncedSave = useCallback(
    debounce(async (html: string, json: any) => {
      if (!initialLoad && pageId) {
        try {
          // Get the current user's ID
          const { data: { user } } = await supabase.auth.getUser();
          if (!user?.id) throw new Error('User not authenticated');

          // Upsert the history - will update if entry exists within last minute
          await supabase
            .from('page_history')
            .upsert(
              {
                page_id: parseInt(pageId),
                html_content: content,
                created_by: user.id,
                created_at: new Date().toISOString()
              },
              {
                onConflict: 'page_id,created_at_minute'
              }
            );
          
          // Then save the new content
          onSave(html, json);
        } catch (error) {
          console.error('Error saving history:', error);
        }
      } else {
        onSave(html, json);
      }
    }, 200),
    [onSave, initialLoad, content, pageId]
  );

  const handleContentChange = (html: string, json: any) => {
    if (!editable) return;
    setCurrentContent(html);
    setEditorJson(json);
    setInitialLoad(false);
    debouncedSave(html, json);
  };

  const handleRevertToVersion = async (versionContent: string) => {
    try {
      setCurrentContent(versionContent);
      await onSave(versionContent, null);
      toast({
        title: "Version restored",
        description: "The page has been reverted to the selected version."
      });
    } catch (error) {
      console.error('Error reverting version:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to restore the selected version."
      });
    }
  };

  const handleEditingChange = (editing: boolean) => {
    setIsEditing(editing);
    if (onEditingChange) {
      onEditingChange(editing);
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-background">
      <div className="p-0 flex-1 flex flex-col">
        {pageType === 'section' ? (
          <SectionPageContent
            content={currentContent}
            title={currentTitle}
            isEditing={isEditing && editable}
            onChange={handleContentChange}
            onToggleEdit={() => handleEditingChange(!isEditing)}
            canEdit={canEdit}
          />
        ) : (
          <TextPageContent
            content={currentContent}
            isEditing={isEditing && editable}
            onChange={handleContentChange}
            title={currentTitle}
            onToggleEdit={() => handleEditingChange(!isEditing)}
            canEdit={canEdit}
            onRevert={handleRevertToVersion}
            pageId={pageId}
          />
        )}
      </div>
    </div>
  );
};
