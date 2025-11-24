/**
 * UncommittedChangesPanel Component
 *
 * Displays list of uncommitted changes with ability to:
 * - View modified pages
 * - Revert individual pages
 * - Revert all changes (bulk operation)
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { VersionService } from "@/services/VersionService";
import { DiffService, type FileStatus } from "@/services/DiffService";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  FileEdit,
  RotateCcw,
  CheckCircle2,
  Loader2,
  ExternalLink,
  Trash2,
  FilePlus,
  FileX,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Checkbox } from "@/components/ui/checkbox";
import { PageDiffViewer } from "@/components/book/PageDiffViewer";
import { cn } from "@/lib/utils";

// Types
interface PageChange {
  id: number;
  title: string;
  pageIndex: number;
  lastModified: string;
  slug: string;
  status: FileStatus;
}

interface Page {
  id: number;
  page_index: number;
  updated_at: string;
  title: string | null;
  slug: string | null;
}

interface UncommittedChangesPanelProps {
  bookId: number;
  bookSlug: string;
  pages: Page[];
  canEdit: boolean;
  vsCodeMode?: boolean;
  onFileSelect?: (pageId: number | null) => void;
  selectedFile?: number | null;
}

type RevertTarget = "single" | "selected" | "all" | null;

// Constants
const STATUS_CONFIG = {
  added: {
    icon: FilePlus,
    badgeColor: "bg-green-100 text-green-900 border-green-400 dark:bg-green-900 dark:text-green-100 dark:border-green-600",
    iconColor: "text-green-700 dark:text-green-400",
    label: "A",
  },
  deleted: {
    icon: FileX,
    badgeColor: "bg-red-100 text-red-900 border-red-400 dark:bg-red-900 dark:text-red-100 dark:border-red-600",
    iconColor: "text-red-700 dark:text-red-400",
    label: "D",
  },
  modified: {
    icon: FileEdit,
    badgeColor: "bg-orange-100 text-orange-900 border-orange-400 dark:bg-orange-900 dark:text-orange-100 dark:border-orange-600",
    iconColor: "text-orange-700 dark:text-orange-400",
    label: "M",
  },
} as const;

// Helper Functions
const getStatusIcon = (status: FileStatus) => {
  const config = STATUS_CONFIG[status];
  const Icon = config.icon;
  return <Icon className={cn("h-4 w-4", config.iconColor)} />;
};

const getStatusBadge = (status: FileStatus) => {
  const config = STATUS_CONFIG[status];
  return (
    <Badge variant="outline" className={cn("text-xs", config.badgeColor)}>
      {config.label}
    </Badge>
  );
};

export function UncommittedChangesPanel({
  bookId,
  bookSlug,
  pages,
  canEdit,
  vsCodeMode = false,
  onFileSelect,
  selectedFile,
}: UncommittedChangesPanelProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // State Management
  const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set());
  const [revertTarget, setRevertTarget] = useState<RevertTarget>(null);
  const [singlePageId, setSinglePageId] = useState<number | null>(null);
  const [expandedDiffs, setExpandedDiffs] = useState<Set<number>>(new Set());

  // Data Fetching
  const {
    data: modifiedPageIds,
    isLoading: loadingIds,
  } = useQuery({
    queryKey: ["modified-pages", bookId],
    queryFn: () => VersionService.getModifiedPageIds(bookId),
  });

  const {
    data: changesSummary,
    isLoading: loadingSummary,
  } = useQuery({
    queryKey: ["uncommitted-changes", bookId],
    queryFn: () => VersionService.getUncommittedChanges(bookId),
  });

  // Revert Logic
  const revertPages = async (pageIds: number[]) => {
    const latestVersion = await VersionService.getLatestVersion(bookId);
    if (!latestVersion) {
      throw new Error("No previous version found. Cannot revert changes.");
    }

    const pageVersions = await VersionService.getPageVersions(latestVersion.id);

    for (const pageId of pageIds) {
      const pageVersion = pageVersions.find((pv) => pv.page_id === pageId);
      if (!pageVersion) continue;

      const { error } = await supabase
        .from("pages")
        .update({
          title: pageVersion.title,
          content: pageVersion.content,
          updated_at: new Date().toISOString(),
        })
        .eq("id", pageId);

      if (error) throw error;
    }
  };

  const revertMutation = useMutation({
    mutationFn: revertPages,
    onSuccess: () => {
      toast({
        title: "Changes reverted",
        description: "Selected pages have been restored to the last commit.",
      });

      // Refresh data
      queryClient.invalidateQueries({ queryKey: ["modified-pages", bookId] });
      queryClient.invalidateQueries({ queryKey: ["uncommitted-changes", bookId] });
      queryClient.invalidateQueries({ queryKey: ["pages"] });
      queryClient.invalidateQueries({ queryKey: ["books", bookId] });

      // Reset state
      setSelectedPages(new Set());
      setRevertTarget(null);
      setSinglePageId(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Revert failed",
        description: error.message || "Failed to revert changes. Please try again.",
        variant: "destructive",
      });
      setRevertTarget(null);
      setSinglePageId(null);
    },
  });

  // Event Handlers - Revert Actions
  const handleRevertSingle = (pageId: number) => {
    setSinglePageId(pageId);
    setRevertTarget("single");
  };

  const handleRevertSelected = () => {
    if (selectedPages.size === 0) {
      toast({
        title: "No pages selected",
        description: "Please select pages to revert.",
        variant: "destructive",
      });
      return;
    }
    setRevertTarget("selected");
  };

  const handleRevertAll = () => {
    setRevertTarget("all");
  };

  const handleRevertConfirm = () => {
    if (!revertTarget) return;

    let pageIdsToRevert: number[] = [];

    if (revertTarget === "single" && singlePageId) {
      pageIdsToRevert = [singlePageId];
    } else if (revertTarget === "selected") {
      pageIdsToRevert = Array.from(selectedPages);
    } else if (revertTarget === "all" && modifiedPageIds) {
      pageIdsToRevert = modifiedPageIds;
    }

    if (pageIdsToRevert.length > 0) {
      revertMutation.mutate(pageIdsToRevert);
    }
  };

  // Event Handlers - Selection
  const togglePageSelection = (pageId: number) => {
    const newSelection = new Set(selectedPages);
    if (newSelection.has(pageId)) {
      newSelection.delete(pageId);
    } else {
      newSelection.add(pageId);
    }
    setSelectedPages(newSelection);
  };

  const toggleSelectAll = () => {
    if (!modifiedPageIds) return;

    const allSelected = selectedPages.size === modifiedPageIds.length;
    setSelectedPages(allSelected ? new Set() : new Set(modifiedPageIds));
  };

  // Event Handlers - Diff View
  const toggleDiff = (pageId: number) => {
    if (vsCodeMode && onFileSelect) {
      // VSCode mode: toggle file selection for full-width diff
      onFileSelect(selectedFile === pageId ? null : pageId);
    } else {
      // Inline mode: expand/collapse diff
      const newExpanded = new Set(expandedDiffs);
      if (newExpanded.has(pageId)) {
        newExpanded.delete(pageId);
      } else {
        newExpanded.add(pageId);
      }
      setExpandedDiffs(newExpanded);
    }
  };

  // Fetch page statuses for all modified pages
  const { data: pageStatuses } = useQuery({
    queryKey: ["page-statuses", bookId, modifiedPageIds],
    queryFn: async () => {
      if (!modifiedPageIds || modifiedPageIds.length === 0) return {};

      const statuses: Record<number, FileStatus | null> = {};
      for (const pageId of modifiedPageIds) {
        const status = await DiffService.getPageStatus(pageId, bookId);
        statuses[pageId] = status;
      }
      return statuses;
    },
    enabled: !!modifiedPageIds && modifiedPageIds.length > 0,
  });

  // Process changed pages with status information
  const changedPages: PageChange[] = (modifiedPageIds || [])
    .map((pageId) => {
      const page = pages.find((p) => p.id === pageId);
      if (!page) return null;

      const status = pageStatuses?.[pageId];
      // Only include pages with actual changes (non-null status)
      if (status === null || status === undefined) return null;

      return {
        id: page.id,
        title: page.title || "Untitled",
        pageIndex: page.page_index,
        lastModified: page.updated_at,
        slug: page.slug || page.id.toString(),
        status: status as FileStatus,
      };
    })
    .filter((page): page is PageChange => page !== null && page.status !== undefined);

  // Computed Values
  const isLoading = loadingIds || loadingSummary;
  const hasChanges = changesSummary?.hasChanges && changedPages.length > 0;

  // Loading State
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-foreground/70" />
      </div>
    );
  }

  // No Changes State
  if (!hasChanges) {
    return (
      <Alert>
        <CheckCircle2 className="h-4 w-4" />
        <AlertDescription className="text-foreground">
          No uncommitted changes. Your workspace is up to date with the last commit.
        </AlertDescription>
      </Alert>
    );
  }

  // VSCode Mode - Full Diff View
  if (vsCodeMode && selectedFile) {
    const selectedPage = changedPages.find((p) => p.id === selectedFile);
    if (selectedPage) {
      return (
        <div className="w-full">
          <PageDiffViewer pageId={selectedFile} bookId={bookId} compact={false} />
        </div>
      );
    }
  }

  // VSCode Mode - File List Sidebar
  if (vsCodeMode) {
    return (
      <div className="space-y-1">
        {changedPages.map((page) => (
          <div
            key={page.id}
            className={cn(
              "flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-accent/50 transition-colors text-sm",
              selectedFile === page.id && "bg-accent"
            )}
            onClick={() => toggleDiff(page.id)}
          >
            {page.status && (
              <div className="flex-shrink-0">{getStatusBadge(page.status)}</div>
            )}
            <div className="flex-1 min-w-0 truncate font-medium text-foreground">{page.title}</div>
          </div>
        ))}
      </div>
    );
  }

  // Inline Mode - Full Card View
  const renderPageItem = (page: PageChange) => {
    const isExpanded = expandedDiffs.has(page.id);
    const isSelected = selectedPages.has(page.id);
    const showCheckbox = canEdit && changedPages.length > 1;

    return (
      <div key={page.id} className="rounded-lg border border-border transition-colors">
        {/* Header: Expand/Collapse, Checkbox, Status, Title */}
        <div
          className="flex items-start gap-2 p-3 pb-2 cursor-pointer hover:bg-accent/50"
          onClick={() => toggleDiff(page.id)}
        >
          <div className="flex-shrink-0 mt-0.5">
            {isExpanded ? (
              <ChevronDown className="h-4 w-4 text-foreground/70" />
            ) : (
              <ChevronRight className="h-4 w-4 text-foreground/70" />
            )}
          </div>

          {showCheckbox && (
            <div onClick={(e) => e.stopPropagation()}>
              <Checkbox
                checked={isSelected}
                onCheckedChange={() => {
                  togglePageSelection(page.id);
                }}
                className="mt-0.5 flex-shrink-0"
              />
            </div>
          )}

          {page.status && (
            <div className="flex-shrink-0 mt-0.5">{getStatusBadge(page.status)}</div>
          )}

          <div className="flex-1 min-w-0">
            <div className="flex items-start gap-2 flex-wrap">
              <span className="font-medium text-sm break-words text-foreground">{page.title}</span>
              <Badge variant="secondary" className="text-xs flex-shrink-0 text-foreground/80 bg-muted">
                Page {page.pageIndex + 1}
              </Badge>
            </div>
          </div>
        </div>

        {/* Footer: Timestamp and Actions */}
        <div className="flex items-center justify-between px-3 pb-3 pt-0 gap-2 pl-9">
          <p className="text-xs text-foreground/70 flex-1 min-w-0 truncate">
            {formatDistanceToNow(new Date(page.lastModified), { addSuffix: true })}
          </p>

          <div className="flex items-center gap-1 flex-shrink-0">
            <Button
              size="sm"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                window.open(`/books/${bookId}/pages/${page.id}`, "_blank");
              }}
              className="h-7 w-7 p-0"
              title="Open page"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
            {canEdit && (
              <Button
                size="sm"
                variant="ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  handleRevertSingle(page.id);
                }}
                className="h-7 w-7 p-0 text-orange-600 hover:text-orange-700 hover:bg-orange-50"
                title="Revert changes"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>

        {/* Expanded Diff Viewer */}
        {isExpanded && (
          <div className="border-t border-border px-3 pb-3">
            <PageDiffViewer pageId={page.id} bookId={bookId} compact={true} />
          </div>
        )}
      </div>
    );
  };

  const renderRevertDialogMessage = () => {
    if (revertTarget === "single") {
      return (
        <>
          This will restore the selected page to its state at the last commit.
          <br />
          <br />
          <strong>Your current unsaved changes to this page will be lost.</strong>
        </>
      );
    }

    if (revertTarget === "selected") {
      return (
        <>
          This will restore {selectedPages.size} selected page
          {selectedPages.size !== 1 ? "s" : ""} to their state at the last commit.
          <br />
          <br />
          <strong>Your current unsaved changes to these pages will be lost.</strong>
        </>
      );
    }

    if (revertTarget === "all") {
      return (
        <>
          This will restore all {changedPages.length} modified page
          {changedPages.length !== 1 ? "s" : ""} to their state at the last commit.
          <br />
          <br />
          <strong>All your current unsaved changes will be lost.</strong>
        </>
      );
    }

    return null;
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-foreground">
                <FileEdit className="h-5 w-5" />
                Uncommitted Changes
              </CardTitle>
              <CardDescription className="text-foreground/80">
                {changedPages.length} page{changedPages.length !== 1 ? "s" : ""} modified
                {changesSummary?.lastCommitAt &&
                  ` since ${formatDistanceToNow(new Date(changesSummary.lastCommitAt), {
                    addSuffix: true,
                  })}`}
              </CardDescription>
            </div>
            {canEdit && changedPages.length > 1 && (
              <Button size="sm" variant="outline" onClick={toggleSelectAll} className="text-xs">
                {selectedPages.size === changedPages.length ? "Deselect All" : "Select All"}
              </Button>
            )}
          </div>
        </CardHeader>

        <CardContent>
          <ScrollArea className="h-[400px] pr-4">
            <div className="space-y-2">{changedPages.map(renderPageItem)}</div>
          </ScrollArea>

          {canEdit && (
            <div className="mt-4 flex flex-col sm:flex-row gap-2">
              {selectedPages.size > 0 && (
                <Button
                  onClick={handleRevertSelected}
                  variant="outline"
                  className="flex-1 gap-2 text-sm"
                  disabled={revertMutation.isPending}
                >
                  <RotateCcw className="h-4 w-4" />
                  <span className="hidden sm:inline">
                    Revert Selected ({selectedPages.size})
                  </span>
                  <span className="sm:hidden">Selected ({selectedPages.size})</span>
                </Button>
              )}
              <Button
                onClick={handleRevertAll}
                variant="outline"
                className="flex-1 gap-2 text-sm"
                disabled={revertMutation.isPending}
              >
                <Trash2 className="h-4 w-4" />
                <span className="hidden sm:inline">Revert All Changes</span>
                <span className="sm:hidden">Revert All</span>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Revert Confirmation Dialog */}
      <AlertDialog
        open={revertTarget !== null}
        onOpenChange={(open) => !open && setRevertTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revert changes?</AlertDialogTitle>
            <AlertDialogDescription>{renderRevertDialogMessage()}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revertMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRevertConfirm}
              disabled={revertMutation.isPending}
              className="bg-orange-600 hover:bg-orange-700"
            >
              {revertMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Reverting...
                </>
              ) : (
                "Revert"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
