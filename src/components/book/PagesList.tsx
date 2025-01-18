import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BookOpen, FilePlus, GripVertical, ArrowUpDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Toggle } from "@/components/ui/toggle";
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
}

interface PagesListProps {
  pages: Page[];
  bookId: number;
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

  return (
    <div 
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 py-2 px-3 bg-background border border-border rounded-md hover:border-primary/50 transition-colors"
    >
      <div {...attributes} {...listeners} className="cursor-grab hover:text-primary">
        <GripVertical className="h-5 w-5" />
      </div>
      <div 
        className="flex-1 cursor-pointer"
        onClick={() => onNavigate(page.id)}
      >
        <h3 className="font-medium">
          {page.title || `Untitled Page ${page.page_index + 1}`}
        </h3>
        <p className="text-sm text-muted-foreground">
          Last modified {new Date(page.updated_at).toLocaleDateString()}
        </p>
      </div>
    </div>
  );
};

export const PagesList = ({ pages, bookId }: PagesListProps) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [isReorderMode, setIsReorderMode] = useState(false);
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
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <Button 
          onClick={createNewPage}
          className="flex items-center gap-2"
        >
          <FilePlus className="h-4 w-4" />
          Add Page
        </Button>
        <Button
          variant="outline"
          size="sm"
          className={`gap-2 ${isReorderMode ? 'bg-primary/10' : ''}`}
          onClick={() => setIsReorderMode(!isReorderMode)}
        >
          <ArrowUpDown className="h-4 w-4" />
          {isReorderMode ? 'Exit Reorder' : 'Reorder Pages'}
        </Button>
      </div>

      {items.length === 0 ? (
        <Card>
          <CardContent className="text-center py-6">
            <BookOpen className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No pages yet</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
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
              <div 
                key={page.id}
                onClick={() => navigate(`/book/${bookId}/page/${page.id}`)}
                className="flex items-center justify-between py-2 px-3 border-b border-border hover:bg-accent/50 rounded cursor-pointer transition-colors"
              >
                <div>
                  <h3 className="font-medium">
                    {page.title || `Untitled Page ${page.page_index + 1}`}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    Last modified {new Date(page.updated_at).toLocaleDateString()}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};