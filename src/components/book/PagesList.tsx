import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BookOpen, FilePlus, GripVertical } from "lucide-react";
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

interface Page {
  id: number;
  page_index: number;
  updated_at: string;
  title: string;
  html_content?: string;
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
}

const SortablePageItem = ({ page, bookId, onNavigate }: SortablePageItemProps) => {
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

  // Calculate word count from html_content
  const wordCount = page.html_content ? 
    page.html_content.replace(/<[^>]*>/g, '').trim().split(/\s+/).length : 
    0;

  return (
    <div 
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 py-3 px-4 bg-background border-b border-border last:border-b-0 hover:bg-accent/5 transition-colors group"
    >
      <div {...attributes} {...listeners} className="cursor-grab hover:text-primary">
        <GripVertical className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
      <div 
        className="flex-1 cursor-pointer"
        onClick={() => onNavigate(page.id)}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-medium">
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

const RegularPageItem = ({ page, bookId, onNavigate }: SortablePageItemProps) => {
  const wordCount = page.html_content ? 
    page.html_content.replace(/<[^>]*>/g, '').trim().split(/\s+/).length : 
    0;

  return (
    <div 
      onClick={() => onNavigate(page.id)}
      className="flex items-center justify-between py-3 px-4 border-b border-border last:border-b-0 hover:bg-accent/5 cursor-pointer transition-colors"
    >
      <h3 className="font-medium">
        {page.title || `Untitled Page ${page.page_index + 1}`}
      </h3>
      <span className="text-sm text-muted-foreground">
        {wordCount} words
      </span>
    </div>
  );
};

export const PagesList = ({ pages, bookId, isReorderMode = false }: PagesListProps) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [items, setItems] = useState<Page[]>([]);

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

  const createNewPage = async () => {
    try {
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
        <div className="p-4 border-b border-border">
          <Button 
            onClick={createNewPage}
            className="w-full flex items-center justify-center gap-2"
          >
            <FilePlus className="h-4 w-4" />
            Add Page
          </Button>
        </div>

        {items.length === 0 ? (
          <div className="text-center py-12">
            <BookOpen className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No pages yet</p>
          </div>
        ) : (
          <div>
            {isReorderMode ? (
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
                <RegularPageItem
                  key={page.id}
                  page={page}
                  bookId={bookId}
                  onNavigate={(pageId) => navigate(`/book/${bookId}/page/${pageId}`)}
                />
              ))
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};