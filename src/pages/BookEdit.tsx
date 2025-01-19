import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { BookInfo } from "@/components/book/BookInfo";
import { BookEditForm } from "@/components/book/BookEditForm";
import { InviteCollaboratorSheet } from "@/components/book/InviteCollaboratorSheet";

interface Book {
  id?: number;
  name: string;
  subtitle: string | null;
  author: string | null;
  is_public: boolean;
  cover_url?: string | null;
  created_at?: string;
  updated_at?: string;
  published_at?: string | null;
}

export default function BookEdit() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [book, setBook] = useState<Book>({
    name: "",
    subtitle: "",
    author: "",
    is_public: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    published_at: null
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (id) {
      fetchBook();
    } else {
      setLoading(false);
    }
  }, [id]);

  const fetchBook = async () => {
    try {
      const { data, error } = await supabase
        .from("books")
        .select("*")
        .eq("id", parseInt(id || "0"))
        .single();

      if (error) throw error;
      
      if (data) {
        setBook(data);
      }
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error fetching book",
        description: error.message
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSaving(true);
      
      const { error } = await supabase
        .from("books")
        .update(book)
        .eq("id", parseInt(id || "0"));

      if (error) throw error;

      toast({
        title: "Success",
        description: "Book updated successfully"
      });

      navigate(`/book/${id}`);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error saving book",
        description: error.message
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div>Loading...</div>;
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto p-6">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center">
            <Button 
              variant="ghost" 
              size="icon"
              onClick={() => navigate(-1)}
              className="mr-4"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <h1 className="text-2xl font-semibold">Edit Book</h1>
          </div>

          {id && <InviteCollaboratorSheet bookId={parseInt(id)} />}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div>
            <BookInfo 
              name={book.name}
              isPublic={book.is_public}
              createdAt={book.created_at || new Date().toISOString()}
              updatedAt={book.updated_at || new Date().toISOString()}
              publishedAt={book.published_at}
              bookId={book.id || 0}
              coverUrl={book.cover_url}
              onTogglePublish={async () => {
                const newValue = !book.is_public;
                setBook({ ...book, is_public: newValue });
                await handleSave({ preventDefault: () => {} } as React.FormEvent);
              }}
              publishing={saving}
            />
          </div>

          <BookEditForm
            book={book}
            onBookChange={setBook}
            onSave={handleSave}
            saving={saving}
          />
        </div>
      </div>
    </div>
  );
}