import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { PageNavigation } from "@/components/page/PageNavigation";
import { PageContent } from "@/components/page/PageContent";
import { PageLoading } from "@/components/page/PageLoading";
import { PageNotFound } from "@/components/page/PageNotFound";
import { useBookPermissions } from "@/hooks/use-book-permissions";

const PageView = () => {
  const { bookId, pageId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [page, setPage] = useState<any>(null);
  const [book, setBook] = useState<any>(null);
  const [nextPageTitle, setNextPageTitle] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [totalPages, setTotalPages] = useState(0);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isEditing, setIsEditing] = useState(false);
  const { canEdit, loading: loadingPermissions } = useBookPermissions(bookId);

  const fetchPageDetails = async () => {
    try {
      setLoading(true);
      console.log("Fetching page details for pageId:", pageId);
      
      // Fetch current page
      const { data: pageData, error: pageError } = await supabase
        .from("pages")
        .select("*")
        .eq("id", parseInt(pageId || "0"))
        .eq("book_id", parseInt(bookId || "0"))
        .single();

      if (pageError) throw pageError;
      console.log("Page data fetched:", pageData);
      setPage(pageData);

      // Fetch book details
      const { data: bookData, error: bookError } = await supabase
        .from("books")
        .select("*")
        .eq("id", parseInt(bookId || "0"))
        .single();

      if (bookError) throw bookError;
      console.log("Book data fetched:", bookData);
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
    if (!canEdit) {
      toast({
        variant: "destructive",
        title: "Permission denied",
        description: "You don't have permission to edit this page"
      });
      return;
    }

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
        .eq("page_index", index)
        .single();

      if (error) throw error;
      if (nextPage) {
        navigate(`/book/${bookId}/page/${nextPage.id}`);
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
    console.log("PageId changed, fetching new page details");
    fetchPageDetails();
  }, [bookId, pageId]);

  if (loading || loadingPermissions) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <div className="flex-1 container max-w-4xl mx-auto px-4 py-4">
          <PageLoading />
        </div>
      </div>
    );
  }

  if (!page || !book) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <div className="flex-1 container max-w-4xl mx-auto px-4 py-4">
          <PageNotFound bookId={bookId || ""} />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <div className="flex-1 container max-w-5xl mx-auto px-4 py-4 flex flex-col gap-4">
        <div className="flex-1 flex flex-col">
          <PageContent
            content={page.html_content || ''}
            title={page.title || 'Untitled'}
            onSave={handleSave}
            saving={saving}
            pageType={page.page_type}
            editable={canEdit}
            onEditingChange={setIsEditing}
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
