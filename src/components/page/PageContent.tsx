
import { useState, useCallback } from "react";
import { debounce } from "lodash";
import { SectionPageContent } from "./SectionPageContent";
import { TextPageContent } from "./TextPageContent";
import { supabase } from "@/integrations/supabase/client";
import { useParams } from "react-router-dom";

interface PageContentProps {
  content: string;
  title: string;
  onSave: (html: string, json?: any) => void;
  saving: boolean;
  pageType?: 'text' | 'section';
  editable?: boolean;
  onEditingChange?: (isEditing: boolean) => void;
  canEdit?: boolean;
}

export const PageContent = ({ 
  content, 
  title, 
  onSave, 
  pageType = 'text', 
  editable = false,
  onEditingChange,
  canEdit = false
}: PageContentProps) => {
  const [isEditing, setIsEditing] = useState(!content && editable && canEdit);
  const [initialLoad, setInitialLoad] = useState(true);
  const [currentContent, setCurrentContent] = useState(content || '');
  const [currentTitle, setCurrentTitle] = useState(title || '');
  const [editorJson, setEditorJson] = useState<any>(null);
  const [lastSaveTime, setLastSaveTime] = useState<Date | null>(null);
  const { id: pageId } = useParams();

  const saveHistory = async (html: string) => {
    if (!pageId) return;
    
    // Only save history if more than 5 minutes have passed since last save
    const now = new Date();
    if (lastSaveTime && now.getTime() - lastSaveTime.getTime() < 5 * 60 * 1000) {
      return;
    }

    try {
      const batchId = new Date().toISOString();
      await supabase.from('page_history').insert({
        page_id: parseInt(pageId),
        html_content: html,
        batch_id: batchId,
      });
      setLastSaveTime(now);
    } catch (error) {
      console.error('Error saving history:', error);
    }
  };

  const debouncedSave = useCallback(
    debounce((html: string) => {
      if (!initialLoad) {
        onSave(html);
        saveHistory(html);
      }
    }, 200),
    [onSave, initialLoad, saveHistory]
  );

  const handleContentChange = (html: string, json: any) => {
    if (!editable) return;
    setCurrentContent(html);
    setEditorJson(json);
    setInitialLoad(false);
    debouncedSave(html);
  };

  const handleRevertToVersion = async (html: string) => {
    setCurrentContent(html);
    await onSave(html);
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
          />
        )}
      </div>
    </div>
  );
};
