import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { BookInfo } from "@/components/book/BookInfo";

interface Book {
  id?: number;
  name: string;
  subtitle: string | null;
  author: string | null;
  is_public: boolean;
  cover_url?: string | null;
}

const BookEdit = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [book, setBook] = useState<Book>({
    name: "",
    subtitle: "",
    author: "",
    is_public: false
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
        <div className="flex items-center mb-8">
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

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div>
            <BookInfo 
              {...book}
              onTogglePublish={async () => {
                const newValue = !book.is_public;
                setBook({ ...book, is_public: newValue });
                await handleSave({ preventDefault: () => {} } as React.FormEvent);
              }}
              publishing={saving}
            />
          </div>

          <form onSubmit={handleSave} className="space-y-6">
            <div className="space-y-4">
              <div>
                <Label htmlFor="name">Book title</Label>
                <Input
                  id="name"
                  value={book.name}
                  onChange={(e) => setBook({ ...book, name: e.target.value })}
                  placeholder="Enter book title"
                />
              </div>

              <div>
                <Label htmlFor="subtitle">Subtitle</Label>
                <Input
                  id="subtitle"
                  value={book.subtitle || ""}
                  onChange={(e) => setBook({ ...book, subtitle: e.target.value })}
                  placeholder="Enter subtitle"
                />
              </div>

              <div>
                <Label htmlFor="author">Author</Label>
                <Input
                  id="author"
                  value={book.author || ""}
                  onChange={(e) => setBook({ ...book, author: e.target.value })}
                  placeholder="Enter author name"
                />
              </div>
            </div>

            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : "Save changes"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default BookEdit;