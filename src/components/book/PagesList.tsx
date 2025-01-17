import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BookOpen, FilePlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface Page {
  id: number;
  page_index: number;
  updated_at: string;
}

interface PagesListProps {
  pages: Page[];
  bookId: number;
}

export const PagesList = ({ pages, bookId }: PagesListProps) => {
  const navigate = useNavigate();
  const { toast } = useToast();

  const createNewPage = async () => {
    try {
      // Insert new page
      const { data: newPage, error } = await supabase
        .from('pages')
        .insert({
          book_id: bookId,
          page_index: pages.length,
          content: {},
          html_content: ''
        })
        .select()
        .single();

      if (error) throw error;

      // Navigate to the new page
      navigate(`/book/${bookId}/page/${newPage.id}`);

      toast({
        title: "Page created",
        description: "Your new page has been created"
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error creating page",
        description: error.message
      });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <Button 
          onClick={createNewPage}
          className="flex items-center gap-2"
        >
          <FilePlus className="h-4 w-4" />
          Add Page
        </Button>
      </div>

      {pages.length === 0 ? (
        <Card>
          <CardContent className="text-center py-6">
            <BookOpen className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No pages yet</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {pages.map((page) => (
            <Card 
              key={page.id} 
              className="hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => navigate(`/book/${bookId}/page/${page.id}`)}
            >
              <CardHeader>
                <CardTitle className="text-lg">
                  Page {page.page_index + 1}
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Last modified {new Date(page.updated_at).toLocaleDateString()}
                </p>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};