/**
 * CommitDialog Component
 *
 * Dialog for creating a new commit (version snapshot) of a book.
 * Allows user to enter a commit message and shows what will be committed.
 */

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { VersionService } from "@/services/VersionService";
import { useUncommittedChanges } from "@/hooks/use-uncommitted-changes";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, GitCommit, FileEdit, AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface CommitDialogProps {
  bookId: number;
  bookName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (versionId: number) => void;
}

export function CommitDialog({
  bookId,
  bookName,
  open,
  onOpenChange,
  onSuccess,
}: CommitDialogProps) {
  const [commitMessage, setCommitMessage] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { changedPages, hasChanges, isLoading: loadingChanges } =
    useUncommittedChanges(bookId, { enabled: open });

  const commitMutation = useMutation({
    mutationFn: async () => {
      return await VersionService.createCommit(
        bookId,
        commitMessage.trim() || undefined
      );
    },
    onSuccess: (versionId) => {
      toast({
        title: "Commit created",
        description: `Successfully created version snapshot with ${changedPages} page${
          changedPages !== 1 ? "s" : ""
        }.`,
      });

      // Invalidate queries to refresh UI
      queryClient.invalidateQueries({ queryKey: ["uncommitted-changes", bookId] });
      queryClient.invalidateQueries({ queryKey: ["version-history", bookId] });
      queryClient.invalidateQueries({ queryKey: ["books"] });

      // Reset form and close dialog
      setCommitMessage("");
      onOpenChange(false);

      // Call success callback if provided
      onSuccess?.(versionId);
    },
    onError: (error: Error) => {
      toast({
        title: "Commit failed",
        description: error.message || "Failed to create commit. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleCommit = () => {
    if (!hasChanges) {
      toast({
        title: "No changes to commit",
        description: "There are no uncommitted changes in this book.",
        variant: "destructive",
      });
      return;
    }

    commitMutation.mutate();
  };

  const handleClose = () => {
    if (!commitMutation.isPending) {
      setCommitMessage("");
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitCommit className="h-5 w-5" />
            Commit Changes
          </DialogTitle>
          <DialogDescription>
            Create a snapshot of "{bookName}" with all current changes.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Status Alert */}
          {loadingChanges ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Checking for changes...
            </div>
          ) : hasChanges ? (
            <Alert>
              <FileEdit className="h-4 w-4" />
              <AlertDescription>
                <strong>{changedPages}</strong> page{changedPages !== 1 ? "s" : ""}{" "}
                will be included in this commit.
              </AlertDescription>
            </Alert>
          ) : (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                No changes to commit. The workspace is up to date with the last
                commit.
              </AlertDescription>
            </Alert>
          )}

          {/* Commit Message Input */}
          <div className="space-y-2">
            <Label htmlFor="commit-message">
              Commit Message <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="commit-message"
              placeholder="Describe what changed in this version...

Examples:
- Added chapter 3 and revised introduction
- Fixed typos in chapter 2
- Restructured table of contents"
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              rows={6}
              disabled={commitMutation.isPending || !hasChanges}
              className="resize-none"
            />
            <p className="text-xs text-muted-foreground">
              A good commit message helps you identify changes later when browsing
              version history.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={handleClose}
            disabled={commitMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleCommit}
            disabled={commitMutation.isPending || !hasChanges || loadingChanges}
          >
            {commitMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating commit...
              </>
            ) : (
              <>
                <GitCommit className="mr-2 h-4 w-4" />
                Create Commit
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
