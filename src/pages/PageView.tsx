import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { TopNav } from "@/components/TopNav";
import { useToast } from "@/hooks/use-toast";
import { PageNavigation } from "@/components/page/PageNavigation";
import { PageContent } from "@/components/page/PageContent";
import { PageLoading } from "@/components/page/PageLoading";
import { PageNotFound } from "@/components/page/PageNotFound";
import { 
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Maximize2, Search, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";

const PageView = () => {
  const { bookId, pageId } = useParams();
  const { toast } = useToast();
  const [page, setPage] = useState<any>(null);
  const [book, setBook] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

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

  const navigateToPage = (index: number) => {
    if (!book?.page_ids || !book.page_ids[index]) return;
    window.location.href = `/book/${bookId}/page/${book.page_ids[index]}`;
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

  const currentIndex = book.page_ids?.indexOf(page.id) ?? -1;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <TopNav />
      <div className="border-b bg-background">
        <div className="container max-w-7xl mx-auto px-4">
          <div className="flex items-center justify-between h-14">
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  <Link className="transition-colors hover:text-foreground text-muted-foreground" to="/">Books</Link>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <Link className="transition-colors hover:text-foreground text-muted-foreground" to={`/book/${bookId}`}>{book.name}</Link>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage>{page.title || 'Untitled'}</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon">
                <Search className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon">
                <Maximize2 className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon">
                <Settings className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
      <div className="flex-1 container max-w-5xl mx-auto px-4 py-4 flex flex-col gap-4">
        <PageNavigation
          bookId={bookId || ""}
          currentIndex={currentIndex}
          totalPages={book.page_ids?.length ?? 0}
          onNavigate={navigateToPage}
        />
        <div className="flex-1 flex flex-col">
          <PageContent
            content={page.html_content || ''}
            title={page.title || 'Untitled'}
            onSave={handleSave}
            saving={saving}
          />
        </div>
      </div>
    </div>
  );
};

export default PageView;
