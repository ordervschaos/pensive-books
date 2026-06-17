import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { EditorJSON } from '@/types/editor';
import { useQueryClient } from '@tanstack/react-query';

/**
 * Replace the first occurrence of `oldText` with `newText` inside the text nodes
 * of a TipTap document, walking the tree in reading order. Returns true once a
 * replacement is made so the caller can stop at the first match.
 *
 * This operates on the parsed JSON tree — NOT on a serialized string — so the
 * replacement text can safely contain quotes, backslashes, or any other
 * character. Stringify→string-replace→re-parse corrupts the JSON whenever
 * `newText` contains such characters (e.g. an apostrophe or `"`), which threw an
 * unhandled SyntaxError.
 */
const replaceTextInNode = (node: EditorJSON, oldText: string, newText: string): boolean => {
  if (typeof node.text === 'string' && node.text.includes(oldText)) {
    // Function replacer avoids `$`-pattern interpretation in newText.
    node.text = node.text.replace(oldText, () => newText);
    return true;
  }
  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      if (replaceTextInNode(child, oldText, newText)) return true;
    }
  }
  return false;
};

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
  onSaveSuccess?: (updatedJson: EditorJSON | null, updatedTitle: string) => void,
  bookId?: number
): UsePageSaveReturn => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
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

      // CRITICAL FIX: Update cache directly instead of invalidating
      // invalidateQueries triggers a network refetch, which causes editor to remount
      // setQueryData updates the cache without refetching
      const numericPageId = parseInt(pageId, 10);

      if (bookId) {
        queryClient.setQueryData(['page', numericPageId, bookId], (oldData: any) => {
          if (!oldData) return oldData;
          return {
            ...oldData,
            title: title,
            content: json,
            updated_at: updateData.updated_at,
          };
        });
      }

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
  }, [pageId, canEdit, toast, onSaveSuccess, queryClient, bookId]);

  /**
   * Apply AI-suggested edit by replacing old text with new text in JSON content
   */
  const handleApplyEdit = useCallback(async (
    oldText: string,
    newText: string,
    currentJson: EditorJSON | null
  ) => {
    if (!currentJson) return;

    // Deep-clone so we never mutate the caller's object, then replace the text
    // in-place on the parsed tree (no stringify/JSON.parse round-trip).
    const updatedJson = structuredClone(currentJson);
    replaceTextInNode(updatedJson, oldText, newText);

    await handleSave(updatedJson);
  }, [handleSave]);

  return {
    handleSave,
    handleApplyEdit,
    saving,
  };
};
