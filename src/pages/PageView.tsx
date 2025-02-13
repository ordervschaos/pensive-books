import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { PageNavigation } from "@/components/page/PageNavigation";
import { PageContent } from "@/components/page/PageContent";
import { PageLoading } from "@/components/page/PageLoading";
import { PageNotFound } from "@/components/page/PageNotFound";
import { useBookPermissions } from "@/hooks/use-book-permissions";
import { setPageTitle } from "@/utils/pageTitle";

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
  
  // Extract numeric ID from URL parameter
  const getNumericId = (param: string | undefined) => {
    if (!param) return 0;
    return parseInt(param.split('-')[0]);
  };
  
  const numericBookId = getNumericId(bookId);
  const numericPageId = getNumericId(pageId);
  const { canEdit, loading: loadingPermissions } = useBookPermissions(numericBookId.toString());

  const fetchPageDetails = async () => {
    try {
      setLoading(true);
      console.log("Fetching page details for pageId:", numericPageId);
      
      // Fetch current page using maybeSingle() instead of single()
      const { data: pageData, error: pageError } = await supabase
        .from("pages")
        .select("*")
        .eq("id", numericPageId)
        .eq("book_id", numericBookId)
        .eq("archived", false)
        .maybeSingle();

      if (pageError) throw pageError;
      if (!pageData) {
        console.log("Page not found:", numericPageId);
        return;
      }
      
      console.log("Page data fetched:", pageData);
      
      // Update URL with slug if it exists
      if (pageData && !pageId?.includes('-') && pageData.title) {
        const slug = `${numericPageId}-${pageData.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
        navigate(`/book/${bookId}/page/${slug}`, { replace: true });
      }
      
      setPage(pageData);

      // Fetch book details using maybeSingle()
      const { data: bookData, error: bookError } = await supabase
        .from("books")
        .select("*")
        .eq("id", numericBookId)
        .eq("archived", false)
        .maybeSingle();

      if (bookError) throw bookError;
      if (!bookData) {
        console.log("Book not found:", numericBookId);
        return;
      }
      
      console.log("Book data fetched:", bookData);
      
      // Update book URL with slug if it exists
      if (bookData && !bookId?.includes('-') && bookData.name) {
        const slug = `${numericBookId}-${bookData.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
        navigate(`/book/${slug}/page/${pageId}`, { replace: true });
      }
      
      setBook(bookData);

      // Get total pages count and next page
      const { data: pagesData, error: pagesError } = await supabase
        .from("pages")
        .select("id, title, page_index")
        .eq("book_id", numericBookId)
        .eq("archived", false)
        .order("page_index", { ascending: true });

      if (pagesError) throw pagesError;

      setTotalPages(pagesData.length);
      const currentPageIndex = pagesData.findIndex(p => p.id === numericPageId);
      setCurrentIndex(currentPageIndex);

      // Get next page title if not the last page
      if (currentPageIndex < pagesData.length - 1) {
        const nextPage = pagesData[currentPageIndex + 1];
        setNextPageTitle(nextPage.title || "");
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

  const createNewPage = async () => {
    if (!canEdit) {
      toast({
        variant: "destructive",
        title: "Permission denied",
        description: "You don't have permission to create pages in this book"
      });
      return;
    }

    try {
      const maxPageIndex = currentIndex + 1;
      
      const { data: newPage, error } = await supabase
        .from('pages')
        .insert({
          book_id: parseInt(bookId || "0"),
          page_index: maxPageIndex,
          content: {},
          html_content: '',
          page_type: 'text'
        })
        .select()
        .single();

      if (error) throw error;

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

  const navigateToPage = async (index: number) => {
    try {
      const { data: nextPage, error } = await supabase
        .from("pages")
        .select("id, title")
        .eq("book_id", numericBookId)
        .eq("page_index", index)
        .eq("archived", false)
        .single();

      if (error) throw error;
      if (nextPage) {
        const slug = nextPage.title ? 
          `${nextPage.id}-${nextPage.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` : 
          nextPage.id.toString();
        navigate(`/book/${bookId}/page/${slug}`);
      }
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error navigating to page",
        description: error.message
      });
    }
  };

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyPress = (event: KeyboardEvent) => {
      // Only allow navigation if not editing
      if (!isEditing && event.key === 'ArrowRight' && currentIndex < totalPages - 1) {
        navigateToPage(currentIndex + 1);
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [currentIndex, totalPages, isEditing]);

  useEffect(() => {
    console.log("PageId changed, fetching new page details");
    fetchPageDetails();
  }, [bookId, pageId]);

  // Add effect to update page title when page or book data changes
  useEffect(() => {
    if (page && book) {
      setPageTitle(`${page.title} - ${book.name}`);
    }
  }, [page?.title, book?.name]);

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
            content={page?.html_content || ''}
            title={page?.title || 'Untitled'}
            onSave={handleSave}
            saving={saving}
            pageType={page?.page_type}
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
          bookTitle={book?.name}
          isEditing={isEditing}
          onNewPage={createNewPage}
          canEdit={canEdit}
        />
      </div>
    </div>
  );
};

export default PageView;

