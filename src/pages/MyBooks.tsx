
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { BookBookmark, Plus, FileUp } from "lucide-react";
import { BookGrid } from "@/components/book/BookGrid";
import { setPageTitle } from "@/utils/pageTitle";

export default function MyBooks() {
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    setPageTitle('My Books');
    fetchBooks();
  }, []);

  const fetchBooks = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("books")
        .select("*")
        .order("updated_at", { ascending: false });

      if (error) throw error;
      setBooks(data || []);
    } catch (error) {
      console.error("Error fetching books:", error);
      toast({
        title: "Error fetching books",
        description: "There was an error loading your books",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto p-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
          <h1 className="text-3xl font-bold tracking-tight">My Books</h1>
          <div className="flex flex-col sm:flex-row gap-2">
            <Button onClick={() => navigate("/book/new")} className="flex-1 sm:flex-none">
              <Plus className="mr-2 h-4 w-4" />
              New Book
            </Button>
            <Button onClick={() => navigate("/book/import-pdf")} variant="outline" className="flex-1 sm:flex-none">
              <FileUp className="mr-2 h-4 w-4" />
              Import PDF
            </Button>
            <Button onClick={() => navigate("/generate-book")} variant="outline" className="flex-1 sm:flex-none">
              <BookBookmark className="mr-2 h-4 w-4" />
              Generate with AI
            </Button>
          </div>
        </div>

        <BookGrid 
          books={books} 
          loading={loading} 
          emptyMessage="You don't have any books yet. Create a new book or import a PDF to get started." 
        />
      </div>
    </div>
  );
}
