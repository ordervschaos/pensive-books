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
import { Helmet } from "react-helmet-async";

const LOCALSTORAGE_BOOKMARKS_KEY = 'bookmarked_pages';

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
  
  const getNumericId = (param: string | undefined) => {
    if (!param) return 0;
    const match = param.match(/^(\d+)/);
    return match ? parseInt(match[1]) : 0;
  };
  
  const numericBookId = getNumericId(bookId);
  const numericPageId = getNumericId(pageId);
  const { canEdit, loading: loadingPermissions } = useBookPermissions(numericBookId.toString());

  const updateBookmark = async (pageIndex: number) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();

      if (session) {
        const { data: userData, error: fetchError } = await supabase
          .from('user_data')
          .select('bookmarked_pages')
          .eq('user_id', session.user.id)
          .maybeSingle();

        if (fetchError) throw fetchError;

        const bookmarks = (userData?.bookmarked_pages as Record<string, number>) || {};
        const updatedBookmarks = { ...bookmarks, [numericBookId]: pageIndex };

        const { error: updateError } = await supabase
          .from('user_data')
          .update({ bookmarked_pages: updatedBookmarks })
          .eq('user_id', session.user.id);

        if (updateError) throw updateError;
      } else {
        const storedBookmarks = localStorage.getItem(LOCALSTORAGE_BOOKMARKS_KEY);
        const bookmarks = storedBookmarks ? JSON.parse(storedBookmarks) : {};
        const updatedBookmarks = { ...bookmarks, [numericBookId]: pageIndex };
        localStorage.setItem(LOCALSTORAGE_BOOKMARKS_KEY, JSON.stringify(updatedBookmarks));
      }
    } catch (error: any) {
      console.error('Error updating bookmark:', error);
      toast({
        variant: "destructive",
        title: "Error updating bookmark",
        description: error.message
      });
    }
  };

  const fetchPageDetails = async () => {
    try {
      setLoading(true);
      console.log("Fetching page details for pageId:", numericPageId);
      
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
      
      if (pageData && !pageId?.includes('-') && pageData.title) {
        const slug = `${numericPageId}-${pageData.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
        navigate(`/book/${bookId}/page/${slug}`, { replace: true });
      }
      
      setPage(pageData);

      const { data: bookData, error: bookError } = await supabase
        .from("books")
        .select("*")
        .eq("id", numericBookId)
        .eq("is_archived", false)
        .maybeSingle();

      if (bookError) throw bookError;
      if (!bookData) {
        console.log("Book not found:", numericBookId);
        return;
      }
      
      console.log("Book data fetched:", bookData);
      
      if (bookData && !bookId?.includes('-') && bookData.name) {
        const slug = `${numericBookId}-${bookData.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
        navigate(`/book/${slug}/page/${pageId}`, { replace: true });
      }
      
      setBook(bookData);

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

      // Update bookmark when page loads
      if (currentPageIndex !== -1) {
        updateBookmark(currentPageIndex);
      }

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

  const getTitleFromHtml = (html: string) => {
    // the first line of the html content is the title and it's an h1 tag
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const h1 = doc.querySelector('h1');
    const title = h1?.textContent?.trim() || 'Untitled';
    return title;
  }

  const handleSave = async (html: string) => {
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
          title: getTitleFromHtml(html),
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

  const createNewPage = async (insertAfterIndex?: number) => {
    if (!canEdit) {
      toast({
        variant: "destructive",
        title: "Permission denied",
        description: "You don't have permission to create pages in this book"
      });
      return;
    }

    try {
      // If no specific index is provided, append to the end
      const targetIndex = insertAfterIndex !== undefined ? insertAfterIndex + 1 : currentIndex + 1;
      
      // First, update the page indices of all pages that come after the insertion point
      const { data: pagesToUpdate, error: fetchError } = await supabase
        .from('pages')
        .select('id, page_index')
        .eq('book_id', parseInt(bookId || "0"))
        .gte('page_index', targetIndex)
        .order('page_index', { ascending: false }); // Order in descending order
      
      if (fetchError) throw fetchError;
      
      // Update each page's index to make room for the new page
      // Process in descending order to avoid conflicts with the unique constraint
      if (pagesToUpdate && pagesToUpdate.length > 0) {
        for (const page of pagesToUpdate) {
          const { error: updateError } = await supabase
            .from('pages')
            .update({ page_index: page.page_index + 1 })
            .eq('id', page.id);
          
          if (updateError) throw updateError;
        }
      }
      
      // Now insert the new page at the target index
      const { data: newPage, error } = await supabase
        .from('pages')
        .insert({
          book_id: parseInt(bookId || "0"),
          page_index: targetIndex,
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
        // Update bookmark when navigating to a new page
        updateBookmark(index);
        
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
      if (!isEditing) {
        if (event.key === 'ArrowRight' && currentIndex < totalPages - 1) {
          navigateToPage(currentIndex + 1);
        } else if (event.key === 'ArrowLeft' && currentIndex > 0) {
          navigateToPage(currentIndex - 1);
        }
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

  // Extract a text preview from HTML content for meta description
  const getTextPreview = (htmlContent: string) => {
    // Create a temporary div to parse HTML
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = htmlContent || '';
    
    // Get text content and limit to 160 characters for meta description
    const textContent = tempDiv.textContent || '';
    return textContent.substring(0, 160) + (textContent.length > 160 ? '...' : '');
  };

  // Construct absolute URLs for Open Graph meta tags
  const currentUrl = window.location.href;
  const coverImageUrl = book.cover_url 
    ? new URL(book.cover_url, window.location.origin).toString()
    : `${window.location.origin}/default-book-cover.png`;
  
  const pageDescription = getTextPreview(page.html_content || '');
  const pageTitle = `${page.title} - ${book.name}`;

  return (
    <div className="min-h-[calc(100vh-56px)] flex flex-col bg-background">
      <Helmet>
        {/* Primary Meta Tags */}
        <title>{pageTitle}</title>
        <meta name="title" content={pageTitle} />
        <meta name="description" content={pageDescription} />
        
        {/* Open Graph / Facebook */}
        <meta property="og:type" content="article" />
        <meta property="og:url" content={currentUrl} />
        <meta property="og:title" content={pageTitle} />
        <meta property="og:description" content={pageDescription} />
        <meta property="og:image" content={coverImageUrl} />
        
        {/* Twitter */}
        <meta property="twitter:card" content="summary_large_image" />
        <meta property="twitter:url" content={currentUrl} />
        <meta property="twitter:title" content={pageTitle} />
        <meta property="twitter:description" content={pageDescription} />
        <meta property="twitter:image" content={coverImageUrl} />
        
        {/* Book and article specific metadata */}
        {book.author && <meta property="article:author" content={book.author} />}
        {book.published_at && <meta property="article:published_time" content={book.published_at} />}
      </Helmet>
      
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
            canEdit={canEdit}
            pageId={pageId}
          />
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
    </div>
  );
};

export default PageView;
