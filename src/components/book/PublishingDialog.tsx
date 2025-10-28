/**
 * PublishingDialog Component
 *
 * Shows the publishing flow with automatic version creation if no commits exist.
 * Displays an intermediate screen to make users aware that a version is being saved.
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
import { useToast } from "@/hooks/use-toast";
import { Loader2, CheckCircle2, Globe, Lock } from "lucide-react";
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
  CREATING_VERSION = "creating_version",
  VERSION_CREATED = "version_created",
  PUBLISHING = "publishing",
  COMPLETED = "completed",
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
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Check if versions exist when dialog opens
  useEffect(() => {
    if (open && !isPublic) {
      checkAndCreateVersion();
    } else if (open && isPublic) {
      // Unpublishing - just do it directly
      setStep(PublishingStep.PUBLISHING);
      unpublishBook();
    }
  }, [open, isPublic]);

  const checkAndCreateVersion = async () => {
    try {
      setStep(PublishingStep.CHECKING);

      // Check if any versions exist
      const versions = await VersionService.getVersionHistory(bookId);

      if (versions.length === 0) {
        // No versions exist - create v1
        setStep(PublishingStep.CREATING_VERSION);
        await createFirstVersion();
      } else {
        // Versions exist - check if any is published
        const publishedVersion = versions.find(v => v.isPublished);

        if (publishedVersion) {
          // Already has a published version - just toggle is_public
          setStep(PublishingStep.PUBLISHING);
          await makeBookPublic();
        } else {
          // Has versions but none published - publish the latest
          setVersionId(versions[0].versionId);
          setStep(PublishingStep.CREATING_VERSION);
          await publishVersion(versions[0].versionId);
        }
      }
    } catch (error: any) {
      console.error("Error in checkAndCreateVersion:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to prepare for publishing",
        variant: "destructive",
      });
      onOpenChange(false);
    }
  };

  const createFirstVersion = async () => {
    try {
      const newVersionId = await VersionService.createCommit(
        bookId,
        "v1 - Initial version"
      );
      setVersionId(newVersionId);
      setStep(PublishingStep.VERSION_CREATED);

      // Wait a moment to show the version created message
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Now publish this version
      setStep(PublishingStep.CREATING_VERSION);
      await publishVersion(newVersionId);
    } catch (error: any) {
      console.error("Error creating first version:", error);
      throw error;
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

      // Wait a moment before closing
      await new Promise(resolve => setTimeout(resolve, 1000));

      onSuccess?.();
      onOpenChange(false);
    } catch (error: any) {
      console.error("Error making book public:", error);
      throw error;
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

      // Wait a moment before closing
      await new Promise(resolve => setTimeout(resolve, 800));

      onSuccess?.();
      onOpenChange(false);
    } catch (error: any) {
      console.error("Error unpublishing book:", error);
      toast({
        title: "Error unpublishing",
        description: error.message || "Failed to unpublish book",
        variant: "destructive",
      });
      onOpenChange(false);
    }
  };

  const getDialogContent = () => {
    if (isPublic) {
      // Unpublishing flow
      return {
        title: "Unpublishing Book",
        description: "Making your book private...",
        icon: <Lock className="h-6 w-6 text-muted-foreground" />,
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

      case PublishingStep.CREATING_VERSION:
        return {
          title: "Creating Version",
          description: versionId
            ? "Publishing version..."
            : "Creating v1 - Initial version...",
          icon: <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />,
        };

      case PublishingStep.VERSION_CREATED:
        return {
          title: "Version Created",
          description: "v1 has been saved successfully. Now publishing...",
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
      <DialogContent className="sm:max-w-[425px]" onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {content.icon}
            {content.title}
          </DialogTitle>
          <DialogDescription>{content.description}</DialogDescription>
        </DialogHeader>

        <div className="py-6">
          {step === PublishingStep.VERSION_CREATED && (
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertDescription>
                A version snapshot has been created and saved as <strong>v1</strong>.
                This ensures your book has a stable published version.
              </AlertDescription>
            </Alert>
          )}

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
        </div>

        {/* Only show close button when completed */}
        {step === PublishingStep.COMPLETED && (
          <DialogFooter>
            <Button onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
