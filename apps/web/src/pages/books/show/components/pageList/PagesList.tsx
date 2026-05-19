import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Move,
  LayoutList,
  LayoutGrid,
  Trash2,
  Plus,
  MoreVertical,
  MessageSquare,
  X,
  List,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
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

  const viewOptions: { value: 'grid' | 'list' | 'outline'; label: string; Icon: typeof LayoutGrid }[] = [
    { value: 'grid', label: 'Grid', Icon: LayoutGrid },
    { value: 'list', label: 'List', Icon: LayoutList },
    { value: 'outline', label: 'Outline', Icon: List },
  ];

  return (
    <div className="mt-6 overflow-hidden rounded-2xl border border-border bg-[hsl(var(--pv-surface-2))]/40">
        <div className="border-b border-[hsl(var(--pv-border-soft))] px-5 py-4">
          <div className="flex flex-row items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <nav className="flex flex-wrap items-center gap-1.5" aria-label="View mode">
                {viewOptions.map(({ value, label, Icon }) => {
                  const isActive = viewMode === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setViewMode(value)}
                      disabled={isReordering}
                      aria-pressed={isActive}
                      aria-label={`${label} view`}
                      className={cn(
                        "pv-serif inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                        isActive
                          ? "border-foreground bg-foreground text-background"
                          : "border-border bg-transparent text-[hsl(var(--pv-text-muted))] hover:border-foreground/40 hover:text-foreground"
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">{label}</span>
                    </button>
                  );
                })}
              </nav>

              {/* Chat button - available for everyone in beta */}
              {onChatToggle && isBetaEnabled && (
                <button
                  type="button"
                  onClick={onChatToggle}
                  className={cn(
                    "pv-serif hidden h-9 items-center gap-1.5 rounded-full border px-3.5 text-[13px] transition-colors sm:inline-flex",
                    hasActiveChat
                      ? "border-foreground bg-foreground text-background"
                      : "border-border bg-transparent text-[hsl(var(--pv-text-muted))] hover:border-foreground/40 hover:text-foreground"
                  )}
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  <span>Chat</span>
                </button>
              )}
            </div>

            {canEdit && (
              <>
                <div className="sm:hidden">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="pv-serif h-9 gap-1.5 rounded-full border-border bg-transparent px-3.5 text-[13px] text-[hsl(var(--pv-text-muted))] hover:text-foreground"
                      >
                        <MoreVertical className="h-3.5 w-3.5" />
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
                  <button
                    type="button"
                    onClick={toggleDeleteMode}
                    className={cn(
                      "pv-serif inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-[13px] transition-colors",
                      isDeleteMode
                        ? "border-foreground bg-foreground text-background"
                        : "border-border bg-transparent text-[hsl(var(--pv-text-muted))] hover:border-foreground/40 hover:text-foreground"
                    )}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>{isDeleteMode ? 'Exit Delete' : 'Delete'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={toggleReorderMode}
                    className={cn(
                      "pv-serif inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-[13px] transition-colors",
                      isReordering
                        ? "border-foreground bg-foreground text-background"
                        : "border-border bg-transparent text-[hsl(var(--pv-text-muted))] hover:border-foreground/40 hover:text-foreground"
                    )}
                  >
                    <Move className="h-3.5 w-3.5" />
                    <span>{isReordering ? 'Exit Reorder' : 'Reorder'}</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {activeModeLabel && (
          <div className="flex items-center justify-between border-b border-[hsl(var(--pv-border-soft))] bg-[hsl(var(--pv-surface-2))] px-5 py-2.5">
            <span className="pv-mono text-[10.5px] uppercase tracking-[0.18em] text-[hsl(var(--pv-text-muted))]">
              {activeModeLabel} mode is active
            </span>
            <button
              type="button"
              onClick={exitActiveMode}
              className="pv-serif inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-[13px] italic text-[hsl(var(--pv-text-muted))] hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
              Exit
            </button>
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
                    <AddPageRow viewMode={viewMode} onClick={() => createNewPage('text')} />
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
                    <AddPageRow viewMode={viewMode} onClick={() => createNewPage('text')} />
                  )}
                </>
              )}
            </div>
          )}


      {/* Floating Exit Mode Button */}
      {activeModeLabel && (
        <div className="fixed bottom-6 right-6 z-50">
          <Button
            size="lg"
            onClick={exitActiveMode}
            className="pv-serif flex items-center gap-2 rounded-full bg-foreground px-6 py-6 text-base font-normal italic text-background shadow-lg transition-all hover:opacity-90 hover:shadow-xl"
          >
            <X className="h-5 w-5" />
            <span>Exit {activeModeLabel}</span>
          </Button>
        </div>
      )}
    </div>
  );
};

function AddPageRow({
  viewMode,
  onClick,
}: {
  viewMode: 'list' | 'grid' | 'outline';
  onClick: () => void;
}) {
  if (viewMode === 'list') {
    return (
      <button
        type="button"
        onClick={onClick}
        className="pv-serif flex w-full items-center gap-3 border-b border-dashed border-border px-5 py-3 text-left italic text-[hsl(var(--pv-text-muted))] transition-colors hover:bg-[hsl(var(--pv-surface-2))]/50 hover:text-foreground"
      >
        <Plus className="h-4 w-4" />
        <span className="text-[14px]">Add a new page</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="pv-serif flex h-full min-h-[180px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-transparent p-6 italic text-[hsl(var(--pv-text-muted))] transition-colors hover:bg-[hsl(var(--pv-surface-2))]/50 hover:text-foreground"
    >
      <Plus className="h-6 w-6" />
      <span className="text-[14px]">Add a new page</span>
    </button>
  );
}
