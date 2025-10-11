import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export interface Flashcard {
  id: number;
  book_id: number;
  user_id: string;
  front: string;
  back: string;
  created_at: string;
  updated_at: string;
}

export interface CreateFlashcardData {
  front: string;
  back: string;
}

export interface GenerateFlashcardsResponse {
  flashcards: CreateFlashcardData[];
  success: boolean;
  error?: string;
}

export const useFlashcards = (bookId: string | undefined) => {
  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const { toast } = useToast();

  // Fetch flashcards when bookId changes
  useEffect(() => {
    if (!bookId) return;

    const fetchFlashcards = async () => {
      try {
        setLoading(true);
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data, error } = await supabase
          .from('flashcards')
          .select('*')
          .eq('book_id', parseInt(bookId))
          .eq('user_id', user.id)
          .order('created_at', { ascending: false });

        if (error) throw error;

        setFlashcards(data || []);
      } catch (error) {
        console.error('Error fetching flashcards:', error);
        toast({
          variant: "destructive",
          title: "Error loading flashcards",
          description: "Failed to load flashcards"
        });
      } finally {
        setLoading(false);
      }
    };

    fetchFlashcards();
  }, [bookId, toast]);

  // Create a new flashcard
  const createFlashcard = useCallback(async (flashcardData: CreateFlashcardData): Promise<Flashcard | null> => {
    if (!bookId) return null;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      const { data, error } = await supabase
        .from('flashcards')
        .insert({
          book_id: parseInt(bookId),
          user_id: user.id,
          front: flashcardData.front,
          back: flashcardData.back
        })
        .select()
        .single();

      if (error) throw error;

      setFlashcards(prev => [data, ...prev]);
      
      toast({
        title: "Flashcard created",
        description: "Your flashcard has been added successfully"
      });

      return data;
    } catch (error) {
      console.error('Error creating flashcard:', error);
      toast({
        variant: "destructive",
        title: "Error creating flashcard",
        description: "Failed to create flashcard. Please try again."
      });
      return null;
    }
  }, [bookId, toast]);

  // Update an existing flashcard
  const updateFlashcard = useCallback(async (id: number, flashcardData: CreateFlashcardData): Promise<boolean> => {
    try {
      const { data, error } = await supabase
        .from('flashcards')
        .update({
          front: flashcardData.front,
          back: flashcardData.back,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      setFlashcards(prev => 
        prev.map(flashcard => 
          flashcard.id === id ? data : flashcard
        )
      );

      toast({
        title: "Flashcard updated",
        description: "Your flashcard has been updated successfully"
      });

      return true;
    } catch (error) {
      console.error('Error updating flashcard:', error);
      toast({
        variant: "destructive",
        title: "Error updating flashcard",
        description: "Failed to update flashcard. Please try again."
      });
      return false;
    }
  }, [toast]);

  // Delete a flashcard
  const deleteFlashcard = useCallback(async (id: number): Promise<boolean> => {
    try {
      const { error } = await supabase
        .from('flashcards')
        .delete()
        .eq('id', id);

      if (error) throw error;

      setFlashcards(prev => prev.filter(flashcard => flashcard.id !== id));

      toast({
        title: "Flashcard deleted",
        description: "Your flashcard has been deleted successfully"
      });

      return true;
    } catch (error) {
      console.error('Error deleting flashcard:', error);
      toast({
        variant: "destructive",
        title: "Error deleting flashcard",
        description: "Failed to delete flashcard. Please try again."
      });
      return false;
    }
  }, [toast]);

  // Generate flashcards using AI
  const generateFlashcards = useCallback(async (): Promise<GenerateFlashcardsResponse> => {
    if (!bookId) {
      return { flashcards: [], success: false, error: "No book ID provided" };
    }

    try {
      setGenerating(true);

      const { data, error } = await supabase.functions.invoke('generate-flashcards', {
        body: {
          bookId: parseInt(bookId)
        }
      });

      if (error) throw error;

      if (data.success && data.flashcards) {
        // Create all flashcards in parallel using Promise.all for better performance
        const createPromises = data.flashcards.map((flashcardData: CreateFlashcardData) =>
          createFlashcard(flashcardData)
        );

        const results = await Promise.allSettled(createPromises);

        // Filter out failed creations
        const createdFlashcards = results
          .filter((result): result is PromiseFulfilledResult<Flashcard> =>
            result.status === 'fulfilled' && result.value !== null
          )
          .map(result => result.value);

        // Log any failures for debugging
        const failures = results.filter(result => result.status === 'rejected');
        if (failures.length > 0) {
          console.warn(`Failed to create ${failures.length} flashcard(s)`);
        }

        toast({
          title: "Flashcards generated",
          description: `Successfully generated ${createdFlashcards.length} flashcard${createdFlashcards.length !== 1 ? 's' : ''}`
        });

        return {
          flashcards: data.flashcards,
          success: true
        };
      } else {
        throw new Error(data.error || "Failed to generate flashcards");
      }
    } catch (error) {
      console.error('Error generating flashcards:', error);
      const errorMessage = error instanceof Error ? error.message : "Failed to generate flashcards";

      toast({
        variant: "destructive",
        title: "Error generating flashcards",
        description: errorMessage
      });

      return {
        flashcards: [],
        success: false,
        error: errorMessage
      };
    } finally {
      setGenerating(false);
    }
  }, [bookId, createFlashcard, toast]);

  return {
    flashcards,
    loading,
    generating,
    createFlashcard,
    updateFlashcard,
    deleteFlashcard,
    generateFlashcards
  };
};
