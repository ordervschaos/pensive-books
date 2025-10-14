import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Move,
  LayoutList,
  LayoutGrid,
  Trash2,
  Type,
  Section,
  Plus,
  MoreVertical,
  MessageSquare,
  X
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect, useRef } from "react";
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
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";

import { SortablePageItem } from "./SortablePageItem";
import { RegularPageItem } from "./RegularPageItem";
import { PageCard } from "./PageCard";
import { PagesListProps, Page } from "./types";
import { 
  fetchBookmarkedPage, 
  handleDeletePage as deletePageUtil, 
  createNewPage as createPageUtil,
  reorderPages
} from "./pageUtils";

export const PagesList = ({
  pages,
  bookId,
  isReorderMode = false,
  isDeleteMode = false,
  canEdit = false,
  onDeleteModeChange,
  onChatToggle,
  hasActiveChat
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
  const bookmarkedPageRef = useRef<HTMLDivElement>(null);
  const isBetaEnabled = localStorage.getItem('is_beta') === 'true';

  useEffect(() => {
    const loadBookmarkedPage = async () => {
      const bookmarkedIndex = await fetchBookmarkedPage(bookId);
      setBookmarkedPageIndex(bookmarkedIndex);
    };

    loadBookmarkedPage();
  }, [bookId]);

  // Scroll to bookmarked page when it's loaded
  useEffect(() => {
    if (bookmarkedPageIndex !== null && bookmarkedPageRef.current) {
      bookmarkedPageRef.current.scrollIntoView({ 
        behavior: 'smooth',
        block: 'center'
      });
    }
  }, []);

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

    await deletePageUtil(
      pageId, 
      bookId, 
      items,
      (updatedPages) => {
        setItems(updatedPages);
        toast({
          title: "Page archived",
          description: "The page has been moved to archive"
        });
      },
      (error) => {
        toast({
          variant: "destructive",
          title: "Error archiving page",
          description: error.message
        });
      }
    );
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

    await createPageUtil(
      bookId,
      items,
      pageType,
      (newPageId) => {
        navigate(`/book/${bookId}/page/${newPageId}?edit=true`);
        toast({
          title: `${pageType.charAt(0).toUpperCase() + pageType.slice(1)} page created`,
          description: "Your new page has been created"
        });
      },
      (error) => {
        toast({
          variant: "destructive",
          title: "Error creating page",
          description: error.message
        });
      }
    );
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

      await reorderPages(
        bookId,
        items,
        newItems,
        () => {
          toast({
            title: "Pages reordered",
            description: "The page order has been updated"
          });
        },
        (error) => {
          toast({
            variant: "destructive",
            title: "Error updating page order",
            description: error.message || "Failed to update page order"
          });
          
          // Revert the items state on error
          setItems(items);
        }
      );
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

            {/* Chat button - available for everyone in beta */}
            {onChatToggle && isBetaEnabled && (
              <>
                <Button
                  variant="outline"
                  size="icon"
                  className={`rounded-full hidden sm:flex ${hasActiveChat ? 'bg-muted' : ''}`}
                  onClick={onChatToggle}
                >
                  <MessageSquare className="h-4 w-4" />
                </Button>
              </>
            )}

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
                      {onChatToggle && isBetaEnabled && (
                        <DropdownMenuItem
                          onClick={onChatToggle}
                          className="flex items-center gap-2"
                        >
                          <MessageSquare className="h-4 w-4" />
                          <span>Chat</span>
                        </DropdownMenuItem>
                      )}
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
                      ref={bookmarkedPageIndex === page.page_index ? bookmarkedPageRef : undefined}
                    />
                  ))}
                </SortableContext>
              </DndContext>
            ) : (
              <>
                {items.map((page) => (
                  viewMode === 'list' ? (
                    <RegularPageItem
                      key={page.id}
                      page={page}
                      bookId={bookId}
                      onNavigate={(pageId) => navigate(`/book/${bookId}/page/${pageId}`)}
                      onDelete={isDeleteMode && canEdit ? handleDeletePage : undefined}
                      isBookmarked={bookmarkedPageIndex === page.page_index}
                      ref={bookmarkedPageIndex === page.page_index ? bookmarkedPageRef : undefined}
                    />
                  ) : (
                    <PageCard
                      key={page.id}
                      page={page}
                      bookId={bookId}
                      onNavigate={(pageId) => navigate(`/book/${bookId}/page/${pageId}`)}
                      onDelete={isDeleteMode && canEdit ? handleDeletePage : undefined}
                      isBookmarked={bookmarkedPageIndex === page.page_index}
                      ref={bookmarkedPageIndex === page.page_index ? bookmarkedPageRef : undefined}
                    />
                  )
                ))}
                
                {/* Add New Page card/list item */}
                {canEdit && !isDeleteMode && !isReordering && (
                  viewMode === 'list' ? (
                    <div className="flex items-center p-3 border-b border-border group hover:bg-accent/50 transition-colors cursor-pointer" onClick={() => createNewPage('text')}>
                      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 mr-3">
                        <Plus className="h-4 w-4 text-primary" />
                      </div>
                      <div className="flex-1">
                        <p className="font-medium text-primary">Add New Page</p>
                      </div>
                    </div>
                  ) : (
                    <div 
                      className="flex flex-col items-center justify-center border border-dashed border-primary/40 rounded-md p-6 h-full min-h-[180px] hover:bg-accent/50 transition-colors cursor-pointer"
                      onClick={() => createNewPage('text')}
                    >
                      <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
                        <Plus className="h-6 w-6 text-primary" />
                      </div>
                      <p className="font-medium text-primary text-center">Add New Page</p>
                    </div>
                  )
                )}
              </>
            )}
          </div>
        )}
      </CardContent>

      {/* Floating Exit Reorder Button */}
      {isReordering && (
        <div className="fixed bottom-6 right-6 z-50">
          <Button
            size="lg"
            onClick={() => {
              setViewMode(previousViewMode);
              setIsReordering(false);
            }}
            className="rounded-full shadow-lg hover:shadow-xl transition-all flex items-center gap-2 px-6 py-6 text-base font-semibold"
          >
            <X className="h-5 w-5" />
            <span>Exit Reorder</span>
          </Button>
        </div>
      )}
    </Card>
  );
}; 