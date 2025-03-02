
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { 
  GripVertical, 
  Move, 
  LayoutList, 
  LayoutGrid, 
  Trash2, 
  Type, 
  Section, 
  Plus,
  MoreVertical,
  BookmarkCheck
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Badge } from "@/components/ui/badge";

interface Page {
  id: number;
  page_index: number;
  updated_at: string;
  title: string;
  html_content?: string;
  page_type: 'text' | 'section';
}

interface PagesListProps {
  pages: Page[];
  bookId: number;
  isReorderMode?: boolean;
  isDeleteMode?: boolean;
  canEdit?: boolean;
  onDeleteModeChange?: (isDelete: boolean) => void;
}

interface SortablePageItemProps {
  page: Page;
  bookId: number;
  onNavigate: (pageId: number) => void;
  onDelete?: (pageId: number) => void;
  isBookmarked?: boolean;
}

const LOCALSTORAGE_BOOKMARKS_KEY = 'bookmarked_pages';

const SortablePageItem = ({ page, bookId, onNavigate, onDelete, isBookmarked }: SortablePageItemProps) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: page.id });

  const style = transform ? {
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
    transition,
  } : undefined;

  const wordCount = page.html_content && page.page_type === 'text' ? 
    page.html_content.replace(/<[^>]*>/g, '').trim().split(/\s+/).length : 
    0;

  return (
    <div 
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 py-4 px-6 hover:bg-accent/5 transition-colors group border-b border-border last:border-0"
    >
      <div {...attributes} {...listeners} className="cursor-grab hover:text-primary">
        <GripVertical className="h-5 w-5 transition-opacity" />
      </div>
      <div 
        className="flex-1 cursor-pointer"
        onClick={() => onNavigate(page.id)}
      >
        <div className={`flex items-center ${page.page_type === 'section' ? 'justify-center min-h-[60px]' : 'justify-between'}`}>
          <div className="flex items-center gap-2">
            <h3 className={`text-lg ${page.page_type === 'section' ? 'font-bold text-xl text-center' : ''}`}>
              {page.title || `Untitled Page ${page.page_index + 1}`}
            </h3>
            {isBookmarked && (
              <Badge variant="default" className="h-5">
                <BookmarkCheck className="h-3 w-3 mr-1" />
              </Badge>
            )}
          </div>
          {page.page_type === 'text' && (
            <span className="text-sm text-muted-foreground">
              {wordCount} words
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

const RegularPageItem = ({ page, bookId, onNavigate, onDelete, isBookmarked }: SortablePageItemProps) => {
  const wordCount = page.html_content && page.page_type === 'text' ? 
    page.html_content.replace(/<[^>]*>/g, '').trim().split(/\s+/).length : 
    0;

  return (
    <div 
      className="flex items-center justify-between py-4 px-6 hover:bg-accent/5 transition-colors border-b border-border last:border-0"
    >
      <div 
        className="flex-1 cursor-pointer"
        onClick={() => onNavigate(page.id)}
      >
        <div className={`flex items-center ${page.page_type === 'section' ? 'justify-center min-h-[60px]' : 'justify-between'}`}>
          <div className="flex items-center gap-2">
            <h3 className={`text-lg ${page.page_type === 'section' ? 'font-bold text-xl text-center' : ''}`}>
              {page.title || `Untitled Page ${page.page_index + 1}`}
            </h3>
            {isBookmarked && (
              <Badge variant="default" color="green" className="h-5">
                <BookmarkCheck className="h-3 w-3 mr-1" />
              </Badge>
            )}
          </div>
          {page.page_type === 'text' && (
            <span className="text-sm text-muted-foreground">
              {wordCount} words
            </span>
          )}
        </div>
      </div>
      {onDelete && (
        <Button
          variant="ghost"
          size="icon"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(page.id);
          }}
          className="ml-2 text-destructive hover:text-destructive hover:bg-destructive/10"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
};

const PageCard = ({ page, bookId, onNavigate, onDelete, isBookmarked }: SortablePageItemProps) => {
  const wordCount = page.html_content && page.page_type === 'text' ? 
    page.html_content.replace(/<[^>]*>/g, '').trim().split(/\s+/).length : 
    0;

  const excerpt = page.html_content ? page.html_content.replace(/<h1[^>]*>.*?<\/h1>/g, '') : ''

  return (
    <Card 
      onClick={() => onNavigate(page.id)}
      className="cursor-pointer hover:bg-accent/5 transition-colors relative group overflow-hidden"
    >
      <div className="aspect-[3/4] relative">
        <CardContent className="absolute inset-0 p-4 flex flex-col overflow-hidden">
          {/* Page Header */}
          <div className={`mb-3 pb-3 border-b border-border/50 ${page.page_type === 'section' ? 'flex-1 flex items-center justify-center' : ''}`}>
            <div className="flex items-center gap-2 justify-between">
              <h3 className={`${page.page_type === 'section' ? 'text-xl font-bold text-center' : 'text-base font-medium'} line-clamp-2`}>
                {page.title || `Untitled Page ${page.page_index + 1}`}
              </h3>
              {isBookmarked && (
                <Badge variant="default" color="green" className="h-5 shrink-0">
                  <BookmarkCheck  className="h-3 w-3 mr-1" />
                </Badge>
              )}
            </div>
          </div>
          
          {/* Page Content Preview - Only show for text pages */}
          {page.page_type === 'text' && (
            <div className="flex-1 relative">
              <div className="text-xs prose text-muted-foreground space-y-2 overflow-hidden"
                dangerouslySetInnerHTML={{ __html: excerpt }}
              >
              </div>
              {/* Gradient fade out effect */}
              <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-background to-transparent" />
            </div>
          )}

          {/* Footer */}
          <div className="mt-auto pt-2 flex items-center justify-between text-xs text-muted-foreground">
            {page.page_type === 'text' && <span>{wordCount} words</span>}
            <span className={`${page.page_type === 'section' ? 'mx-auto' : 'ml-auto'}`}>Page {page.page_index + 1}</span>
          </div>
        </CardContent>
      </div>

      {onDelete && (
        <Button
          variant="ghost"
          size="icon"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(page.id);
          }}
          className="absolute top-2 right-2 text-destructive opacity-0 group-hover:opacity-100 transition-opacity hover:text-destructive hover:bg-destructive/10"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      )}
    </Card>
  );
};

export const PagesList = ({ 
  pages, 
  bookId, 
  isReorderMode = false, 
  isDeleteMode = false, 
  canEdit = false,
  onDeleteModeChange 
}: PagesListProps) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [items, setItems] = useState<Page[]>(
    [...pages].sort((a, b) => a.page_index - b.page_index)
  );
  const [isReordering, setIsReordering] = useState(isReorderMode);
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('grid');
  const [previousViewMode, setPreviousViewMode] = useState<'list' | 'grid'>('grid');
  const [bookmarkedPageIndex, setBookmarkedPageIndex] = useState<number | null>(null);

  useEffect(() => {
    const fetchBookmarkedPage = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        
        if (session) {
          const { data: userData } = await supabase
            .from('user_data')
            .select('bookmarked_pages')
            .eq('user_id', session.user.id)
            .maybeSingle();
          
          const bookmarks = userData?.bookmarked_pages || {};
          setBookmarkedPageIndex(bookmarks[bookId] ?? null);
        } else {
          const storedBookmarks = localStorage.getItem(LOCALSTORAGE_BOOKMARKS_KEY);
          const bookmarks = storedBookmarks ? JSON.parse(storedBookmarks) : {};
          setBookmarkedPageIndex(bookmarks[bookId] ?? null);
        }
      } catch (error) {
        console.error('Error fetching bookmarked page:', error);
      }
    };

    fetchBookmarkedPage();
  }, [bookId]);

  useEffect(() => {
    setIsReordering(isReorderMode);
  }, [isReorderMode]);

  // Force list view when in delete mode or reorder mode
  useEffect(() => {
    if (isDeleteMode || isReorderMode) {
      setPreviousViewMode(viewMode);
      setViewMode('list');
    } else {
      setViewMode(previousViewMode);
    }
  }, [isDeleteMode, isReorderMode]);

  useEffect(() => {
    const sortedPages = [...pages].sort((a, b) => a.page_index - b.page_index);
    setItems(sortedPages);
  }, [pages]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDeletePage = async (pageId: number) => {
    if (!canEdit) {
      toast({
        variant: "destructive",
        title: "Permission denied",
        description: "You don't have permission to delete pages in this book"
      });
      return;
    }

    try {
      console.log('Attempting to archive page:', {
        pageId,
        bookId,
        userEmail: (await supabase.auth.getUser()).data.user?.email
      });

      // First archive the page
      const { error: archiveError } = await supabase
        .from('pages')
        .update({ 
          archived: true,
          updated_at: new Date().toISOString()
        })
        .eq('id', pageId);

      if (archiveError) {
        console.error('Error archiving page:', archiveError);
        throw archiveError;
      }

      // Get the remaining pages and update their indices
      const remainingPages = items.filter(page => page.id !== pageId);
      const updatedPages = remainingPages.map((page, index) => ({
        id: page.id,
        page_index: index,
        book_id: bookId
      }));

      // Update the indices of remaining pages
      const { error: updateError } = await supabase
        .from('pages')
        .upsert(updatedPages);

      if (updateError) {
        console.error('Error updating page indices:', updateError);
        throw updateError;
      }

      // Update local state
      setItems(remainingPages);
      
      toast({
        title: "Page archived",
        description: "The page has been moved to archive"
      });
    } catch (error: any) {
      console.error('Detailed error:', error);
      toast({
        variant: "destructive",
        title: "Error archiving page",
        description: error.message
      });
    }
  };

  const createNewPage = async (pageType: 'text' | 'section' = 'text') => {
    if (!canEdit) {
      toast({
        variant: "destructive",
        title: "Permission denied",
        description: "You don't have permission to create pages in this book"
      });
      return;
    }

    try {
      const maxPageIndex = Math.max(...items.map(p => p.page_index), -1);
      
      const { data: newPage, error } = await supabase
        .from('pages')
        .insert({
          book_id: bookId,
          page_index: maxPageIndex + 1,
          content: {},
          html_content: '',
          page_type: pageType
        })
        .select()
        .single();

      if (error) throw error;

      navigate(`/book/${bookId}/page/${newPage.id}`);

      toast({
        title: `${pageType.charAt(0).toUpperCase() + pageType.slice(1)} page created`,
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

  const handleDragEnd = async (event: DragEndEvent) => {
    if (!canEdit) {
      toast({
        variant: "destructive",
        title: "Permission denied",
        description: "You don't have permission to reorder pages in this book"
      });
      return;
    }

    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = items.findIndex((item) => item.id === active.id);
      const newIndex = items.findIndex((item) => item.id === over.id);

      const newItems = arrayMove(items, oldIndex, newIndex);
      setItems(newItems);

      try {
        // First, update all pages to have temporary indices that won't conflict
        const tempUpdates = items.map((page, index) => ({
          id: page.id,
          page_index: -(index + 1000), // Use negative numbers to avoid conflicts
          book_id: bookId
        }));

        let { error: tempError } = await supabase
          .from('pages')
          .upsert(tempUpdates);

        if (tempError) throw tempError;

        // Then, update to the final indices
        const finalUpdates = newItems.map((page, index) => ({
          id: page.id,
          page_index: index,
          book_id: bookId
        }));

        const { error } = await supabase
          .from('pages')
          .upsert(finalUpdates);

        if (error) throw error;

        toast({
          title: "Pages reordered",
          description: "The page order has been updated"
        });
      } catch (error: unknown) {
        const err = error as { message: string };
        toast({
          variant: "destructive",
          title: "Error updating page order",
          description: err.message || "Failed to update page order"
        });
        
        // Revert the items state on error
        setItems(items);
      }
    }
  };

  return (
    <Card className="mt-6">
      <CardContent className="p-0">
        <div className="flex flex-row sm:flex-row items-start sm:items-center justify-between p-4 border-b border-border gap-4">
          <div className="flex items-center gap-2">
            <Button
              variant={viewMode === 'list' ? "default" : "outline"}
              size="icon"
              onClick={() => setViewMode(viewMode === 'list' ? 'grid' : 'list')}
              className="rounded-full"
              disabled={isReordering}
            >
              {viewMode === 'list' ? (
                <LayoutGrid className="h-4 w-4" />
              ) : (
                <LayoutList className="h-4 w-4" />
              )}
            </Button>
            
            {canEdit && (
              <>
                <div className="sm:hidden">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="icon" className="rounded-full">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-40">
                      <DropdownMenuItem
                        onClick={() => {
                          setIsReordering(false);
                          onDeleteModeChange?.(!isDeleteMode);
                        }}
                        className="flex items-center gap-2"
                      >
                        <Trash2 className="h-4 w-4" />
                        <span>{isDeleteMode ? 'Exit Delete Mode' : 'Delete Pages'}</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          onDeleteModeChange?.(false);
                          if (!isReordering) {
                            setPreviousViewMode(viewMode);
                            setViewMode('list');
                          } else {
                            setViewMode(previousViewMode);
                          }
                          setIsReordering(!isReordering);
                        }}
                        className="flex items-center gap-2"
                      >
                        <Move className="h-4 w-4" />
                        <span>{isReordering ? 'Exit Reorder Mode' : 'Reorder Pages'}</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <div className="hidden sm:flex items-center gap-2">
                  <Button
                    variant={isDeleteMode ? "secondary" : "outline"}
                    size="sm"
                    className="flex items-center gap-2"
                    onClick={() => {
                      setIsReordering(false);
                      onDeleteModeChange?.(!isDeleteMode);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                    <span>{isDeleteMode ? 'Exit Delete' : 'Delete'}</span>
                  </Button>
                  <Button
                    variant={isReordering ? "secondary" : "outline"}
                    size="sm"
                    className="flex items-center gap-2"
                    onClick={() => {
                      onDeleteModeChange?.(false);
                      if (!isReordering) {
                        setPreviousViewMode(viewMode);
                        setViewMode('list');
                      } else {
                        setViewMode(previousViewMode);
                      }
                      setIsReordering(!isReordering);
                    }}
                  >
                    <Move className="h-4 w-4" />
                    <span>{isReordering ? 'Exit Reorder' : 'Reorder'}</span>
                  </Button>
                </div>
              </>
            )}
          </div>

          {canEdit && (
            <div className="flex flex-wrap items-center gap-4 ">
              <Button
                variant="outline"
                onClick={() => createNewPage('section')}
                className="flex items-center gap-2 relative flex-1 sm:flex-initial justify-center"
                title="Add Section Header"
                aria-label="Add Section Header"
              >
                <Section className="h-4 w-4" />
                <span className="hidden md:block">Add Section</span>
                <div className="absolute -top-2 -right-2 bg-green-500 rounded-full p-0.5 shadow-sm">
                  <Plus className="h-3 w-3 text-white" />
                </div>
              </Button>
              <Button
                onClick={() => createNewPage('text')}
                className="flex items-center gap-2 relative flex-1 sm:flex-initial justify-center"
                title="Add Text Page"
                aria-label="Add Text Page"
              >
                <Type className="h-4 w-4" />
                <span>Add Page</span>
                <div className="absolute -top-2 -right-2 bg-green-500 rounded-full p-0.5 shadow-sm">
                  <Plus className="h-3 w-3 text-white" />
                </div>
              </Button>
            </div>
          )}
        </div>

        {items.length === 0 ? (
          <div className="text-center py-12">
            <Type className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No pages yet</p>
            {canEdit && <p className="text-muted-foreground text-sm">Click the buttons above to add a new page</p>}
          </div>
        ) : (
          <div className={`${viewMode === 'grid' ? 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 p-4' : ''}`}>
            {isReordering ? (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={items}
                  strategy={verticalListSortingStrategy}
                >
                  {items.map((page) => (
                    <SortablePageItem
                      key={page.id}
                      page={page}
                      bookId={bookId}
                      onNavigate={(pageId) => navigate(`/book/${bookId}/page/${pageId}`)}
                      isBookmarked={bookmarkedPageIndex === page.page_index}
                    />
                  ))}
                </SortableContext>
              </DndContext>
            ) : (
              items.map((page) => (
                viewMode === 'list' ? (
                  <RegularPageItem
                    key={page.id}
                    page={page}
                    bookId={bookId}
                    onNavigate={(pageId) => navigate(`/book/${bookId}/page/${pageId}`)}
                    onDelete={isDeleteMode && canEdit ? handleDeletePage : undefined}
                    isBookmarked={bookmarkedPageIndex === page.page_index}
                  />
                ) : (
                  <PageCard
                    key={page.id}
                    page={page}
                    bookId={bookId}
                    onNavigate={(pageId) => navigate(`/book/${bookId}/page/${pageId}`)}
                    onDelete={isDeleteMode && canEdit ? handleDeletePage : undefined}
                    isBookmarked={bookmarkedPageIndex === page.page_index}
                  />
                )
              ))
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
