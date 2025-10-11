import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

/**
 * Extract title from HTML content (first <h1> tag)
 */
const getTitleFromHtml = (html: string): string => {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const h1 = doc.querySelector('h1');
  return h1?.textContent?.trim() || 'Untitled';
};

interface UsePageSaveReturn {
  handleSave: (html: string) => Promise<void>;
  handleApplyEdit: (oldText: string, newText: string, currentHtml: string) => Promise<void>;
  saving: boolean;
}

/**
 * Custom hook to handle page content saving logic
 * Manages save state, permission checks, and error handling
 */
export const usePageSave = (
  pageId: string | undefined,
  canEdit: boolean,
  onSaveSuccess?: (updatedHtml: string, updatedTitle: string) => void
): UsePageSaveReturn => {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);

  const handleSave = useCallback(async (html: string) => {
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

      const title = getTitleFromHtml(html);

      const { error } = await supabase
        .from('pages')
        .update({
          html_content: html,
          title: title,
          updated_at: new Date().toISOString(),
        })
        .eq('id', parseInt(pageId, 10));

      if (error) throw error;

      // Notify parent component of successful save
      if (onSaveSuccess) {
        onSaveSuccess(html, title);
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
   * Apply AI-suggested edit by replacing old text with new text
   */
  const handleApplyEdit = useCallback(async (
    oldText: string,
    newText: string,
    currentHtml: string
  ) => {
    if (!currentHtml) return;

    const updatedContent = currentHtml.replace(oldText, newText);
    await handleSave(updatedContent);
  }, [handleSave]);

  return {
    handleSave,
    handleApplyEdit,
    saving,
  };
};
