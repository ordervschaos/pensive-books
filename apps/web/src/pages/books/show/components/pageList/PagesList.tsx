import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Move,
  AlignLeft,
  LayoutList,
  LayoutGrid,
  Trash2,
  Plus,
  MoreHorizontal,
  MessageSquare,
  X,
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
import { PagesListProps, Page } from "./types";
import {
  fetchBookmarkedPage,
  handleDeletePage as deletePageUtil,
  createNewPage as createPageUtil,
  reorderPages,
  getPageWords
} from "./pageUtils";

type ViewMode = "outline" | "list" | "grid";

const VIEW_OPTIONS: { value: ViewMode; label: string; Icon: typeof LayoutGrid }[] = [
  { value: "outline", label: "Outline", Icon: AlignLeft },
  { value: "list", label: "List", Icon: LayoutList },
  { value: "grid", label: "Grid", Icon: LayoutGrid },
];

const readStoredView = (): ViewMode => {
  const v = localStorage.getItem("book-view-mode");
  return v === "grid" || v === "list" || v === "outline" ? v : "outline";
};

export const PagesList = ({
  pages,
  bookId,
  isReorderMode = false,
  isDeleteMode = false,
  canEdit = false,
  onDeleteModeChange,
  onChatToggle,
  hasActiveChat,
  wordCount,
  versionControl,
}: PagesListProps) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [items, setItems] = useState<Page[]>(
    [...pages].sort((a, b) => a.page_index - b.page_index)
  );
  const [isReordering, setIsReordering] = useState(isReorderMode);
  const [viewMode, setViewMode] = useState<ViewMode>(readStoredView);
  const [previousViewMode, setPreviousViewMode] = useState<ViewMode>(readStoredView);
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

  // Per-chapter aggregate (pages + words) for the section heading rows: each section
  // owns the text pages that follow it until the next section. Also number the text
  // pages contiguously (1..N) so chapter rows don't consume a page number.
  const sectionMeta = new Map<number, { pages: number; words: number }>();
  const displayNumbers = new Map<number, number>();
  let currentSection: number | null = null;
  let textPageNumber = 0;
  items.forEach((item) => {
    if (item.page_type === "section") {
      currentSection = item.id;
      sectionMeta.set(item.id, { pages: 0, words: 0 });
    } else {
      textPageNumber += 1;
      displayNumbers.set(item.id, textPageNumber);
      if (currentSection != null) {
        const meta = sectionMeta.get(currentSection)!;
        meta.pages += 1;
        meta.words += getPageWords(item);
      }
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

  const pageCount = items.length;
  const isGrid = viewMode === "grid";

  return (
    <div className="space-y-5">
      {/* Manuscript header — counts on the left, view switch + version control on the right */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="pv-eyebrow">
          The manuscript ·{" "}
          <span className="pv-serif text-[13px] normal-case not-italic tracking-normal text-[hsl(var(--pv-text-muted))]">
            {pageCount} {pageCount === 1 ? "page" : "pages"}
            {typeof wordCount === "number" && (
              <> · {wordCount.toLocaleString()} {wordCount === 1 ? "word" : "words"}</>
            )}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <nav
            className="inline-flex items-center gap-0.5 rounded-full bg-[hsl(var(--pv-surface-2))] p-[3px]"
            aria-label="View mode"
          >
            {VIEW_OPTIONS.map(({ value, label, Icon }) => {
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
                    "pv-serif inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                    isActive
                      ? "bg-foreground text-background"
                      : "bg-transparent text-[hsl(var(--pv-text-muted))] hover:text-foreground"
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{label}</span>
                </button>
              );
            })}
          </nav>

          {canEdit && versionControl}

          {canEdit && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Manage pages"
                  className="h-9 w-9 rounded-full text-[hsl(var(--pv-text-muted))] hover:bg-[hsl(var(--pv-surface-2))] hover:text-foreground"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem onClick={toggleReorderMode} className="flex items-center gap-2">
                  <Move className="h-4 w-4" />
                  <span>{isReordering ? "Exit reorder" : "Reorder pages"}</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={toggleDeleteMode} className="flex items-center gap-2">
                  <Trash2 className="h-4 w-4" />
                  <span>{isDeleteMode ? "Exit delete" : "Delete pages"}</span>
                </DropdownMenuItem>
                {onChatToggle && isBetaEnabled && (
                  <DropdownMenuItem onClick={onChatToggle} className="flex items-center gap-2">
                    <MessageSquare className="h-4 w-4" />
                    <span>{hasActiveChat ? "Close chat" : "Chat with book"}</span>
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {activeModeLabel && (
        <div className="flex items-center justify-between rounded-[10px] border border-[hsl(var(--pv-border-soft))] bg-[hsl(var(--pv-surface-2))] px-4 py-2.5">
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

      {/* Pages — bare on the page, the design's outline / list / grid */}
      <div className={isGrid ? "grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4" : "flex flex-col"}>
        {isReordering ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={items} strategy={verticalListSortingStrategy}>
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
            {items.map((page) =>
              isGrid ? (
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
              ) : (
                <RegularPageItem
                  key={page.id}
                  page={page}
                  bookId={bookId}
                  onNavigate={(pageId) => navigate(`/books/${bookId}/pages/${pageId}`)}
                  onDelete={canEdit ? handleDeletePage : undefined}
                  isBookmarked={bookmarkedPageIndex === page.page_index}
                  sectionNumber={sectionNumbers.get(page.id)}
                  // Outline shows chapter aggregates + roomier spacing; List is flat.
                  sectionMeta={viewMode === "outline" ? sectionMeta.get(page.id) : undefined}
                  displayNumber={displayNumbers.get(page.id)}
                  flat={viewMode === "list"}
                  ref={bookmarkedPageIndex === page.page_index ? bookmarkedPageRef : undefined}
                />
              )
            )}

            {/* Add a new page — a single dashed affordance at the end */}
            {canEdit && !isDeleteMode && (
              <AddPageRow isGrid={isGrid} onClick={() => createNewPage('text')} />
            )}
          </>
        )}
      </div>

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
  isGrid,
  onClick,
}: {
  isGrid: boolean;
  onClick: () => void;
}) {
  if (!isGrid) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="pv-serif mt-2 flex w-full items-center gap-2.5 rounded-[10px] border border-dashed border-[hsl(var(--pv-border))] px-4 py-3.5 text-left text-[16px] text-[hsl(var(--pv-text-muted))] transition-colors hover:border-[hsl(var(--pv-text-muted))] hover:bg-[hsl(var(--pv-surface))] hover:text-foreground"
      >
        <Plus className="h-4 w-4" />
        <span>Add a new page</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="pv-serif flex h-full min-h-[180px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-[hsl(var(--pv-border))] bg-transparent p-6 italic text-[hsl(var(--pv-text-muted))] transition-colors hover:bg-[hsl(var(--pv-surface-2))]/50 hover:text-foreground"
    >
      <Plus className="h-6 w-6" />
      <span className="text-[14px]">Add a new page</span>
    </button>
  );
}
