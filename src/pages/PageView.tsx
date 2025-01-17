import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { TopNav } from "@/components/TopNav";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, ArrowRight, BookOpen, Save } from "lucide-react";
import { TipTapEditor } from "@/components/editor/TipTapEditor";

const PageView = () => {
  const { bookId, pageId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [page, setPage] = useState<any>(null);
  const [book, setBook] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchPageDetails();
  }, [bookId, pageId]);

  const fetchPageDetails = async () => {
    try {
      const { data: pageData, error: pageError } = await supabase
        .from("pages")
        .select("*")
        .eq("id", parseInt(pageId || "0"))
        .eq("book_id", parseInt(bookId || "0"))
        .single();

      if (pageError) throw pageError;
      setPage(pageData);

      const { data: bookData, error: bookError } = await supabase
        .from("books")
        .select("*")
        .eq("id", parseInt(bookId || "0"))
        .single();

      if (bookError) throw bookError;
      setBook(bookData);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error fetching page details",
        description: error.message
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (html: string, content: any) => {
    try {
      setSaving(true);
      const { error } = await supabase
        .from("pages")
        .update({ 
          html_content: html,
          content: content,
          updated_at: new Date().toISOString()
        })
        .eq("id", parseInt(pageId || "0"));

      if (error) throw error;

      toast({
        title: "Page saved",
        description: "Your changes have been saved successfully"
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error saving page",
        description: error.message
      });
    } finally {
      setSaving(false);
    }
  };

  const navigateToPage = (index: number) => {
    if (!book?.page_ids || !book.page_ids[index]) return;
    navigate(`/book/${bookId}/page/${book.page_ids[index]}`);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col">
        <TopNav />
        <div className="container mx-auto p-6 space-y-6">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-[400px] w-full" />
        </div>
      </div>
    );
  }

  if (!page || !book) {
    return (
      <div className="min-h-screen flex flex-col">
        <TopNav />
        <div className="container mx-auto p-6 text-center">
          <h1 className="text-2xl font-bold mb-4">Page not found</h1>
          <Button onClick={() => navigate(`/book/${bookId}`)}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Book
          </Button>
        </div>
      </div>
    );
  }

  const currentIndex = book.page_ids?.indexOf(page.id) ?? -1;

  return (
    <div className="min-h-screen flex flex-col">
      <TopNav />
      <div className="container mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={() => navigate(`/book/${bookId}`)}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Book
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => navigateToPage(currentIndex - 1)}
              disabled={currentIndex <= 0}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm text-muted-foreground">
              Page {currentIndex + 1} of {book.page_ids?.length ?? 0}
            </span>
            <Button
              variant="outline"
              onClick={() => navigateToPage(currentIndex + 1)}
              disabled={currentIndex === -1 || currentIndex >= (book.page_ids?.length ?? 0) - 1}
            >
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <Card>
          <CardContent className="pt-6">
            {page.html_content || page.content ? (
              <div className="space-y-4">
                <TipTapEditor 
                  content={page.html_content || ''} 
                  onChange={(html, json) => handleSave(html, json)}
                />
                <div className="flex justify-end">
                  <Button disabled={saving} onClick={() => handleSave(page.html_content, page.content)}>
                    {saving ? 'Saving...' : 'Save'}
                    {!saving && <Save className="ml-2 h-4 w-4" />}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="text-center py-12">
                <BookOpen className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">No content available</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default PageView;