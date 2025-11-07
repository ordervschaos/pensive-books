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
  AlertCircle,
  Loader2,
  ExternalLink,
  Trash2,
  FilePlus,
  FileX,
  Eye,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Checkbox } from "@/components/ui/checkbox";
import { PageDiffViewer } from "@/components/book/PageDiffViewer";

interface PageChange {
  id: number;
  title: string;
  pageIndex: number;
  lastModified: string;
  slug: string;
  status?: FileStatus;
}

interface UncommittedChangesPanelProps {
  bookId: number;
  bookSlug: string;
  pages: any[];
  canEdit: boolean;
  vsCodeMode?: boolean; // New: for VSCode-style layout
  onFileSelect?: (pageId: number | null) => void; // New: callback when file is selected
  selectedFile?: number | null; // New: currently selected file
}

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
  const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set());
  const [revertTarget, setRevertTarget] = useState<"single" | "selected" | "all" | null>(null);
  const [singlePageId, setSinglePageId] = useState<number | null>(null);
  const [expandedDiffs, setExpandedDiffs] = useState<Set<number>>(new Set());

  // Fetch modified page IDs
  const {
    data: modifiedPageIds,
    isLoading: loadingIds,
  } = useQuery({
    queryKey: ["modified-pages", bookId],
    queryFn: () => VersionService.getModifiedPageIds(bookId),
  });

  // Get uncommitted changes summary
  const {
    data: changesSummary,
    isLoading: loadingSummary,
  } = useQuery({
    queryKey: ["uncommitted-changes", bookId],
    queryFn: () => VersionService.getUncommittedChanges(bookId),
  });

  // Revert mutation
  const revertMutation = useMutation({
    mutationFn: async (pageIds: number[]) => {
      // Get the last version to revert to
      const latestVersion = await VersionService.getLatestVersion(bookId);

      if (!latestVersion) {
        throw new Error("No previous version found. Cannot revert changes.");
      }

      // Get page versions from the last commit
      const pageVersions = await VersionService.getPageVersions(latestVersion.id);

      // Revert each page
      for (const pageId of pageIds) {
        const pageVersion = pageVersions.find((pv) => pv.page_id === pageId);

        if (pageVersion) {
          // Restore page content from version
          const { error } = await supabase
            .from("pages")
            .update({
              title: pageVersion.title,
              content: pageVersion.content,
              updated_at: new Date().toISOString(),
            })
            .eq("id", pageId);

          if (error) {
            throw error;
          }
        }
      }
    },
    onSuccess: () => {
      toast({
        title: "Changes reverted",
        description: "Selected pages have been restored to the last commit.",
      });

      // Invalidate queries to refresh UI
      queryClient.invalidateQueries({ queryKey: ["modified-pages", bookId] });
      queryClient.invalidateQueries({ queryKey: ["uncommitted-changes", bookId] });
      queryClient.invalidateQueries({ queryKey: ["pages"] });
      queryClient.invalidateQueries({ queryKey: ["books", bookId] });

      // Clear selection and close dialog
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
    if (revertTarget === "single" && singlePageId) {
      revertMutation.mutate([singlePageId]);
    } else if (revertTarget === "selected") {
      revertMutation.mutate(Array.from(selectedPages));
    } else if (revertTarget === "all" && modifiedPageIds) {
      revertMutation.mutate(modifiedPageIds);
    }
  };

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
    if (modifiedPageIds && selectedPages.size === modifiedPageIds.length) {
      setSelectedPages(new Set());
    } else if (modifiedPageIds) {
      setSelectedPages(new Set(modifiedPageIds));
    }
  };

  const toggleDiff = (pageId: number) => {
    if (vsCodeMode && onFileSelect) {
      // VSCode mode: select file for full-width diff
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

  // Fetch page statuses
  const { data: pageStatuses } = useQuery({
    queryKey: ["page-statuses", bookId, modifiedPageIds],
    queryFn: async () => {
      if (!modifiedPageIds || modifiedPageIds.length === 0) return {};
      const statuses: Record<number, FileStatus> = {};
      for (const pageId of modifiedPageIds) {
        const status = await DiffService.getPageStatus(pageId, bookId);
        statuses[pageId] = status;
      }
      return statuses;
    },
    enabled: !!modifiedPageIds && modifiedPageIds.length > 0,
  });

  // Build list of changed pages with details
  const changedPages: PageChange[] = (modifiedPageIds || [])
    .map((pageId) => {
      const page = pages.find((p) => p.id === pageId);
      if (!page) return null;
      return {
        id: page.id,
        title: page.title || "Untitled",
        pageIndex: page.page_index,
        lastModified: page.updated_at,
        slug: page.slug || page.id.toString(),
        status: pageStatuses?.[pageId] || "modified",
      };
    })
    .filter(Boolean) as PageChange[];

  const getStatusIcon = (status: FileStatus) => {
    switch (status) {
      case "added":
        return <FilePlus className="h-4 w-4 text-green-600" />;
      case "deleted":
        return <FileX className="h-4 w-4 text-red-600" />;
      case "modified":
        return <FileEdit className="h-4 w-4 text-orange-600" />;
    }
  };

  const getStatusBadge = (status: FileStatus) => {
    switch (status) {
      case "added":
        return (
          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 text-xs">
            A
          </Badge>
        );
      case "deleted":
        return (
          <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 text-xs">
            D
          </Badge>
        );
      case "modified":
        return (
          <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200 text-xs">
            M
          </Badge>
        );
    }
  };

  const isLoading = loadingIds || loadingSummary;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!changesSummary?.hasChanges || changedPages.length === 0) {
    return (
      <Alert>
        <CheckCircle2 className="h-4 w-4" />
        <AlertDescription>
          No uncommitted changes. Your workspace is up to date with the last commit.
        </AlertDescription>
      </Alert>
    );
  }

  // VSCode mode: Render selected file's full diff in main content area
  if (vsCodeMode && selectedFile) {
    const selectedPage = changedPages.find(p => p.id === selectedFile);
    if (selectedPage) {
      return (
        <div className="w-full">
          <PageDiffViewer
            pageId={selectedFile}
            bookId={bookId}
            compact={false}
          />
        </div>
      );
    }
  }

  // VSCode mode: File list for sidebar
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
            {/* Status Badge */}
            <div className="flex-shrink-0">
              {page.status && getStatusBadge(page.status)}
            </div>

            {/* Title */}
            <div className="flex-1 min-w-0 truncate font-medium">
              {page.title}
            </div>
          </div>
        ))}
      </div>
    );
  }

  // Original inline mode
  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <FileEdit className="h-5 w-5" />
                Uncommitted Changes
              </CardTitle>
              <CardDescription>
                {changedPages.length} page{changedPages.length !== 1 ? "s" : ""} modified
                {changesSummary?.lastCommitAt &&
                  ` since ${formatDistanceToNow(new Date(changesSummary.lastCommitAt), {
                    addSuffix: true,
                  })}`}
              </CardDescription>
            </div>
            {canEdit && changedPages.length > 1 && (
              <Button
                size="sm"
                variant="outline"
                onClick={toggleSelectAll}
                className="text-xs"
              >
                {selectedPages.size === changedPages.length ? "Deselect All" : "Select All"}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[400px] pr-4">
            <div className="space-y-2">
              {changedPages.map((page) => (
                <div
                  key={page.id}
                  className="rounded-lg border border-border transition-colors"
                >
                  {/* Top row: Checkbox, Status, Title - Clickable to expand/collapse */}
                  <div
                    className="flex items-start gap-2 p-3 pb-2 cursor-pointer hover:bg-accent/50"
                    onClick={() => toggleDiff(page.id)}
                  >
                    {/* Expand/Collapse Icon */}
                    <div className="flex-shrink-0 mt-0.5">
                      {expandedDiffs.has(page.id) ? (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>

                    {canEdit && changedPages.length > 1 && (
                      <Checkbox
                        checked={selectedPages.has(page.id)}
                        onCheckedChange={(e) => {
                          e.stopPropagation();
                          togglePageSelection(page.id);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="mt-0.5 flex-shrink-0"
                      />
                    )}

                    {/* Status Badge */}
                    <div className="flex-shrink-0 mt-0.5">
                      {page.status && getStatusBadge(page.status)}
                    </div>

                    {/* Title and Page Number - takes up remaining space */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start gap-2 flex-wrap">
                        <span className="font-medium text-sm break-words">{page.title}</span>
                        <Badge variant="secondary" className="text-xs flex-shrink-0">
                          Page {page.pageIndex + 1}
                        </Badge>
                      </div>
                    </div>
                  </div>

                  {/* Bottom row: Timestamp and Actions */}
                  <div className="flex items-center justify-between px-3 pb-3 pt-0 gap-2 pl-9">
                    <p className="text-xs text-muted-foreground flex-1 min-w-0 truncate">
                      {formatDistanceToNow(new Date(page.lastModified), { addSuffix: true })}
                    </p>

                    <div className="flex items-center gap-1 flex-shrink-0">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => window.open(`/books/${bookId}/pages/${page.id}`, "_blank")}
                        className="h-7 w-7 p-0"
                        title="Open page"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Button>
                      {canEdit && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleRevertSingle(page.id)}
                          className="h-7 w-7 p-0 text-orange-600 hover:text-orange-700 hover:bg-orange-50"
                          title="Revert changes"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Inline Diff Viewer - Expanded */}
                  {expandedDiffs.has(page.id) && (
                    <div className="border-t border-border px-3 pb-3">
                      <PageDiffViewer
                        pageId={page.id}
                        bookId={bookId}
                        compact={true}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
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
                  <span className="hidden sm:inline">Revert Selected ({selectedPages.size})</span>
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
            <AlertDialogDescription>
              {revertTarget === "single" && (
                <>
                  This will restore the selected page to its state at the last commit.
                  <br />
                  <br />
                  <strong>Your current unsaved changes to this page will be lost.</strong>
                </>
              )}
              {revertTarget === "selected" && (
                <>
                  This will restore {selectedPages.size} selected page
                  {selectedPages.size !== 1 ? "s" : ""} to their state at the last commit.
                  <br />
                  <br />
                  <strong>Your current unsaved changes to these pages will be lost.</strong>
                </>
              )}
              {revertTarget === "all" && (
                <>
                  This will restore all {changedPages.length} modified page
                  {changedPages.length !== 1 ? "s" : ""} to their state at the last commit.
                  <br />
                  <br />
                  <strong>All your current unsaved changes will be lost.</strong>
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revertMutation.isPending}>
              Cancel
            </AlertDialogCancel>
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
