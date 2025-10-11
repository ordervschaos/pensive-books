import { useState, useCallback, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useFlashcards, Flashcard, CreateFlashcardData } from "@/hooks/use-flashcards";
import { useBookPermissions } from "@/hooks/use-book-permissions";
import { BookInfo } from "@/components/book/BookInfo";
import { Button } from "@/components/ui/button";
import { Plus, Sparkles, ArrowLeft } from "lucide-react";
import { FlashcardList } from "@/components/flashcard/FlashcardList";
import { FlashcardEditor } from "@/components/flashcard/FlashcardEditor";
import { GenerateFlashcardsDialog } from "@/components/flashcard/GenerateFlashcardsDialog";
import { FlashcardModal } from "@/components/flashcard/FlashcardModal";
import { setPageTitle } from "@/utils/pageTitle";
import { Helmet } from "react-helmet-async";

const BookFlashcards = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [book, setBook] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isGenerateDialogOpen, setIsGenerateDialogOpen] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingFlashcard, setEditingFlashcard] = useState<Flashcard | null>(null);
  const [viewingFlashcard, setViewingFlashcard] = useState<Flashcard | null>(null);
  const [currentFlashcardIndex, setCurrentFlashcardIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  
  const { canEdit, isOwner, loading: permissionsLoading } = useBookPermissions(id);
  const { 
    flashcards, 
    loading: flashcardsLoading, 
    generating, 
    createFlashcard, 
    updateFlashcard, 
    deleteFlashcard, 
    generateFlashcards 
  } = useFlashcards(id);

  const getNumericId = (param: string | undefined) => {
    if (!param) return 0;
    const match = param.match(/^(\d+)/);
    return match ? parseInt(match[1]) : 0;
  };

  const fetchBookDetails = useCallback(async () => {
    try {
      const numericId = getNumericId(id);
      console.log('Fetching book details for ID:', numericId);

      const { data: bookData, error: bookError } = await supabase
        .from("books")
        .select("*")
        .eq("id", numericId)
        .eq("is_archived", false)
        .single();
      
      if (bookError) {
        console.error('Error fetching book:', bookError);
        throw bookError;
      }

      console.log('Book data fetched:', bookData);
      setBook(bookData);
      setPageTitle(`${bookData.name} - Flashcards`);
    } catch (error: any) {
      console.error('Error in fetchBookDetails:', error);
      toast({
        variant: "destructive",
        title: "Error fetching book details",
        description: error.message
      });
    } finally {
      setLoading(false);
    }
  }, [id, toast]);

  // Load book details on mount
  useEffect(() => {
    fetchBookDetails();
  }, [fetchBookDetails]);

  const handleCreateFlashcard = () => {
    setEditingFlashcard(null);
    setIsEditorOpen(true);
  };

  const handleEditFlashcard = (flashcard: Flashcard) => {
    setEditingFlashcard(flashcard);
    setIsEditorOpen(true);
  };

  const handleSaveFlashcard = async (data: CreateFlashcardData) => {
    setSaving(true);
    try {
      if (editingFlashcard) {
        await updateFlashcard(editingFlashcard.id, data);
      } else {
        await createFlashcard(data);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteFlashcard = async (flashcardId: number) => {
    await deleteFlashcard(flashcardId);
  };

  const handleViewFlashcard = (flashcard: Flashcard) => {
    const index = flashcards.findIndex(f => f.id === flashcard.id);
    setViewingFlashcard(flashcard);
    setCurrentFlashcardIndex(index);
    setIsModalOpen(true);
  };

  const handleNavigateFlashcard = (index: number) => {
    setViewingFlashcard(flashcards[index]);
    setCurrentFlashcardIndex(index);
  };

  const handleGenerateFlashcards = async () => {
    await generateFlashcards();
  };

  const handleBackToBook = () => {
    navigate(`/book/${id}`);
  };

  if (loading || !book) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="text-lg">Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Helmet>
        <title>{book.name} - Flashcards | Pensive</title>
        <meta name="description" content={`Flashcards for ${book.name}`} />
      </Helmet>
      
      <div className="container mx-auto px-4 py-6">
        <div className="max-w-7xl mx-auto space-y-6">
          {/* Header */}
          <div className="flex items-center gap-4 mb-6">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleBackToBook}
              className="flex items-center gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Book
            </Button>
            <div className="h-6 w-px bg-border" />
            <h1 className="text-2xl font-bold">{book.name} - Flashcards</h1>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
            {/* Book Info Sidebar */}
            <div className="col-span-full lg:col-span-1">
              <BookInfo
                name={book.name}
                subtitle={book.subtitle}
                coverUrl={book.cover_url}
                bookId={parseInt(id || "0")}
                author={book.author}
                showTextOnCover={book.show_text_on_cover}
              />
            </div>

            {/* Main Content */}
            <div className="col-span-full lg:col-span-3">
              <div className="space-y-6">
                {/* Action Buttons */}
                <div className="flex flex-wrap gap-3">
                  <Button
                    onClick={handleCreateFlashcard}
                    className="flex items-center gap-2"
                  >
                    <Plus className="h-4 w-4" />
                    Add Flashcard
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setIsGenerateDialogOpen(true)}
                    className="flex items-center gap-2"
                    disabled={generating}
                  >
                    <Sparkles className="h-4 w-4" />
                    Generate Flashcards
                  </Button>
                </div>

                {/* Flashcards List */}
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold">
                      Your Flashcards ({flashcards.length})
                    </h2>
                  </div>
                  
                  <FlashcardList
                    flashcards={flashcards}
                    onEdit={handleEditFlashcard}
                    onDelete={handleDeleteFlashcard}
                    onView={handleViewFlashcard}
                    loading={flashcardsLoading}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Dialogs */}
      <FlashcardEditor
        flashcard={editingFlashcard}
        isOpen={isEditorOpen}
        onClose={() => setIsEditorOpen(false)}
        onSave={handleSaveFlashcard}
        loading={saving}
      />

      <GenerateFlashcardsDialog
        isOpen={isGenerateDialogOpen}
        onClose={() => setIsGenerateDialogOpen(false)}
        onGenerate={handleGenerateFlashcards}
        generating={generating}
      />

      <FlashcardModal
        flashcard={viewingFlashcard}
        flashcards={flashcards}
        currentIndex={currentFlashcardIndex}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onNavigate={handleNavigateFlashcard}
      />
    </div>
  );
};

export default BookFlashcards;
