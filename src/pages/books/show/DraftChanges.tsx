/**
 * DraftChanges Page
 *
 * Full-page view for reviewing uncommitted (draft) changes
 * Git-style diff interface with side-by-side comparison
 */

import { useState, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { VersionService } from "@/services/VersionService";
import { DiffService, type FileStatus } from "@/services/DiffService";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageDiffViewer } from "@/components/book/PageDiffViewer";
import {
  ArrowLeft,
  FileEdit,
  FilePlus,
  FileX,
  ChevronRight,
  ChevronDown
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
  const [selectedFile, setSelectedFile] = useState<number | null>(null);
  const [expandedFiles, setExpandedFiles] = useState<Set<number>>(new Set());

  // Extract numeric ID from slug
  const getNumericId = (param: string | undefined) => {
    if (!param) return 0;
    const match = param.match(/^(\d+)/);
    return match ? parseInt(match[1]) : 0;
  };

  const bookId = getNumericId(bookSlug);

  // Fetch modified page IDs
  const { data: modifiedPageIdsData } = useQuery({
    queryKey: ["modified-pages", bookId],
    queryFn: () => VersionService.getModifiedPageIds(bookId),
    enabled: bookId > 0,
  });

  const modifiedPageIds = modifiedPageIdsData ?? [];

  // Create a stable string representation of the array for the query key
  // This prevents infinite loops caused by array reference changes
  // Serialize sorted array to compare by value, not reference
  const modifiedPageIdsKey = useMemo(() => {
    if (!modifiedPageIds.length) return "";
    const sorted = [...modifiedPageIds].sort((a, b) => a - b);
    return sorted.join(",");
  }, [
    // Use JSON.stringify of sorted array to compare by value, not reference
    modifiedPageIds.length > 0 ? JSON.stringify([...modifiedPageIds].sort((a, b) => a - b)) : ""
  ]);

  // Fetch latest version once (used by all page status checks)
  const { data: latestVersion } = useQuery({
    queryKey: ["latest-version", bookId],
    queryFn: () => VersionService.getLatestVersion(bookId),
    enabled: bookId > 0,
  });

  // Fetch page statuses in batch (much more efficient than individual queries)
  const { data: pageStatuses = [] } = useQuery({
    queryKey: ["page-statuses", bookId, modifiedPageIdsKey, latestVersion?.id],
    queryFn: async () => {
      // Fetch latest version once if not already fetched
      const version = latestVersion || await VersionService.getLatestVersion(bookId);
      
      // Use batch function to fetch all statuses at once
      return await DiffService.getPageStatusesBatch(modifiedPageIds, bookId, version);
    },
    enabled: modifiedPageIds.length > 0 && modifiedPageIdsKey !== "",
  });

  // Fetch book and pages data
  const { data: book } = useQuery({
    queryKey: ["book", bookId],
    queryFn: async () => {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data } = await supabase
        .from("books")
        .select("*")
        .eq("id", bookId)
        .single();
      return data;
    },
    enabled: bookId > 0,
  });

  const { data: pages = [] } = useQuery({
    queryKey: ["pages", bookId],
    queryFn: async () => {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data } = await supabase
        .from("pages")
        .select("*")
        .eq("book_id", bookId)
        .eq("archived", false)
        .order("page_index", { ascending: true });
      return data || [];
    },
    enabled: bookId > 0,
  });

  // Combine page data with status, filtering out unchanged pages
  const changedPages = modifiedPageIds
    .map((pageId) => {
      const page = pages.find((p) => p.id === pageId);
      const statusInfo = pageStatuses.find((s) => s.pageId === pageId);
      // Filter out pages with null status (unchanged content)
      if (!statusInfo || statusInfo.status === null) {
        return null;
      }
      return page && statusInfo
        ? {
            ...page,
            status: statusInfo.status,
          }
        : null;
    })
    .filter(Boolean);

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
                  {changedPages.length} file{changedPages.length !== 1 ? "s" : ""} changed
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
                {changedPages.map((page: any) => (
                  <div
                    key={page.id}
                    className={cn(
                      "flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer transition-colors",
                      "hover:bg-accent/50",
                      selectedFile === page.id && "bg-accent"
                    )}
                    onClick={() => toggleFile(page.id)}
                  >
                    {expandedFiles.has(page.id) ? (
                      <ChevronDown className="h-3 w-3 flex-shrink-0" />
                    ) : (
                      <ChevronRight className="h-3 w-3 flex-shrink-0" />
                    )}
                    {getStatusBadge(page.status)}
                    {getStatusIcon(page.status)}
                    <span className="text-sm truncate flex-1">{page.title}</span>
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
                      const page = changedPages.find((p: any) => p.id === selectedFile);
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
                      const page = changedPages.find((p: any) => p.id === selectedFile);
                      return page?.updated_at
                        ? formatDistanceToNow(new Date(page.updated_at), {
                            addSuffix: true,
                          })
                        : "";
                    })()}
                  </span>
                </div>

                {/* Diff Viewer */}
                <PageDiffViewer
                  pageId={selectedFile}
                  bookId={bookId}
                  compact={false}
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
    </div>
  );
}
