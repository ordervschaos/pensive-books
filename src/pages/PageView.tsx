import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { TopNav } from "@/components/TopNav";
import { useToast } from "@/hooks/use-toast";
import { PageNavigation } from "@/components/page/PageNavigation";
import { PageContent } from "@/components/page/PageContent";
import { PageLoading } from "@/components/page/PageLoading";
import { PageNotFound } from "@/components/page/PageNotFound";
import { Maximize2, Search, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";

const PageView = () => {
  const { bookId, pageId } = useParams();
  const { toast } = useToast();
  const [page, setPage] = useState<any>(null);
  const [book, setBook] = useState<any>(null);
  const [nextPageTitle, setNextPageTitle] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [totalPages, setTotalPages] = useState(0);
  const [currentIndex, setCurrentIndex] = useState(0);

  const fetchPageDetails = async () => {
    try {
      // Fetch current page
      const { data: pageData, error: pageError } = await supabase
        .from("pages")
        .select("*")
        .eq("id", parseInt(pageId || "0"))
        .eq("book_id", parseInt(bookId || "0"))
        .single();

      if (pageError) throw pageError;
      setPage(pageData);

      // Fetch book details
      const { data: bookData, error: bookError } = await supabase
        .from("books")
        .select("*")
        .eq("id", parseInt(bookId || "0"))
        .single();

      if (bookError) throw bookError;
      setBook(bookData);

      // Get total pages count and next page
      const { data: pagesData, error: pagesError } = await supabase
        .from("pages")
        .select("id, title, page_index")
        .eq("book_id", parseInt(bookId || "0"))
        .eq("archived", false)
        .order("page_index", { ascending: true });

      if (pagesError) throw pagesError;

      setTotalPages(pagesData.length);
      const currentPageIndex = pagesData.findIndex(p => p.id === parseInt(pageId || "0"));
      setCurrentIndex(currentPageIndex);

      // Get next page title if not the last page
      if (currentPageIndex < pagesData.length - 1) {
        const nextPage = pagesData[currentPageIndex + 1];
        setNextPageTitle(nextPage.title || "Untitled");
      }

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

  const handleSave = async (html: string, content: any, title?: string) => {
    try {
      setSaving(true);
      const { error } = await supabase
        .from("pages")
        .update({ 
          html_content: html,
          content: content,
          title: title || 'Untitled',
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

  const navigateToPage = async (index: number) => {
    try {
      const { data: nextPage, error } = await supabase
        .from("pages")
        .select("id")
        .eq("book_id", parseInt(bookId || "0"))
        .eq("page_index", index-1)
        .single();

      if (error) throw error;
      if (nextPage) {
        window.location.href = `/book/${bookId}/page/${nextPage.id}`;
      }
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error navigating to page",
        description: error.message
      });
    }
  };

  useEffect(() => {
    fetchPageDetails();
  }, [bookId, pageId]);

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <TopNav />
        <div className="flex-1 container max-w-4xl mx-auto px-4 py-4">
          <PageLoading />
        </div>
      </div>
    );
  }

  if (!page || !book) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <TopNav />
        <div className="flex-1 container max-w-4xl mx-auto px-4 py-4">
          <PageNotFound bookId={bookId || ""} />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <TopNav />
      <div className="flex-1 container max-w-5xl mx-auto px-4 py-4 flex flex-col gap-4">
        <div className="flex-1 flex flex-col">
          <PageContent
            content={page.html_content || ''}
            title={page.title || 'Untitled'}
            onSave={handleSave}
            saving={saving}
          />
        </div>
        <PageNavigation
          bookId={bookId || ""}
          currentIndex={currentIndex}
          totalPages={totalPages}
          onNavigate={navigateToPage}
          nextPageTitle={nextPageTitle}
          bookTitle={book.name}
        />
      </div>
    </div>
  );
};

export default PageView;