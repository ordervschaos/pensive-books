
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { setPageTitle } from "@/utils/pageTitle";
import { BookCoverEdit } from "@/components/book/BookCoverEdit";
import { BookEditForm } from "@/components/book/BookEditForm";

interface Book {
  id?: number;
  name: string;
  subtitle: string | null;
  author: string | null;
  is_public: boolean;
  cover_url?: string | null;
  show_text_on_cover?: boolean;
  photographer?: string | null;
  photographer_username?: string | null;
}

const NewBook = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [book, setBook] = useState<Book>({
    name: "",
    subtitle: null,
    author: null,
    is_public: false,
    cover_url: null,
    show_text_on_cover: true,
    photographer: null,
    photographer_username: null
  });

  useEffect(() => {
    setPageTitle('New Book');
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSaving(true);
      
      const { data, error } = await supabase
        .from("books")
        .insert({
          name: book.name,
          subtitle: book.subtitle,
          author: book.author,
          is_public: false,
          cover_url: book.cover_url,
          show_text_on_cover: book.show_text_on_cover,
          photographer: book.photographer,
          photographer_username: book.photographer_username
        })
        .select()
        .single();

      if (error) throw error;

      toast({
        title: "Success",
        description: "Book created successfully"
      });

      navigate(`/book/${data.id}`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      toast({
        variant: "destructive",
        title: "Error creating book",
        description: errorMessage
      });
    } finally {
      setSaving(false);
    }
  };

  const handleCoverChange = (url: string, photographer?: string | null, photographerUsername?: string | null) => {
    setBook(prev => ({ 
      ...prev, 
      cover_url: url,
      photographer: photographer || null,
      photographer_username: photographerUsername || null 
    }));
  };

  const handleShowTextChange = (showText: boolean) => {
    setBook(prev => ({ ...prev, show_text_on_cover: showText }));
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto p-6">
        <div className="flex items-center mb-8">
          <Button 
            variant="ghost" 
            size="icon"
            onClick={() => navigate(-1)}
            className="mr-4"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-2xl font-semibold">Create New Book</h1>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-6 gap-8">
          <div className="w-full lg:col-span-2">
            <BookCoverEdit 
              bookId={0}
              coverUrl={book.cover_url}
              showTextOnCover={book.show_text_on_cover}
              title={book.name}
              subtitle={book.subtitle}
              author={book.author}
              photographer={book.photographer}
              onCoverChange={handleCoverChange}
              onShowTextChange={handleShowTextChange}
            />
          </div>

          <div className="lg:col-span-4">
            <BookEditForm
              book={book}
              onBookChange={setBook}
              onSave={handleSubmit}
              saving={saving}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default NewBook;
