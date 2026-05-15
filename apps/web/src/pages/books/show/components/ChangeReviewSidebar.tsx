/**
 * ChangeReviewSidebar Component
 *
 * Cloud Cursor-style side panel for reviewing and accepting/rejecting changes
 * Supports page-level and book-level context
 */

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { VersionService } from "@/services/VersionService";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import {
  CheckCircle2,
  XCircle,
  RotateCcw,
  Plus,
  BookOpen,
  FileText,
  Loader2,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { type FileStatus } from "@/services/DiffService";

interface ChangeReviewSidebarProps {
  bookId: number;
  changedPages: Array<{
    id: number;
    title: string;
    status: FileStatus;
  }>;
  selectedPageId: number | null;
  onPageSelect: (pageId: number | null) => void;
  onContextPagesChange?: (pageIds: number[]) => void;
  contextPages?: number[];
}

export function ChangeReviewSidebar({
  bookId,
  changedPages,
  selectedPageId,
  onPageSelect,
  onContextPagesChange,
  contextPages = [],
}: ChangeReviewSidebarProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [acceptedPages, setAcceptedPages] = useState<Set<number>>(new Set());
  const [rejectedPages, setRejectedPages] = useState<Set<number>>(new Set());
  const [scope, setScope] = useState<"pages" | "book">("pages");

  // Accept changes mutation
  const acceptMutation = useMutation({
    mutationFn: async (pageIds: number[]) => {
      // Changes are already applied (auto-applied by default)
      // This just marks them as accepted
      return pageIds;
    },
    onSuccess: (pageIds) => {
      const newAccepted = new Set(acceptedPages);
      pageIds.forEach((id) => {
        newAccepted.add(id);
        rejectedPages.delete(id);
      });
      setAcceptedPages(newAccepted);
      toast({
        title: "Changes accepted",
        description: `${pageIds.length} page${pageIds.length !== 1 ? "s" : ""} marked as accepted.`,
      });
    },
  });

  // Reject changes mutation (revert)
  const rejectMutation = useMutation({
    mutationFn: async (pageIds: number[]) => {
      const latestVersion = await VersionService.getLatestVersion(bookId);
      if (!latestVersion) {
        throw new Error("No previous version found. Cannot revert changes.");
      }

      const pageVersions = await VersionService.getPageVersions(latestVersion.id);

      for (const pageId of pageIds) {
        const pageVersion = pageVersions.find((pv) => pv.page_id === pageId);
        if (pageVersion) {
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
      }
    },
    onSuccess: (_, pageIds) => {
      const newRejected = new Set(rejectedPages);
      pageIds.forEach((id) => {
        newRejected.add(id);
        acceptedPages.delete(id);
      });
      setRejectedPages(newRejected);

      // Refresh data
      queryClient.invalidateQueries({ queryKey: ["modified-pages", bookId] });
      queryClient.invalidateQueries({ queryKey: ["uncommitted-changes", bookId] });
      queryClient.invalidateQueries({ queryKey: ["pages"] });
      queryClient.invalidateQueries({ queryKey: ["page-diff"] });

      toast({
        title: "Changes reverted",
        description: `${pageIds.length} page${pageIds.length !== 1 ? "s" : ""} reverted to last commit.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Revert failed",
        description: error.message || "Failed to revert changes. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleAccept = (pageId: number) => {
    acceptMutation.mutate([pageId]);
  };

  const handleReject = (pageId: number) => {
    rejectMutation.mutate([pageId]);
  };

  const handleAcceptAll = () => {
    const pageIds = changedPages.map((p) => p.id);
    acceptMutation.mutate(pageIds);
  };

  const handleRejectAll = () => {
    const pageIds = changedPages.map((p) => p.id);
    rejectMutation.mutate(pageIds);
  };

  const pendingPages = changedPages.filter(
    (p) => !acceptedPages.has(p.id) && !rejectedPages.has(p.id)
  );

  return (
    <div className="w-80 border-l border-border bg-background flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-foreground">Review Changes</h2>
          <Badge variant="outline" className="text-xs">
            {pendingPages.length} pending
          </Badge>
        </div>

        {/* Scope Toggle */}
        <div className="flex gap-2">
          <Button
            variant={scope === "pages" ? "default" : "outline"}
            size="sm"
            onClick={() => setScope("pages")}
            className="flex-1 text-xs h-7"
          >
            <FileText className="h-3 w-3 mr-1" />
            Pages
          </Button>
          <Button
            variant={scope === "book" ? "default" : "outline"}
            size="sm"
            onClick={() => setScope("book")}
            className="flex-1 text-xs h-7"
          >
            <BookOpen className="h-3 w-3 mr-1" />
            Book
          </Button>
        </div>
      </div>

      {/* Actions */}
      <div className="p-4 border-b border-border space-y-2">
        <Button
          onClick={handleAcceptAll}
          size="sm"
          className="w-full"
          disabled={acceptMutation.isPending || changedPages.length === 0}
        >
          {acceptMutation.isPending ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Accepting...
            </>
          ) : (
            <>
              <CheckCircle2 className="h-4 w-4 mr-2" />
              Accept All ({changedPages.length})
            </>
          )}
        </Button>
        <Button
          onClick={handleRejectAll}
          size="sm"
          variant="outline"
          className="w-full"
          disabled={rejectMutation.isPending || changedPages.length === 0}
        >
          {rejectMutation.isPending ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Reverting...
            </>
          ) : (
            <>
              <RotateCcw className="h-4 w-4 mr-2" />
              Revert All
            </>
          )}
        </Button>
      </div>

      {/* Changed Pages List */}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-2">
          <div className="text-xs font-medium text-muted-foreground uppercase mb-2">
            Changed Pages ({changedPages.length})
          </div>
          {changedPages.map((page) => {
            const isAccepted = acceptedPages.has(page.id);
            const isRejected = rejectedPages.has(page.id);
            const isSelected = selectedPageId === page.id;

            return (
              <Card
                key={page.id}
                className={cn(
                  "cursor-pointer transition-colors",
                  isSelected && "ring-2 ring-primary",
                  isAccepted && "bg-green-50/50 border-green-200",
                  isRejected && "bg-red-50/50 border-red-200"
                )}
                onClick={() => onPageSelect(isSelected ? null : page.id)}
              >
                <CardContent className="p-3">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-xs",
                            page.status === "added" && "bg-green-100 text-green-700 border-green-200",
                            page.status === "modified" && "bg-orange-100 text-orange-700 border-orange-200",
                            page.status === "deleted" && "bg-red-100 text-red-700 border-red-200"
                          )}
                        >
                          {page.status === "added" ? "A" : page.status === "modified" ? "M" : "D"}
                        </Badge>
                        <span className="text-sm font-medium text-foreground truncate">
                          {page.title}
                        </span>
                      </div>
                      {isAccepted && (
                        <div className="flex items-center gap-1 text-xs text-green-700 mt-1">
                          <CheckCircle2 className="h-3 w-3" />
                          <span>Accepted</span>
                        </div>
                      )}
                      {isRejected && (
                        <div className="flex items-center gap-1 text-xs text-red-700 mt-1">
                          <XCircle className="h-3 w-3" />
                          <span>Reverted</span>
                        </div>
                      )}
                    </div>
                    {isSelected && (
                      <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    )}
                  </div>

                  {/* Action Buttons */}
                  {!isAccepted && !isRejected && (
                    <div className="flex gap-2 mt-2" onClick={(e) => e.stopPropagation()}>
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 h-7 text-xs"
                        onClick={() => handleAccept(page.id)}
                        disabled={acceptMutation.isPending}
                      >
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        Accept
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 h-7 text-xs"
                        onClick={() => handleReject(page.id)}
                        disabled={rejectMutation.isPending}
                      >
                        <RotateCcw className="h-3 w-3 mr-1" />
                        Revert
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Context Pages Section */}
        {scope === "book" && (
          <>
            <Separator className="my-4" />
            <div className="px-4 pb-4">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-medium text-muted-foreground uppercase">
                  Context Pages
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 text-xs"
                  onClick={() => {
                    // TODO: Open dialog to add pages
                    toast({
                      title: "Add context pages",
                      description: "Feature coming soon - add pages to context",
                    });
                  }}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Add
                </Button>
              </div>
              {contextPages.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No additional context pages. Changes are shown with page context by default.
                </p>
              ) : (
                <div className="space-y-1">
                  {contextPages.map((pageId) => (
                    <div
                      key={pageId}
                      className="text-xs text-muted-foreground p-2 bg-muted/50 rounded"
                    >
                      Page {pageId}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </ScrollArea>

      {/* Footer Stats */}
      <div className="p-4 border-t border-border">
        <div className="text-xs space-y-1">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Accepted:</span>
            <span className="font-medium text-green-700">{acceptedPages.size}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Reverted:</span>
            <span className="font-medium text-red-700">{rejectedPages.size}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Pending:</span>
            <span className="font-medium text-orange-700">{pendingPages.length}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

