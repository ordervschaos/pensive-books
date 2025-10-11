import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Database } from '@/integrations/supabase/types';

type UserBookPreferences = Database['public']['Tables']['user_book_preferences']['Row'];
type UserBookPreferencesInsert = Database['public']['Tables']['user_book_preferences']['Insert'];
type UserBookPreferencesUpdate = Database['public']['Tables']['user_book_preferences']['Update'];

interface UseUserBookPreferencesProps {
  bookId: number;
  userId: string;
}

interface UseUserBookPreferencesReturn {
  preferences: UserBookPreferences | null;
  loading: boolean;
  error: string | null;
  updatePreferences: (updates: Partial<UserBookPreferencesUpdate>) => Promise<void>;
  toggleFlashcards: () => Promise<void>;
}

export const useUserBookPreferences = ({ 
  bookId, 
  userId 
}: UseUserBookPreferencesProps): UseUserBookPreferencesReturn => {
  const [preferences, setPreferences] = useState<UserBookPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPreferences = useCallback(async () => {
    if (!bookId || !userId) return;

    try {
      setLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from('user_book_preferences')
        .select('*')
        .eq('book_id', bookId)
        .eq('user_id', userId)
        .single();

      if (fetchError) {
        if (fetchError.code === 'PGRST116') {
          // No preferences found, create default ones
          const { data: newPreferences, error: insertError } = await supabase
            .from('user_book_preferences')
            .insert({
              book_id: bookId,
              user_id: userId,
              flashcards_enabled: true, // Default to enabled
            })
            .select()
            .single();

          if (insertError) {
            throw insertError;
          }

          setPreferences(newPreferences);
        } else {
          throw fetchError;
        }
      } else {
        setPreferences(data);
      }
    } catch (err) {
      console.error('Error fetching user book preferences:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch preferences');
    } finally {
      setLoading(false);
    }
  }, [bookId, userId]);

  const updatePreferences = useCallback(async (updates: Partial<UserBookPreferencesUpdate>) => {
    if (!preferences) return;

    try {
      setError(null);

      const { data, error: updateError } = await supabase
        .from('user_book_preferences')
        .update(updates)
        .eq('id', preferences.id)
        .select()
        .single();

      if (updateError) {
        throw updateError;
      }

      setPreferences(data);
    } catch (err) {
      console.error('Error updating user book preferences:', err);
      setError(err instanceof Error ? err.message : 'Failed to update preferences');
    }
  }, [preferences]);

  const toggleFlashcards = useCallback(async () => {
    if (!preferences) return;

    await updatePreferences({
      flashcards_enabled: !preferences.flashcards_enabled,
    });
  }, [preferences, updatePreferences]);

  useEffect(() => {
    fetchPreferences();
  }, [fetchPreferences]);

  return {
    preferences,
    loading,
    error,
    updatePreferences,
    toggleFlashcards,
  };
};
