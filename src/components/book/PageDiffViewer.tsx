/**
 * PageDiffViewer Component
 *
 * Displays a side-by-side diff view comparing the committed version
 * and current workspace version of a page
 */

import { useState, useEffect } from "react";
import ReactDiffViewer, { DiffMethod } from "react-diff-viewer-continued";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, FileEdit, FilePlus, FileX } from "lucide-react";
import { DiffService, type PageDiff } from "@/services/DiffService";
import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BlockDiffViewer } from "./BlockDiffViewer";
import { FormattedDiffViewer } from "./FormattedDiffViewer";

interface PageDiffViewerProps {
  pageId: number;
  bookId: number;
  compact?: boolean; // For inline display
  bookSlug?: string; // Book slug for generating version links
}

const getStatusIcon = (status: PageDiff["status"]) => {
  switch (status) {
    case "added":
      return <FilePlus className="h-4 w-4 text-green-600" />;
    case "deleted":
      return <FileX className="h-4 w-4 text-red-600" />;
    case "modified":
      return <FileEdit className="h-4 w-4 text-orange-600" />;
  }
};

const getStatusBadge = (status: PageDiff["status"]) => {
  switch (status) {
    case "added":
      return (
        <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
          Added
        </Badge>
      );
    case "deleted":
      return (
        <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
          Deleted
        </Badge>
      );
    case "modified":
      return (
        <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200">
          Modified
        </Badge>
      );
  }
};

export function PageDiffViewer({ pageId, bookId, onClose, compact = false, bookSlug }: PageDiffViewerProps) {
  const [viewMode, setViewMode] = useState<"split" | "unified">("split");
  const [diffMode, setDiffMode] = useState<"blocks" | "text">("blocks"); // New: block vs text diff

  // Reset state when pageId changes
  useEffect(() => {
    setViewMode("split");
    setDiffMode("blocks");
  }, [pageId]);

  const { data: diff, isLoading, error } = useQuery({
    queryKey: ["page-diff", pageId, bookId],
    queryFn: () => DiffService.getPageDiff(pageId, bookId),
    staleTime: 0, // Always consider data stale to ensure fresh fetches
    refetchOnMount: true, // Always refetch when component mounts
    refetchOnWindowFocus: false, // Don't refetch on window focus
  });

  if (isLoading) {
    return (
      <div className={compact ? "py-8" : ""}>
        <Card className={compact ? "border-0 shadow-none" : ""}>
          <CardContent className="py-12">
            <div className="flex items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !diff) {
    return (
      <div className={compact ? "py-4" : ""}>
        <Card className={compact ? "border-0 shadow-none" : ""}>
          <CardContent className="py-12">
            <div className="text-center text-muted-foreground">
              Failed to load diff. Please try again.
              {error && <div className="text-xs mt-2 text-red-600">{String(error)}</div>}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const diffStyles = {
    variables: {
      light: {
        diffViewerBackground: "#fff",
        diffViewerColor: "#1f2937", // Darker for better contrast
        addedBackground: "#d1fae5", // Lighter green for better contrast
        addedColor: "#065f46", // Dark green text
        removedBackground: "#fee2e2", // Lighter red for better contrast
        removedColor: "#991b1b", // Dark red text
        wordAddedBackground: "#86efac", // Brighter green highlight
        wordRemovedBackground: "#fca5a5", // Brighter red highlight
        addedGutterBackground: "#a7f3d0",
        removedGutterBackground: "#fecaca",
        gutterBackground: "#f9fafb",
        gutterBackgroundDark: "#f3f4f6",
        highlightBackground: "#fef3c7",
        highlightGutterBackground: "#fde68a",
      },
    },
  };

  // Compact mode for inline display
  if (compact) {
    return (
      <div className="space-y-3 mt-3">
        {/* View Mode Tabs */}
        <div className="flex items-center justify-between gap-2">
          <Tabs value={diffMode} onValueChange={(v) => setDiffMode(v as "blocks" | "text")}>
            <TabsList className="h-8">
              <TabsTrigger value="blocks" className="text-xs h-7">
                Blocks
              </TabsTrigger>
              <TabsTrigger value="text" className="text-xs h-7">
                Text
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {diffMode === "text" && (
            <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as "split" | "unified")}>
              <TabsList className="h-8">
                <TabsTrigger value="split" className="text-xs h-7">
                  Split
                </TabsTrigger>
                <TabsTrigger value="unified" className="text-xs h-7">
                  Unified
                </TabsTrigger>
              </TabsList>
            </Tabs>
          )}
        </div>

        {/* Block Diff Viewer or Text Diff Viewer */}
        {diffMode === "blocks" && diff.blockDiffs ? (
          <BlockDiffViewer blockDiffs={diff.blockDiffs} compact={true} />
        ) : (
          <>
            {/* Text Diff Viewer */}
            <div className="border rounded-lg overflow-x-auto">
              <ReactDiffViewer
                oldValue={diff.oldContent}
                newValue={diff.newContent}
                splitView={viewMode === "split"}
                compareMethod={DiffMethod.WORDS}
                useDarkTheme={false}
                styles={diffStyles}
                leftTitle="Committed"
                rightTitle="Current"
                showDiffOnly={true}
                extraLinesSurroundingDiff={3}
              />
            </div>

            {/* Stats */}
            <div className="flex items-center gap-3 text-xs text-foreground/80">
              <div>
                <span className="font-medium text-foreground">{diff.oldContent.split("\n").length}</span> → <span className="font-medium text-foreground">{diff.newContent.split("\n").length}</span> lines
              </div>
              <div>
                {diff.newContent.split("\n").length - diff.oldContent.split("\n").length > 0
                  ? <span className="text-green-700 dark:text-green-400 font-medium">+{diff.newContent.split("\n").length - diff.oldContent.split("\n").length}</span>
                  : <span className="text-red-700 dark:text-red-400 font-medium">{diff.newContent.split("\n").length - diff.oldContent.split("\n").length}</span>}
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  // Full mode for standalone display - use side-by-side diff viewer
  // Hide header since parent component (DraftChanges) already shows one
  return <FormattedDiffViewer diff={diff} compact={true} bookSlug={bookSlug} />;
}
