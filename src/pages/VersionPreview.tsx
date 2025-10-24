/**
 * VersionPreview Page
 *
 * Read-only view of a historical book version.
 * Shows book metadata and pages as they were at that specific commit.
 *
 * URL: /book/:bookId/version/:versionId
 */

import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { VersionService } from "@/services/VersionService";
import { BookInfo } from "@/components/book/BookInfo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  ArrowLeft,
  Clock,
  Eye,
  RotateCcw,
  FileText,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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

const VersionPreview = () => {
  const { bookId, versionId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showRollbackDialog, setShowRollbackDialog] = useState(false);

  // Fetch version details
  const {
    data: version,
    isLoading: versionLoading,
    error: versionError,
  } = useQuery({
    queryKey: ["version-details", versionId],
    queryFn: () => VersionService.getVersionDetails(parseInt(versionId || "0")),
    enabled: !!versionId,
  });

  // Fetch book version (metadata)
  const {
    data: bookVersion,
    isLoading: bookLoading,
  } = useQuery({
    queryKey: ["book-version", versionId],
    queryFn: () => VersionService.getBookVersion(parseInt(versionId || "0")),
    enabled: !!versionId,
  });

  // Fetch page versions
  const {
    data: pageVersions,
    isLoading: pagesLoading,
  } = useQuery({
    queryKey: ["page-versions", versionId],
    queryFn: () => VersionService.getPageVersions(parseInt(versionId || "0")),
    enabled: !!versionId,
  });

  // Rollback mutation
  const rollbackMutation = useMutation({
    mutationFn: async () => {
      return await VersionService.rollbackToVersion(
        parseInt(bookId || "0"),
        parseInt(versionId || "0")
      );
    },
    onSuccess: () => {
      toast({
        title: "Rollback successful",
        description: "Your workspace has been restored to this version.",
      });

      // Invalidate queries
      queryClient.invalidateQueries({ queryKey: ["version-history"] });
      queryClient.invalidateQueries({ queryKey: ["uncommitted-changes"] });
      queryClient.invalidateQueries({ queryKey: ["books"] });
      queryClient.invalidateQueries({ queryKey: ["pages"] });

      // Navigate back to book details
      navigate(`/book/${bookId}`);
    },
    onError: (error: Error) => {
      toast({
        title: "Rollback failed",
        description: error.message || "Failed to rollback. Please try again.",
        variant: "destructive",
      });
    },
  });

  const isLoading = versionLoading || bookLoading || pagesLoading;

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (versionError || !version || !bookVersion) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Alert variant="destructive" className="max-w-md">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Version not found or you don't have permission to view it.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Preview Mode Banner */}
      <div className="bg-amber-100 dark:bg-amber-900/30 border-b border-amber-200 dark:border-amber-800">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Eye className="h-5 w-5 text-amber-700 dark:text-amber-300" />
              <div>
                <div className="font-semibold text-amber-900 dark:text-amber-100">
                  Preview Mode - Version {version.versionNumber}
                </div>
                <div className="text-sm text-amber-700 dark:text-amber-300">
                  Read-only view • {formatDistanceToNow(new Date(version.committedAt), { addSuffix: true })}
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate(`/book/${bookId}`)}
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Book
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={() => setShowRollbackDialog(true)}
                className="bg-orange-600 hover:bg-orange-700"
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                Rollback to This Version
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-6">
        <div className="max-w-7xl mx-auto space-y-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
            {/* Book Cover & Info */}
            <div className="col-span-full lg:col-span-1">
              <BookInfo
                name={bookVersion.name}
                subtitle={bookVersion.subtitle || undefined}
                coverUrl={bookVersion.cover_url || undefined}
                bookId={parseInt(bookId || "0")}
                author={bookVersion.author || undefined}
                showTextOnCover={bookVersion.show_text_on_cover ?? true}
              />

              {/* Version Info Card */}
              <Card className="mt-4">
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    Version Details
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div>
                    <div className="text-muted-foreground">Version</div>
                    <div className="font-mono font-semibold">
                      v{version.versionNumber}
                    </div>
                  </div>

                  <Separator />

                  <div>
                    <div className="text-muted-foreground">Committed</div>
                    <div>{format(new Date(version.committedAt), "PPp")}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(version.committedAt), {
                        addSuffix: true,
                      })}
                    </div>
                  </div>

                  {version.commitMessage && (
                    <>
                      <Separator />
                      <div>
                        <div className="text-muted-foreground mb-1">
                          Commit Message
                        </div>
                        <div className="text-sm whitespace-pre-wrap">
                          {version.commitMessage}
                        </div>
                      </div>
                    </>
                  )}

                  <Separator />

                  <div>
                    <div className="text-muted-foreground">Pages</div>
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4" />
                      {version.pageCount} page{version.pageCount !== 1 ? "s" : ""}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Pages List */}
            <div className="col-span-full lg:col-span-3">
              <div className="mb-6">
                <h1 className="text-3xl font-bold">{bookVersion.name}</h1>
                {bookVersion.author && (
                  <p className="text-muted-foreground">{bookVersion.author}</p>
                )}
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>Pages in This Version</CardTitle>
                </CardHeader>
                <CardContent>
                  {!pageVersions || pageVersions.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground">
                      <FileText className="h-12 w-12 mx-auto mb-3 opacity-50" />
                      No pages in this version
                    </div>
                  ) : (
                    <ScrollArea className="h-[600px] pr-4">
                      <div className="space-y-2">
                        {pageVersions.map((page, index) => (
                          <Link
                            key={page.id}
                            to={`/book/${bookId}/version/${versionId}/page/${page.page_index}`}
                            className="block"
                          >
                            <div className="flex items-center gap-3 p-3 rounded-lg border hover:bg-accent transition-colors">
                              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-medium">
                                {index + 1}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="font-medium truncate">
                                  {page.title}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {page.page_type || "text"}
                                </div>
                              </div>
                              <Badge variant="outline" className="flex-shrink-0">
                                Read-only
                              </Badge>
                            </div>
                          </Link>
                        ))}
                      </div>
                    </ScrollArea>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>

      {/* Rollback Confirmation Dialog */}
      <AlertDialog open={showRollbackDialog} onOpenChange={setShowRollbackDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rollback to version {version.versionNumber}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will restore your workspace to this version.
              <br />
              <br />
              <strong>Your current unsaved changes will be lost.</strong> A new commit
              will be created documenting this rollback.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={rollbackMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => rollbackMutation.mutate()}
              disabled={rollbackMutation.isPending}
              className="bg-orange-600 hover:bg-orange-700"
            >
              {rollbackMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Rolling back...
                </>
              ) : (
                <>
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Rollback
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default VersionPreview;
