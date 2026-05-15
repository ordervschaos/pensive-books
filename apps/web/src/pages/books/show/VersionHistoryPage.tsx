/**
 * VersionHistoryPage
 *
 * Full-page view for managing book versions
 * Similar to DraftChanges but for version history
 */

import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { VersionService, type VersionHistoryItem } from "@/services/VersionService";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  GitCommit,
  Clock,
  FileText,
  Loader2,
  Eye,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  Globe,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
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
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function VersionHistoryPage() {
  const { bookSlug } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [versionToRollback, setVersionToRollback] = useState<number | null>(null);
  const [versionToPublish, setVersionToPublish] = useState<number | null>(null);

  // Extract numeric ID from slug
  const getNumericId = (param: string | undefined) => {
    if (!param) return 0;
    const match = param.match(/^(\d+)/);
    return match ? parseInt(match[1]) : 0;
  };

  const bookId = getNumericId(bookSlug);

  // Fetch book name
  const { data: book } = useQuery({
    queryKey: ["book", bookId],
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

  // Fetch version history
  const {
    data: versions,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["version-history", bookId],
    queryFn: () => VersionService.getVersionHistory(bookId),
    enabled: bookId > 0,
  });

  // Rollback version mutation
  const rollbackMutation = useMutation({
    mutationFn: async (versionId: number) => {
      return await VersionService.rollbackToVersion(bookId, versionId);
    },
    onSuccess: (newVersionId) => {
      toast({
        title: "Rollback successful",
        description: "Workspace has been restored to the selected version. A new commit has been created.",
      });

      // Invalidate queries to refresh UI
      queryClient.invalidateQueries({ queryKey: ["version-history", bookId] });
      queryClient.invalidateQueries({ queryKey: ["uncommitted-changes", bookId] });
      queryClient.invalidateQueries({ queryKey: ["books", bookId] });
      queryClient.invalidateQueries({ queryKey: ["books"] });
      queryClient.invalidateQueries({ queryKey: ["pages"] });

      setVersionToRollback(null);
      // Navigate back to book details
      navigate(`/books/${bookSlug}`);
    },
    onError: (error: Error) => {
      toast({
        title: "Rollback failed",
        description: error.message || "Failed to rollback. Please try again.",
        variant: "destructive",
      });
      setVersionToRollback(null);
    },
  });

  // Publish version mutation
  const publishMutation = useMutation({
    mutationFn: async (versionId: number) => {
      return await VersionService.publishVersion(bookId, versionId);
    },
    onSuccess: () => {
      toast({
        title: "Version published",
        description: "This version is now the published version visible to the public.",
      });

      // Invalidate queries to refresh UI
      queryClient.invalidateQueries({ queryKey: ["version-history", bookId] });
      queryClient.invalidateQueries({ queryKey: ["books", bookId] });
      queryClient.invalidateQueries({ queryKey: ["books"] });

      setVersionToPublish(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Publish failed",
        description: error.message || "Failed to publish version. Please try again.",
        variant: "destructive",
      });
      setVersionToPublish(null);
    },
  });

  const handleRollbackClick = (versionId: number) => {
    setVersionToRollback(versionId);
  };

  const handleRollbackConfirm = () => {
    if (versionToRollback) {
      rollbackMutation.mutate(versionToRollback);
    }
  };

  const handlePublishClick = (versionId: number) => {
    setVersionToPublish(versionId);
  };

  const handlePublishConfirm = () => {
    if (versionToPublish) {
      publishMutation.mutate(versionToPublish);
    }
  };

  const handlePreview = (versionId: number) => {
    navigate(`/books/${bookSlug}/version/${versionId}`);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background">
        <div className="container mx-auto px-4 py-6">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Failed to load version history. Please try again.
            </AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

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
                  {versions?.length || 0} version{(versions?.length || 0) !== 1 ? "s" : ""}
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
        {!versions || versions.length === 0 ? (
          <div className="flex items-center justify-center h-96">
            <Alert>
              <GitCommit className="h-4 w-4" />
              <AlertDescription>
                No versions yet. Create your first commit to start tracking changes.
              </AlertDescription>
            </Alert>
          </div>
        ) : (
          <ScrollArea className="h-[calc(100vh-200px)]">
            <div className="space-y-4 pr-4">
              {versions.map((version, index) => (
                <VersionItem
                  key={version.versionId}
                  version={version}
                  isLatest={index === 0}
                  allowRollback={index !== 0}
                  onPreview={() => handlePreview(version.versionId)}
                  onRollback={() => handleRollbackClick(version.versionId)}
                  onPublish={() => handlePublishClick(version.versionId)}
                  isRollingBack={
                    rollbackMutation.isPending &&
                    versionToRollback === version.versionId
                  }
                  isPublishing={
                    publishMutation.isPending &&
                    versionToPublish === version.versionId
                  }
                />
              ))}
            </div>
          </ScrollArea>
        )}
      </div>

      {/* Rollback Confirmation Dialog */}
      <AlertDialog
        open={versionToRollback !== null}
        onOpenChange={(open) => !open && setVersionToRollback(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rollback to this version?</AlertDialogTitle>
            <AlertDialogDescription>
              This will restore your workspace to version{" "}
              {versions?.find((v) => v.versionId === versionToRollback)?.versionNumber}.
              <br />
              <br />
              <strong>Your current unsaved changes will be lost.</strong> A new commit will be
              created documenting this rollback.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={rollbackMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRollbackConfirm}
              disabled={rollbackMutation.isPending}
              className="bg-orange-600 hover:bg-orange-700"
            >
              {rollbackMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Rolling back...
                </>
              ) : (
                "Rollback"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Publish Confirmation Dialog */}
      <AlertDialog
        open={versionToPublish !== null}
        onOpenChange={(open) => !open && setVersionToPublish(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Publish this version?</AlertDialogTitle>
            <AlertDialogDescription>
              This will make version{" "}
              {versions?.find((v) => v.versionId === versionToPublish)?.versionNumber} the
              published version visible to the public (if the book is set to public).
              <br />
              <br />
              Any previously published version will be unpublished.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={publishMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handlePublishConfirm}
              disabled={publishMutation.isPending}
              className="bg-green-600 hover:bg-green-700"
            >
              {publishMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Publishing...
                </>
              ) : (
                "Publish"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

interface VersionItemProps {
  version: VersionHistoryItem;
  isLatest: boolean;
  allowRollback: boolean;
  onPreview: () => void;
  onRollback: () => void;
  onPublish: () => void;
  isRollingBack: boolean;
  isPublishing: boolean;
}

function VersionItem({
  version,
  isLatest,
  allowRollback,
  onPreview,
  onRollback,
  onPublish,
  isRollingBack,
  isPublishing,
}: VersionItemProps) {
  return (
    <div className="relative border rounded-lg p-4 bg-card">
      <div className="flex items-start gap-4">
        {/* Timeline dot */}
        <div className="mt-1 flex flex-col items-center">
          <div
            className={`h-3 w-3 rounded-full border-2 ${
              isLatest
                ? "border-primary bg-primary"
                : "border-muted-foreground bg-background"
            }`}
          />
          {!isLatest && (
            <div className="h-full w-0.5 bg-border my-1" style={{ minHeight: "40px" }} />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-medium">
                v{version.versionNumber}
              </span>
              {isLatest && (
                <Badge variant="default" className="text-xs">
                  <CheckCircle2 className="mr-1 h-3 w-3" />
                  Current
                </Badge>
              )}
              {version.isPublished && (
                <Badge variant="secondary" className="text-xs bg-green-100 text-green-800">
                  <Globe className="mr-1 h-3 w-3" />
                  Published
                </Badge>
              )}
            </div>

            <div className="flex gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={onPreview}
              >
                <Eye className="mr-2 h-3 w-3" />
                Preview
              </Button>

              {!version.isPublished && (
                <Button
                  size="sm"
                  variant="default"
                  onClick={onPublish}
                  disabled={isPublishing}
                  className="bg-green-600 hover:bg-green-700"
                >
                  {isPublishing ? (
                    <>
                      <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                      Publishing...
                    </>
                  ) : (
                    <>
                      <Globe className="mr-2 h-3 w-3" />
                      Publish
                    </>
                  )}
                </Button>
              )}

              {allowRollback && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onRollback}
                  disabled={isRollingBack}
                >
                  {isRollingBack ? (
                    <>
                      <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                      Rolling back...
                    </>
                  ) : (
                    <>
                      <RotateCcw className="mr-2 h-3 w-3" />
                      Rollback
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>

          <div className="text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <Clock className="h-3.5 w-3.5" />
              {formatDistanceToNow(new Date(version.committedAt), {
                addSuffix: true,
              })}{" "}
              • {format(new Date(version.committedAt), "PPp")}
            </div>
            {version.committerEmail && (
              <div className="mt-1">by {version.committerEmail}</div>
            )}
          </div>

          {version.commitMessage && (
            <p className="text-sm whitespace-pre-wrap">{version.commitMessage}</p>
          )}

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <FileText className="h-3 w-3" />
            {version.pageCount} page{version.pageCount !== 1 ? "s" : ""}
          </div>
        </div>
      </div>
    </div>
  );
}

