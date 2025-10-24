/**
 * VersionHistory Component
 *
 * Displays a timeline of all commits (versions) for a book.
 * Allows viewing, comparing, and publishing versions.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { VersionService, type VersionHistoryItem } from "@/services/VersionService";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import {
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
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { useState } from "react";

interface VersionHistoryProps {
  bookId: number;
  bookName: string;
  /** Allow rollback operations */
  allowRollback?: boolean;
  /** Callback when user wants to preview a version */
  onPreview?: (versionId: number) => void;
}

export function VersionHistory({
  bookId,
  bookName,
  allowRollback = true,
  onPreview,
}: VersionHistoryProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [versionToRollback, setVersionToRollback] = useState<number | null>(null);
  const [versionToPublish, setVersionToPublish] = useState<number | null>(null);

  // Fetch version history
  const {
    data: versions,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["version-history", bookId],
    queryFn: () => VersionService.getVersionHistory(bookId),
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          Failed to load version history. Please try again.
        </AlertDescription>
      </Alert>
    );
  }

  if (!versions || versions.length === 0) {
    return (
      <Alert>
        <GitCommit className="h-4 w-4" />
        <AlertDescription>
          No versions yet. Create your first commit to start tracking changes.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Version History
          </CardTitle>
          <CardDescription>
            {versions.length} version{versions.length !== 1 ? "s" : ""} of "{bookName}"
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[500px] pr-4">
            <div className="space-y-4">
              {versions.map((version, index) => (
                <VersionItem
                  key={version.versionId}
                  version={version}
                  isLatest={index === 0}
                  allowRollback={allowRollback && index !== 0}
                  onPreview={() => onPreview?.(version.versionId)}
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
        </CardContent>
      </Card>

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
    </>
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
    <div className="relative">
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
        <div className="flex-1 space-y-2 pb-4">
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
