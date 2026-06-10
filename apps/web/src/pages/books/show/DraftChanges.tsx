/**
 * DraftChanges Page
 *
 * Full-page view for reviewing uncommitted (draft) changes
 * Git-style diff interface with side-by-side comparison
 */

import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { VersionService } from "@/services/VersionService";
import type { FileStatus } from "@/services/DiffService";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageDiffViewer } from "@/components/book/PageDiffViewer";
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
import {
  ArrowLeft,
  FileEdit,
  FilePlus,
  FileX,
  ChevronRight,
  ChevronDown,
  RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

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

export default function DraftChanges() {
  const { bookSlug } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedFile, setSelectedFile] = useState<number | null>(null);
  const [expandedFiles, setExpandedFiles] = useState<Set<number>>(new Set());
  const [revertTarget, setRevertTarget] = useState<{ pageId: number; title: string } | null>(null);
  const [reverting, setReverting] = useState(false);

  // Extract numeric ID from slug
  const getNumericId = (param: string | undefined) => {
    if (!param) return 0;
    const match = param.match(/^(\d+)/);
    return match ? parseInt(match[1]) : 0;
  };

  const bookId = getNumericId(bookSlug);

  // Single server-side query: which pages differ from the last commit and how.
  // Content is never fetched here — only the per-page diff (lazy, on click) does.
  const { data: changedPages = [], isLoading } = useQuery({
    queryKey: ["draft-changes", bookId],
    queryFn: () => VersionService.getDraftChanges(bookId),
    enabled: bookId > 0,
  });

  // Lightweight book header (name only)
  const { data: book } = useQuery({
    queryKey: ["book-name", bookId],
    queryFn: async () => {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data } = await supabase
        .from("books")
        .select("name")
        .eq("id", bookId)
        .single();
      return data;
    },
    enabled: bookId > 0,
  });

  const handleRevert = async () => {
    if (!revertTarget) return;
    setReverting(true);
    try {
      await VersionService.revertPage(bookId, revertTarget.pageId);
      if (selectedFile === revertTarget.pageId) setSelectedFile(null);
      setExpandedFiles((prev) => {
        const next = new Set(prev);
        next.delete(revertTarget.pageId);
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ["draft-changes", bookId] });
      queryClient.invalidateQueries({ queryKey: ["uncommitted-changes", bookId] });
    } finally {
      setReverting(false);
      setRevertTarget(null);
    }
  };

  const toggleFile = (pageId: number) => {
    const newExpanded = new Set(expandedFiles);
    if (newExpanded.has(pageId)) {
      newExpanded.delete(pageId);
      if (selectedFile === pageId) {
        setSelectedFile(null);
      }
    } else {
      newExpanded.add(pageId);
      setSelectedFile(pageId);
    }
    setExpandedFiles(newExpanded);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border bg-background sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate(`/books/${bookSlug}`)}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div>
                <h1 className="text-lg font-semibold">{book?.name || "Book"}</h1>
                <p className="text-sm text-muted-foreground">
                  {isLoading
                    ? "Checking for changes…"
                    : `${changedPages.length} file${changedPages.length !== 1 ? "s" : ""} changed`}
                </p>
              </div>
            </div>
            <Button onClick={() => navigate(`/books/${bookSlug}`)}>
              Back to Book
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-6">
        <div className="grid grid-cols-12 gap-6">
          {/* Left Sidebar - File List */}
          <div className="col-span-3 space-y-2">
            <div className="sticky top-20">
              <h2 className="text-sm font-semibold mb-3 text-muted-foreground uppercase">
                Changed Files
              </h2>
              <div className="space-y-1">
                {changedPages.map((page) => (
                  <div
                    key={page.pageId}
                    className={cn(
                      "group flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer transition-colors",
                      "hover:bg-accent/50",
                      selectedFile === page.pageId && "bg-accent"
                    )}
                    onClick={() => toggleFile(page.pageId)}
                  >
                    {expandedFiles.has(page.pageId) ? (
                      <ChevronDown className="h-3 w-3 flex-shrink-0" />
                    ) : (
                      <ChevronRight className="h-3 w-3 flex-shrink-0" />
                    )}
                    {getStatusBadge(page.status)}
                    {getStatusIcon(page.status)}
                    <span className="text-sm truncate flex-1">{page.title}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 opacity-0 group-hover:opacity-100 flex-shrink-0 text-muted-foreground hover:text-destructive"
                      title="Discard changes"
                      onClick={(e) => {
                        e.stopPropagation();
                        setRevertTarget({ pageId: page.pageId, title: page.title });
                      }}
                    >
                      <RotateCcw className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right Content - Diff Viewer */}
          <div className="col-span-9">
            {selectedFile ? (
              <div className="space-y-4">
                {/* Page Info */}
                <div className="flex items-center justify-between pb-3 border-b">
                  <div className="flex items-center gap-3">
                    {(() => {
                      const page = changedPages.find((p) => p.pageId === selectedFile);
                      return (
                        <>
                          {page && getStatusIcon(page.status)}
                          <h2 className="text-xl font-semibold">
                            {page?.title || "Untitled"}
                          </h2>
                          {page && getStatusBadge(page.status)}
                        </>
                      );
                    })()}
                  </div>
                  <span className="text-sm text-muted-foreground">
                    {(() => {
                      const page = changedPages.find((p) => p.pageId === selectedFile);
                      return page?.updatedAt
                        ? formatDistanceToNow(new Date(page.updatedAt), {
                            addSuffix: true,
                          })
                        : "";
                    })()}
                  </span>
                </div>

                {/* Diff Viewer */}
                <PageDiffViewer
                  key={`diff-${selectedFile}`}
                  pageId={selectedFile}
                  bookId={bookId}
                  compact={false}
                  bookSlug={bookSlug}
                />
              </div>
            ) : (
              <div className="flex items-center justify-center h-96 text-muted-foreground">
                <div className="text-center">
                  <FileEdit className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p className="text-lg font-medium">No file selected</p>
                  <p className="text-sm mt-2">Select a file from the list to view changes</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      <AlertDialog open={!!revertTarget} onOpenChange={(open) => { if (!open) setRevertTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard changes to "{revertTarget?.title}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This will restore the page to its last committed state. Uncommitted edits will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={reverting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={reverting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleRevert}
            >
              {reverting ? "Discarding…" : "Discard changes"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
