import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Move,
  LayoutList,
  LayoutGrid,
  Trash2,
  Plus,
  MoreVertical,
  MessageSquare,
  X,
  List
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
import { BookOutlineView } from "./BookOutlineView";
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
  const [viewMode, setViewMode] = useState<'list' | 'grid' | 'outline'>(() => {
    const savedViewMode = localStorage.getItem('book-view-mode') as 'list' | 'grid' | 'outline' | null;
    return savedViewMode || 'grid';
  });
  const [previousViewMode, setPreviousViewMode] = useState<'list' | 'grid' | 'outline'>(() => {
    const savedViewMode = localStorage.getItem('book-view-mode') as 'list' | 'grid' | 'outline' | null;
    return savedViewMode || 'grid';
  });
  const [bookmarkedPageIndex, setBookmarkedPageIndex] = useState<number | null>(null);
  const bookmarkedPageRef = useRef<HTMLDivElement>(null);
  const isBetaEnabled = localStorage.getItem('is_beta') === 'true';
  const activeModeLabel = isReordering ? "Reorder" : isDeleteMode ? "Delete" : null;

  // Save view mode to localStorage
  useEffect(() => {
    if (!isDeleteMode && !isReordering) {
      localStorage.setItem('book-view-mode', viewMode);
    }
  }, [viewMode, isDeleteMode, isReordering]);

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
  }, [bookmarkedPageIndex]);

  useEffect(() => {
    setIsReordering(isReorderMode);
  }, [isReorderMode]);

  const previousDeleteModeRef = useRef(isDeleteMode);

  // Force list view for delete mode. Reorder mode manages its own view changes.
  useEffect(() => {
    if (!previousDeleteModeRef.current && isDeleteMode) {
      setPreviousViewMode(viewMode);
      setViewMode('list');
    } else if (previousDeleteModeRef.current && !isDeleteMode) {
      setViewMode(previousViewMode);
    }
    previousDeleteModeRef.current = isDeleteMode;
  }, [isDeleteMode, previousViewMode, viewMode]);

  useEffect(() => {
    const sortedPages = [...pages].sort((a, b) => a.page_index - b.page_index);
    setItems(sortedPages);
  }, [pages]);

  const sectionNumbers = new Map<number, number>();
  let sectionCount = 0;
  items.forEach((item) => {
    if (item.page_type === "section") {
      sectionCount += 1;
      sectionNumbers.set(item.id, sectionCount);
    }
  });

  const toggleDeleteMode = () => {
    setIsReordering(false);
    onDeleteModeChange?.(!isDeleteMode);
  };

  const toggleReorderMode = () => {
    onDeleteModeChange?.(false);
    if (!isReordering) {
      setPreviousViewMode(viewMode);
      setViewMode('list');
    } else {
      setViewMode(previousViewMode);
    }
    setIsReordering(!isReordering);
  };

  const exitActiveMode = () => {
    if (isReordering) {
      setViewMode(previousViewMode);
      setIsReordering(false);
      return;
    }

    if (isDeleteMode) {
      onDeleteModeChange?.(false);
    }
  };

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
        navigate(`/books/${bookId}/pages/${newPageId}?edit=true`);
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
    <Card className="mt-6 overflow-hidden">
      <CardContent className="p-0">
        <div className="border-b border-border p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <ToggleGroup
                type="single"
                value={viewMode}
                onValueChange={(value) => {
                  if (value) {
                    setViewMode(value as 'list' | 'grid' | 'outline');
                  }
                }}
                variant="outline"
                size="sm"
                className="rounded-md border border-border p-1"
              >
                <ToggleGroupItem value="grid" disabled={isReordering} className="gap-1.5 rounded-md px-3" aria-label="Grid view">
                  <LayoutGrid className="h-4 w-4" />
                  <span className="hidden sm:inline">Grid</span>
                </ToggleGroupItem>
                <ToggleGroupItem value="list" disabled={isReordering} className="gap-1.5 rounded-md px-3" aria-label="List view">
                  <LayoutList className="h-4 w-4" />
                  <span className="hidden sm:inline">List</span>
                </ToggleGroupItem>
                <ToggleGroupItem value="outline" disabled={isReordering} className="gap-1.5 rounded-md px-3" aria-label="Outline view">
                  <List className="h-4 w-4" />
                  <span className="hidden sm:inline">Outline</span>
                </ToggleGroupItem>
              </ToggleGroup>

              {/* Chat button - available for everyone in beta */}
              {onChatToggle && isBetaEnabled && (
                <Button
                  variant={hasActiveChat ? "secondary" : "outline"}
                  size="sm"
                  className="hidden h-9 gap-2 sm:inline-flex"
                  onClick={onChatToggle}
                >
                  <MessageSquare className="h-4 w-4" />
                  <span>Chat</span>
                </Button>
              )}
            </div>

            {canEdit && (
              <>
                <div className="sm:hidden">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="h-9 gap-2 px-3">
                        <MoreVertical className="h-4 w-4" />
                        <span>Manage</span>
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
                        onClick={toggleDeleteMode}
                        className="flex items-center gap-2"
                      >
                        <Trash2 className="h-4 w-4" />
                        <span>{isDeleteMode ? 'Exit Delete Mode' : 'Delete Pages'}</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={toggleReorderMode}
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
                    className="h-9 gap-2"
                    onClick={toggleDeleteMode}
                  >
                    <Trash2 className="h-4 w-4" />
                    <span>{isDeleteMode ? 'Exit Delete' : 'Delete'}</span>
                  </Button>
                  <Button
                    variant={isReordering ? "secondary" : "outline"}
                    size="sm"
                    className="h-9 gap-2"
                    onClick={toggleReorderMode}
                  >
                    <Move className="h-4 w-4" />
                    <span>{isReordering ? 'Exit Reorder' : 'Reorder'}</span>
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>

        {activeModeLabel && (
          <div className="flex items-center justify-between border-b border-border/60 bg-accent/40 px-4 py-2 text-sm">
            <span className="font-medium text-accent-foreground">{activeModeLabel} mode is active</span>
            <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2" onClick={exitActiveMode}>
              <X className="h-4 w-4" />
              Exit
            </Button>
          </div>
        )}

          {viewMode === 'outline' ? (
            <BookOutlineView
              pages={items}
              bookId={bookId}
              onNavigate={(pageId) => navigate(`/books/${bookId}/pages/${pageId}`)}
            />
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
                        onNavigate={(pageId) => navigate(`/books/${bookId}/pages/${pageId}`)}
                        isBookmarked={bookmarkedPageIndex === page.page_index}
                        sectionNumber={sectionNumbers.get(page.id)}
                        ref={bookmarkedPageIndex === page.page_index ? bookmarkedPageRef : undefined}
                      />
                    ))}
                  </SortableContext>
                </DndContext>
              ) : (
                <>
                  {/* Add New Page card/list item at the beginning (only if >3 pages) */}
                  {canEdit && !isDeleteMode && !isReordering && items.length > 3 && (
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

                  {items.map((page) => (
                    viewMode === 'list' ? (
                      <RegularPageItem
                        key={page.id}
                        page={page}
                        bookId={bookId}
                        onNavigate={(pageId) => navigate(`/books/${bookId}/pages/${pageId}`)}
                        onDelete={canEdit ? handleDeletePage : undefined}
                        isBookmarked={bookmarkedPageIndex === page.page_index}
                        sectionNumber={sectionNumbers.get(page.id)}
                        ref={bookmarkedPageIndex === page.page_index ? bookmarkedPageRef : undefined}
                      />
                    ) : (
                      <PageCard
                        key={page.id}
                        page={page}
                        bookId={bookId}
                        onNavigate={(pageId) => navigate(`/books/${bookId}/pages/${pageId}`)}
                        onDelete={canEdit ? handleDeletePage : undefined}
                        isBookmarked={bookmarkedPageIndex === page.page_index}
                        sectionNumber={sectionNumbers.get(page.id)}
                        ref={bookmarkedPageIndex === page.page_index ? bookmarkedPageRef : undefined}
                      />
                    )
                  ))}

                  {/* Add New Page card/list item at the end (always shown) */}
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

      {/* Floating Exit Mode Button */}
      {activeModeLabel && (
        <div className="fixed bottom-6 right-6 z-50">
          <Button
            size="lg"
            variant="secondary"
            onClick={exitActiveMode}
            className="flex items-center gap-2 rounded-full px-6 py-6 text-base font-semibold shadow-lg transition-all hover:shadow-xl"
          >
            <X className="h-5 w-5" />
            <span>Exit {activeModeLabel}</span>
          </Button>
        </div>
      )}
    </Card>
  );
}; 
