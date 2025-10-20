import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { EditorJSON } from '@/types/editor';

/**
 * Extract title from JSON content (first heading node)
 */
const getTitleFromJson = (json: EditorJSON | null): string => {
  if (!json || !json.content) return 'Untitled';
  
  // Find the first heading node
  const findFirstHeading = (nodes: EditorJSON[]): string | null => {
    for (const node of nodes) {
      if (node.type === 'heading' && node.content && node.content[0] && node.content[0].text) {
        return node.content[0].text.trim();
      }
      if (node.content && Array.isArray(node.content)) {
        const heading = findFirstHeading(node.content);
        if (heading) return heading;
      }
    }
    return null;
  };
  
  return findFirstHeading(json.content) || 'Untitled';
};

interface UsePageSaveReturn {
  handleSave: (json: EditorJSON | null) => Promise<void>;
  handleApplyEdit: (oldText: string, newText: string, currentJson: EditorJSON | null) => Promise<void>;
  saving: boolean;
}

/**
 * Custom hook to handle page content saving logic
 * Manages save state, permission checks, and error handling
 */
export const usePageSave = (
  pageId: string | undefined,
  canEdit: boolean,
  onSaveSuccess?: (updatedJson: EditorJSON | null, updatedTitle: string) => void
): UsePageSaveReturn => {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);

  const handleSave = useCallback(async (json: EditorJSON | null) => {
    if (!canEdit) {
      toast({
        variant: 'destructive',
        title: 'Permission denied',
        description: "You don't have permission to edit this page",
      });
      return;
    }

    if (!pageId) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Page ID is missing',
      });
      return;
    }

    try {
      setSaving(true);

      const title = getTitleFromJson(json);

      const updateData: {
        title: string;
        content: EditorJSON | null;
        updated_at: string;
      } = {
        title: title,
        content: json,
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from('pages')
        .update(updateData)
        .eq('id', parseInt(pageId, 10));

      if (error) throw error;

      // Notify parent component of successful save
      if (onSaveSuccess) {
        onSaveSuccess(json, title);
      }

    } catch (error: unknown) {
      toast({
        variant: 'destructive',
        title: 'Error saving page',
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setSaving(false);
    }
  }, [pageId, canEdit, toast, onSaveSuccess]);

  /**
   * Apply AI-suggested edit by replacing old text with new text in JSON content
   */
  const handleApplyEdit = useCallback(async (
    oldText: string,
    newText: string,
    currentJson: EditorJSON | null
  ) => {
    if (!currentJson) return;

    // Convert JSON to string, replace text, then convert back
    const jsonString = JSON.stringify(currentJson);
    const updatedJsonString = jsonString.replace(oldText, newText);
    const updatedJson = JSON.parse(updatedJsonString);
    
    await handleSave(updatedJson);
  }, [handleSave]);

  return {
    handleSave,
    handleApplyEdit,
    saving,
  };
};
