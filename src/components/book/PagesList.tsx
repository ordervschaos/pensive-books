import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FilePlus, GripVertical, Move, LayoutList, LayoutGrid, Trash2, Image, Type, Section } from "lucide-react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
}

interface SortablePageItemProps {
  page: Page;
  bookId: number;
  onNavigate: (pageId: number) => void;
  onDelete?: (pageId: number) => void;
}

const SortablePageItem = ({ page, bookId, onNavigate, onDelete }: SortablePageItemProps) => {
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

  const wordCount = page.html_content ? 
    page.html_content.replace(/<[^>]*>/g, '').trim().split(/\s+/).length : 
    0;

  return (
    <div 
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 py-4 px-6 hover:bg-accent/5 transition-colors group border-b border-border last:border-0"
    >
      <div {...attributes} {...listeners} className="cursor-grab hover:text-primary">
        <GripVertical className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
      <div 
        className="flex-1 cursor-pointer"
        onClick={() => onNavigate(page.id)}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-lg">
            {page.title || `Untitled Page ${page.page_index + 1}`}
          </h3>
          <span className="text-sm text-muted-foreground">
            {wordCount} words
          </span>
        </div>
      </div>
    </div>
  );
};

const RegularPageItem = ({ page, bookId, onNavigate, onDelete }: SortablePageItemProps) => {
  const wordCount = page.html_content ? 
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
        <div className="flex items-center justify-between">
          <h3 className="text-lg">
            {page.title || `Untitled Page ${page.page_index + 1}`}
          </h3>
          <span className="text-sm text-muted-foreground">
            {wordCount} words
          </span>
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

const PageCard = ({ page, bookId, onNavigate, onDelete }: SortablePageItemProps) => {
  const wordCount = page.html_content ? 
    page.html_content.replace(/<[^>]*>/g, '').trim().split(/\s+/).length : 
    0;

  const excerpt = page.html_content ? 
    page.html_content.replace(/<[^>]*>/g, '').trim().slice(0, 100) + '...' : 
    'No content';

  return (
    <Card 
      className="cursor-pointer hover:bg-accent/5 transition-colors relative group"
    >
      <CardContent className="p-6 space-y-4" onClick={() => onNavigate(page.id)}>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium">
            {page.title || `Untitled Page ${page.page_index + 1}`}
          </h3>
          <span className="text-sm text-muted-foreground">
            {wordCount} words
          </span>
        </div>
        <p className="text-sm text-muted-foreground line-clamp-3">
          {excerpt}
        </p>
      </CardContent>
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

export const PagesList = ({ pages, bookId, isReorderMode = false }: PagesListProps) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [items, setItems] = useState<Page[]>(
    [...pages].sort((a, b) => a.page_index - b.page_index)
  );
  const [isReordering, setIsReordering] = useState(isReorderMode);
  const [isDeleteMode, setIsDeleteMode] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');

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
    try {
      const { error } = await supabase
        .from('pages')
        .update({ archived: true })
        .eq('id', pageId);

      if (error) throw error;

      setItems(items.filter(page => page.id !== pageId));
      
      toast({
        title: "Page deleted",
        description: "The page has been moved to archive"
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error deleting page",
        description: error.message
      });
    }
  };

  const createNewPage = async (pageType: 'text' | 'section' = 'text') => {
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
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = items.findIndex((item) => item.id === active.id);
      const newIndex = items.findIndex((item) => item.id === over.id);

      const newItems = arrayMove(items, oldIndex, newIndex);
      setItems(newItems);

      try {
        const updates = newItems.map((page, index) => ({
          id: page.id,
          page_index: index
        }));

        const { error } = await supabase
          .from('pages')
          .upsert(updates);

        if (error) throw error;

        toast({
          title: "Pages reordered",
          description: "The page order has been updated"
        });
      } catch (error: any) {
        toast({
          variant: "destructive",
          title: "Error updating page order",
          description: error.message
        });
      }
    }
  };

  return (
    <Card className="mt-6">
      <CardContent className="p-0">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Button
              variant={viewMode === 'list' ? "default" : "outline"}
              size="icon"
              onClick={() => setViewMode(viewMode === 'list' ? 'grid' : 'list')}
              className="rounded-full"
            >
              {viewMode === 'list' ? (
                <LayoutGrid className="h-4 w-4" />
              ) : (
                <LayoutList className="h-4 w-4" />
              )}
            </Button>
            
            <Button
              onClick={() => {
                setIsReordering(false);
                setIsDeleteMode(!isDeleteMode);
              }}
              variant={isDeleteMode ? "destructive" : "outline"}
              size="icon"
              className="rounded-full"
            >
              <Trash2 className="h-4 w-4" />
            </Button>

            <Button
              onClick={() => {
                setIsDeleteMode(false);
                setIsReordering(!isReordering);
              }}
              variant={isReordering ? "default" : "outline"}
              size="icon"
              className="rounded-full"
            >
              <Move className="h-4 w-4" />
            </Button>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="rounded-full">
                <FilePlus className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => createNewPage('text')}>
                <Type className="h-4 w-4 mr-2" />
                Text Page
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => createNewPage('section')}>
                <Section className="h-4 w-4 mr-2" />
                Section Page
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {items.length === 0 ? (
          <div className="text-center py-12">
            <FilePlus className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No pages yet</p>
          </div>
        ) : (
          <div className={`${viewMode === 'grid' ? 'grid grid-cols-1 md:grid-cols-2 gap-4 p-4' : ''}`}>
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
                    onDelete={isDeleteMode ? handleDeletePage : undefined}
                  />
                ) : (
                  <PageCard
                    key={page.id}
                    page={page}
                    bookId={bookId}
                    onNavigate={(pageId) => navigate(`/book/${bookId}/page/${pageId}`)}
                    onDelete={isDeleteMode ? handleDeletePage : undefined}
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
