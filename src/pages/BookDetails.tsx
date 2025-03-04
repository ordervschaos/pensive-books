
import { useParams, Link, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { BookHeader } from "@/components/book/BookHeader";
import { PagesList } from "@/components/book/pageList";
import { BookInfo } from "@/components/book/BookInfo";
import { BookActionsBar } from "@/components/book/BookActionsBar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ContinueReadingButton } from "@/components/book/ContinueReadingButton";
import { NavTabs } from "@/components/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Pencil, PlusCircle, Share } from "lucide-react";
import { ShareBookSheet } from "@/components/book/ShareBookSheet";
import { useBookPermissions } from "@/hooks/use-book-permissions";
import { ManageCollaboratorsSheet } from "@/components/book/ManageCollaboratorsSheet";

export default function BookDetails() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [book, setBook] = useState<any>(null);
  const [pages, setPages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [notebookId, setNotebookId] = useState<number | null>(null);
  const { canEdit, isOwner, loadingPermissions } = useBookPermissions(id ? parseInt(id) : null);

  useEffect(() => {
    if (!id) return;
    
    const bookId = parseInt(id);
    setNotebookId(bookId);
    
    const fetchBookDetails = async () => {
      try {
        setLoading(true);
        
        // Fetch book details
        const { data: bookData, error: bookError } = await supabase
          .from('books')
          .select('*')
          .eq('id', bookId)
          .single();
          
        if (bookError) throw bookError;
        setBook(bookData);
        
        // Fetch pages
        const { data: pagesData, error: pagesError } = await supabase
          .from('pages')
          .select('*')
          .eq('book_id', bookId)
          .eq('archived', false)
          .order('page_index', { ascending: true });
          
        if (pagesError) throw pagesError;
        setPages(pagesData || []);
        
      } catch (error) {
        console.error('Error fetching book details:', error);
      } finally {
        setLoading(false);
      }
    };
    
    fetchBookDetails();
  }, [id]);

  const handleEditBook = () => {
    if (id) {
      navigate(`/book/${id}/edit`);
    }
  };

  const handleCreateNewPage = async () => {
    if (!id || !book) return;
    
    try {
      // Get the next page index
      const nextPageIndex = pages.length > 0 
        ? Math.max(...pages.map(p => p.page_index || 0)) + 1 
        : 0;
      
      // Create a new page
      const { data, error } = await supabase
        .from('pages')
        .insert([{
          book_id: parseInt(id),
          page_index: nextPageIndex,
          title: 'Untitled',
          html_content: '<h1>Untitled</h1><p>Start writing here...</p>',
          page_type: 'text'
        }])
        .select()
        .single();
        
      if (error) throw error;
      
      // Navigate to the new page
      navigate(`/book/${id}/page/${data.id}`);
    } catch (error) {
      console.error('Error creating new page:', error);
    }
  };

  const refreshPages = async () => {
    if (!id) return;
    
    try {
      const { data, error } = await supabase
        .from('pages')
        .select('*')
        .eq('book_id', parseInt(id))
        .eq('archived', false)
        .order('page_index', { ascending: true });
        
      if (error) throw error;
      setPages(data || []);
    } catch (error) {
      console.error('Error refreshing pages:', error);
    }
  };

  if (loading || loadingPermissions) {
    return (
      <div className="container max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-1/4"></div>
          <div className="h-64 bg-gray-200 dark:bg-gray-700 rounded"></div>
          <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-1/2"></div>
        </div>
      </div>
    );
  }

  if (!book) {
    return (
      <div className="container max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        <Card>
          <CardHeader>
            <CardTitle>Book Not Found</CardTitle>
            <CardDescription>The book you're looking for doesn't exist or you don't have permission to view it.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link to="/my-books">Go to My Books</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
      <div className="mb-6">
        <BookHeader title={book.name} subtitle={book.subtitle} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1">
          <div className="space-y-6">
            <BookInfo bookId={parseInt(id!)} canEdit={canEdit} />
            
            {/* Book Actions */}
            <div className="space-y-3">
              <ContinueReadingButton bookId={parseInt(id!)} pages={pages} />
              
              {canEdit && (
                <Button 
                  variant="outline" 
                  className="w-full" 
                  onClick={handleCreateNewPage}
                >
                  <PlusCircle className="h-4 w-4 mr-2" />
                  Create New Page
                </Button>
              )}
              
              {canEdit && (
                <Button 
                  variant="outline" 
                  className="w-full" 
                  onClick={handleEditBook}
                >
                  <Pencil className="h-4 w-4 mr-2" />
                  Edit Book
                </Button>
              )}
              
              <ShareBookSheet bookId={parseInt(id!)} />
              
              {isOwner && (
                <ManageCollaboratorsSheet 
                  bookId={parseInt(id!)} 
                  onCollaboratorAdded={refreshPages}
                />
              )}
            </div>

            {/* Book Information */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">Book Information</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="space-y-2 text-sm">
                  <div>
                    <dt className="text-muted-foreground">Created</dt>
                    <dd>{new Date(book.created_at).toLocaleDateString()}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Last Updated</dt>
                    <dd>{new Date(book.updated_at).toLocaleDateString()}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Pages</dt>
                    <dd>{pages.length}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Visibility</dt>
                    <dd className="flex items-center">
                      {book.is_public ? (
                        <>
                          <Globe className="h-3.5 w-3.5 text-green-500 mr-1" />
                          Public
                        </>
                      ) : (
                        <>
                          <Lock className="h-3.5 w-3.5 text-gray-500 mr-1" />
                          Private
                        </>
                      )}
                    </dd>
                  </div>
                  {book.photographer && (
                    <div>
                      <dt className="text-muted-foreground">Cover Photo</dt>
                      <dd>
                        By{" "}
                        <a 
                          href={`https://unsplash.com/@${book.photographer_username}?utm_source=pensive&utm_medium=referral`} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="underline"
                        >
                          {book.photographer}
                        </a>{" "}
                        on{" "}
                        <a 
                          href="https://unsplash.com/?utm_source=pensive&utm_medium=referral" 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="underline"
                        >
                          Unsplash
                        </a>
                      </dd>
                    </div>
                  )}
                </dl>
              </CardContent>
            </Card>
          </div>
        </div>

        <div className="lg:col-span-2">
          <Tabs defaultValue="pages">
            <TabsList className="mb-4">
              <TabsTrigger value="pages">Pages</TabsTrigger>
            </TabsList>
            <TabsContent value="pages">
              <PagesList 
                pages={pages} 
                bookId={parseInt(id!)}
                onPagesUpdated={refreshPages}
                canEdit={canEdit}
              />
            </TabsContent>
          </Tabs>
        </div>
      </div>

      <BookActionsBar bookId={parseInt(id!)} />
    </div>
  );
}

// Missing imports (added here)
import { Globe, Lock } from "lucide-react";
