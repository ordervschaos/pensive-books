/**
 * PublishingDialog Component
 *
 * Shows the publishing flow with three scenarios:
 * 1. No commits exist: Ask user to create one (with optional message)
 * 2. Commits exist with no unsaved changes: Publish directly
 * 3. Commits exist with unsaved changes: Let user choose to publish last committed or commit changes first
 */

import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { VersionService } from "@/services/VersionService";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, CheckCircle2, Globe, Lock, AlertTriangle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface PublishingDialogProps {
  bookId: number;
  bookName: string;
  isPublic: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

enum PublishingStep {
  CHECKING = "checking",
  AWAITING_FIRST_COMMIT = "awaiting_first_commit",
  AWAITING_CHOICE = "awaiting_choice",
  CREATING_VERSION = "creating_version",
  VERSION_CREATED = "version_created",
  PUBLISHING = "publishing",
  COMPLETED = "completed",
  ERROR = "error",
}

export function PublishingDialog({
  bookId,
  bookName,
  isPublic,
  open,
  onOpenChange,
  onSuccess,
}: PublishingDialogProps) {
  const [step, setStep] = useState<PublishingStep>(PublishingStep.CHECKING);
  const [versionId, setVersionId] = useState<number | null>(null);
  const [commitMessage, setCommitMessage] = useState("");
  const [uncommittedChangesCount, setUncommittedChangesCount] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setStep(PublishingStep.CHECKING);
      setCommitMessage("");
      setVersionId(null);
      setUncommittedChangesCount(0);
      setErrorMessage(null);
    }
  }, [open]);

  // Check if versions exist when dialog opens
  useEffect(() => {
    if (open && !isPublic) {
      checkPublishingStatus();
    } else if (open && isPublic) {
      // Unpublishing - just do it directly
      setStep(PublishingStep.PUBLISHING);
      unpublishBook();
    }
  }, [open, isPublic]);

  const checkPublishingStatus = async () => {
    try {
      setStep(PublishingStep.CHECKING);

      // Small delay to ensure any recent commits have been fully processed
      // This prevents race conditions when publishing immediately after committing
      await new Promise(resolve => setTimeout(resolve, 300));

      // Invalidate and refetch to ensure we have the latest data
      await queryClient.invalidateQueries({ queryKey: ["uncommitted-changes", bookId] });
      await queryClient.invalidateQueries({ queryKey: ["version-history", bookId] });

      // Check if any versions exist
      const versions = await VersionService.getVersionHistory(bookId);
      const uncommittedChanges = await VersionService.getUncommittedChanges(bookId);

      console.log('Publishing status check:', {
        versionsCount: versions.length,
        hasUncommittedChanges: uncommittedChanges.hasChanges,
        uncommittedPagesCount: uncommittedChanges.changedPages,
        versions: versions.map(v => ({ id: v.versionId, number: v.versionNumber, isPublished: v.isPublished }))
      });

      setUncommittedChangesCount(uncommittedChanges.changedPages);

      if (versions.length === 0) {
        // No commits exist - ask user to create first commit
        console.log('No versions found - showing first commit screen');
        setStep(PublishingStep.AWAITING_FIRST_COMMIT);
      } else {
        // Commits exist - check if there are uncommitted changes
        if (uncommittedChanges.hasChanges) {
          // Has uncommitted changes - let user choose
          console.log('Has uncommitted changes - showing choice screen');
          setStep(PublishingStep.AWAITING_CHOICE);
          setVersionId(versions[0].versionId); // Latest version
        } else {
          // No uncommitted changes - check if published version exists
          const publishedVersion = versions.find(v => v.isPublished);

          if (publishedVersion) {
            // Already has a published version - just toggle is_public
            console.log('Already has published version - making book public');
            setStep(PublishingStep.PUBLISHING);
            await makeBookPublic();
          } else {
            // Has versions but none published - publish the latest
            console.log('Has versions but none published - publishing latest');
            setVersionId(versions[0].versionId);
            setStep(PublishingStep.CREATING_VERSION);
            await publishVersion(versions[0].versionId);
          }
        }
      }
    } catch (error: any) {
      console.error("Error in checkPublishingStatus:", error);
      setErrorMessage(error.message || "Failed to prepare for publishing");
      setStep(PublishingStep.ERROR);
    }
  };

  // Handler for when user clicks "Create & Publish" for first commit
  const handleCreateFirstCommit = async () => {
    try {
      setStep(PublishingStep.CREATING_VERSION);

      const message = commitMessage.trim() || "v1 - Initial version";
      const newVersionId = await VersionService.createCommit(bookId, message);
      setVersionId(newVersionId);

      setStep(PublishingStep.VERSION_CREATED);

      // Wait a moment to show the version created message
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Now publish this version
      setStep(PublishingStep.CREATING_VERSION);
      await publishVersion(newVersionId);
    } catch (error: any) {
      console.error("Error creating first version:", error);
      setErrorMessage(error.message || "Failed to create first commit");
      setStep(PublishingStep.ERROR);
    }
  };

  // Handler for when user chooses to publish last committed version
  const handlePublishLastCommitted = async () => {
    try {
      if (!versionId) {
        throw new Error("No version ID available");
      }

      setStep(PublishingStep.CREATING_VERSION);
      await publishVersion(versionId);
    } catch (error: any) {
      console.error("Error publishing last committed version:", error);
      setErrorMessage(error.message || "Failed to publish");
      setStep(PublishingStep.ERROR);
    }
  };

  // Handler for when user chooses to commit changes first then publish
  const handleCommitAndPublish = async () => {
    try {
      setStep(PublishingStep.CREATING_VERSION);

      const message = commitMessage.trim() || `Update with ${uncommittedChangesCount} page${uncommittedChangesCount === 1 ? '' : 's'}`;
      const newVersionId = await VersionService.createCommit(bookId, message);
      setVersionId(newVersionId);

      setStep(PublishingStep.VERSION_CREATED);

      // Wait a moment to show the version created message
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Now publish this new version
      setStep(PublishingStep.CREATING_VERSION);
      await publishVersion(newVersionId);
    } catch (error: any) {
      console.error("Error committing and publishing:", error);
      setErrorMessage(error.message || "Failed to commit and publish");
      setStep(PublishingStep.ERROR);
    }
  };

  const publishVersion = async (versionIdToPublish: number) => {
    try {
      await VersionService.publishVersion(bookId, versionIdToPublish);
      setStep(PublishingStep.PUBLISHING);
      await makeBookPublic();
    } catch (error: any) {
      console.error("Error publishing version:", error);
      throw error;
    }
  };

  const makeBookPublic = async () => {
    try {
      const { error } = await supabase
        .from("books")
        .update({
          is_public: true,
          published_at: new Date().toISOString(),
        })
        .eq("id", bookId);

      if (error) throw error;

      setStep(PublishingStep.COMPLETED);

      // Invalidate queries
      queryClient.invalidateQueries({ queryKey: ["books", bookId] });
      queryClient.invalidateQueries({ queryKey: ["books"] });
      queryClient.invalidateQueries({ queryKey: ["version-history", bookId] });

      toast({
        title: "Book published",
        description: "Your book is now public and visible to everyone.",
      });

      onSuccess?.();
      // Don't auto-close - let user close the dialog
    } catch (error: any) {
      console.error("Error making book public:", error);
      setErrorMessage(error.message || "Failed to make book public");
      setStep(PublishingStep.ERROR);
    }
  };

  const unpublishBook = async () => {
    try {
      const { error } = await supabase
        .from("books")
        .update({
          is_public: false,
        })
        .eq("id", bookId);

      if (error) throw error;

      setStep(PublishingStep.COMPLETED);

      // Invalidate queries
      queryClient.invalidateQueries({ queryKey: ["books", bookId] });
      queryClient.invalidateQueries({ queryKey: ["books"] });

      toast({
        title: "Book unpublished",
        description: "Your book is now private.",
      });

      onSuccess?.();
      // Don't auto-close - let user close the dialog
    } catch (error: any) {
      console.error("Error unpublishing book:", error);
      setErrorMessage(error.message || "Failed to unpublish book");
      setStep(PublishingStep.ERROR);
    }
  };

  const getDialogContent = () => {
    if (isPublic) {
      // Unpublishing flow
      if (step === PublishingStep.COMPLETED) {
        return {
          title: "Book Unpublished",
          description: "Your book is now private.",
          icon: <CheckCircle2 className="h-6 w-6 text-green-500" />,
        };
      }
      return {
        title: "Unpublishing Book",
        description: "Making your book private...",
        icon: <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />,
      };
    }

    // Publishing flow
    switch (step) {
      case PublishingStep.CHECKING:
        return {
          title: "Preparing to Publish",
          description: "Checking version history...",
          icon: <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />,
        };

      case PublishingStep.AWAITING_FIRST_COMMIT:
        return {
          title: "Create First Version",
          description: "No commits exist yet. Create your first version to publish.",
          icon: <AlertTriangle className="h-6 w-6 text-amber-500" />,
        };

      case PublishingStep.AWAITING_CHOICE:
        return {
          title: "Uncommitted Changes",
          description: `You have ${uncommittedChangesCount} page${uncommittedChangesCount === 1 ? '' : 's'} with uncommitted changes.`,
          icon: <AlertTriangle className="h-6 w-6 text-amber-500" />,
        };

      case PublishingStep.CREATING_VERSION:
        return {
          title: "Creating Version",
          description: versionId
            ? "Publishing version..."
            : "Creating version...",
          icon: <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />,
        };

      case PublishingStep.VERSION_CREATED:
        return {
          title: "Version Created",
          description: "Version saved successfully. Now publishing...",
          icon: <CheckCircle2 className="h-6 w-6 text-green-500" />,
        };

      case PublishingStep.PUBLISHING:
        return {
          title: "Publishing Book",
          description: "Making your book public...",
          icon: <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />,
        };

      case PublishingStep.COMPLETED:
        return {
          title: "Published",
          description: "Your book is now live!",
          icon: <CheckCircle2 className="h-6 w-6 text-green-500" />,
        };

      case PublishingStep.ERROR:
        return {
          title: "Error",
          description: errorMessage || "An error occurred",
          icon: <AlertTriangle className="h-6 w-6 text-red-500" />,
        };

      default:
        return {
          title: "Publishing",
          description: "Please wait...",
          icon: <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />,
        };
    }
  };

  const content = getDialogContent();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]" onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {content.icon}
            {content.title}
          </DialogTitle>
          <DialogDescription>{content.description}</DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-4">
          {/* Awaiting First Commit - Ask user for commit message and confirmation */}
          {step === PublishingStep.AWAITING_FIRST_COMMIT && (
            <>
              <Alert>
                <AlertDescription>
                  Before publishing, you need to create your first version. This creates a snapshot
                  of your book that will be published.
                </AlertDescription>
              </Alert>
              <div className="space-y-2">
                <Label htmlFor="commit-message">Commit Message (optional)</Label>
                <Input
                  id="commit-message"
                  placeholder="e.g., Initial version"
                  value={commitMessage}
                  onChange={(e) => setCommitMessage(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleCreateFirstCommit();
                    }
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  Default: "v1 - Initial version"
                </p>
              </div>
            </>
          )}

          {/* Awaiting Choice - User has uncommitted changes */}
          {step === PublishingStep.AWAITING_CHOICE && (
            <>
              <Alert variant="default">
                <AlertDescription>
                  Choose whether to publish the last committed version or commit your current changes first.
                </AlertDescription>
              </Alert>
              <div className="space-y-3">
                <div className="p-3 border rounded-lg space-y-2">
                  <h4 className="font-medium text-sm">Option 1: Publish Last Committed Version</h4>
                  <p className="text-xs text-muted-foreground">
                    Publish the book as it was in the last commit. Your current changes won't be included.
                  </p>
                </div>
                <div className="p-3 border rounded-lg space-y-2">
                  <h4 className="font-medium text-sm">Option 2: Commit Changes & Publish</h4>
                  <p className="text-xs text-muted-foreground">
                    Create a new commit with your current changes and then publish that version.
                  </p>
                  <div className="space-y-2 pt-2">
                    <Label htmlFor="commit-message-choice">Commit Message (optional)</Label>
                    <Input
                      id="commit-message-choice"
                      placeholder="Describe your changes..."
                      value={commitMessage}
                      onChange={(e) => setCommitMessage(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleCommitAndPublish();
                        }
                      }}
                    />
                    <p className="text-xs text-muted-foreground">
                      Default: "Update with {uncommittedChangesCount} page{uncommittedChangesCount === 1 ? '' : 's'}"
                    </p>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Version Created */}
          {step === PublishingStep.VERSION_CREATED && (
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertDescription>
                Version snapshot created successfully. Publishing now...
              </AlertDescription>
            </Alert>
          )}

          {/* Completed */}
          {step === PublishingStep.COMPLETED && !isPublic && (
            <Alert>
              <Globe className="h-4 w-4" />
              <AlertDescription>
                <strong>"{bookName}"</strong> is now visible to everyone on the web.
              </AlertDescription>
            </Alert>
          )}

          {step === PublishingStep.COMPLETED && isPublic && (
            <Alert>
              <Lock className="h-4 w-4" />
              <AlertDescription>
                <strong>"{bookName}"</strong> is now private.
              </AlertDescription>
            </Alert>
          )}

          {/* Error State */}
          {step === PublishingStep.ERROR && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                {errorMessage}
              </AlertDescription>
            </Alert>
          )}
        </div>

        {/* Footer Buttons */}
        <DialogFooter className="flex-col sm:flex-row gap-2">
          {step === PublishingStep.AWAITING_FIRST_COMMIT && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreateFirstCommit}>
                Create & Publish
              </Button>
            </>
          )}

          {step === PublishingStep.AWAITING_CHOICE && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button variant="secondary" onClick={handlePublishLastCommitted}>
                Publish Last Committed
              </Button>
              <Button onClick={handleCommitAndPublish}>
                Commit & Publish
              </Button>
            </>
          )}

          {(step === PublishingStep.COMPLETED || step === PublishingStep.ERROR) && (
            <Button onClick={() => onOpenChange(false)}>
              Close
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
