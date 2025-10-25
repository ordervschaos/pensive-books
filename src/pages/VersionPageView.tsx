/**
 * VersionPageView Page
 *
 * Read-only view of a single page within a historical version.
 * Similar to PageView but for version snapshots.
 *
 * URL: /book/:bookId/version/:versionId/page/:pageId
 */

import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { VersionService } from "@/services/VersionService";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  ArrowLeft,
  Eye,
  AlertCircle,
  Loader2,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
} from "lucide-react";
import { useState, useEffect } from "react";
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
import { EditorContent, useEditor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { Link as TiptapLink } from "@tiptap/extension-link";
import { Image } from "@tiptap/extension-image";
import { Table, TableRow, TableCell, TableHeader } from "@tiptap/extension-table";
import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { common, createLowlight } from "lowlight";

const lowlight = createLowlight(common);

const VersionPageView = () => {
  const { bookId, versionId, pageId } = useParams();
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

  // Fetch all page versions for this book version
  const {
    data: pageVersions,
    isLoading: pagesLoading,
  } = useQuery({
    queryKey: ["page-versions", versionId],
    queryFn: () => VersionService.getPageVersions(parseInt(versionId || "0")),
    enabled: !!versionId,
  });

  // Find current page and navigation using page_index
  const currentPage = pageVersions?.find((p) => p.page_index?.toString() === pageId);
  const currentIndex = pageVersions?.findIndex((p) => p.page_index?.toString() === pageId) ?? -1;
  const prevPage = currentIndex > 0 ? pageVersions?.[currentIndex - 1] : null;
  const nextPage = currentIndex < (pageVersions?.length ?? 0) - 1 ? pageVersions?.[currentIndex + 1] : null;

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

  // Initialize read-only TipTap editor
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        blockquote: {
          HTMLAttributes: {
            class: 'border-l-4 border-primary pl-4 my-4 italic',
          },
        },
        heading: {
          levels: [1, 2, 3, 4, 5, 6]
        },
        bulletList: {
          HTMLAttributes: {
            class: 'list-disc list-outside ml-4 my-4 space-y-1',
          },
        },
        orderedList: {
          HTMLAttributes: {
            class: 'list-decimal list-outside ml-4 my-4 space-y-1',
          },
        },
        code: {
          HTMLAttributes: {
            class: 'rounded-md bg-muted px-[0.3rem] py-[0.2rem] font-mono text-sm',
          },
        },
        codeBlock: false,
      }),
      CodeBlockLowlight.configure({
        lowlight,
        HTMLAttributes: {
          class: 'relative rounded-md bg-muted/50 my-4 p-4',
        },
      }),
      TiptapLink.configure({
        openOnClick: true,
        HTMLAttributes: {
          class: "text-blue-500 dark:text-blue-400 underline",
        },
      }),
      Image.configure({
        HTMLAttributes: {
          class: 'max-w-full h-auto rounded-lg mx-auto block',
        },
      }),
      Table.configure({
        resizable: true,
        HTMLAttributes: {
          class: 'border-collapse table-auto w-full my-4',
        },
      }),
      TableRow.configure({
        HTMLAttributes: {
          class: 'border-b border-muted',
        },
      }),
      TableHeader.configure({
        HTMLAttributes: {
          class: 'border-b-2 border-muted bg-muted/50 font-bold text-left p-2',
        },
      }),
      TableCell.configure({
        HTMLAttributes: {
          class: 'border border-muted p-2',
        },
      }),
    ],
    content: currentPage?.content || "",
    editable: false,
    editorProps: {
      attributes: {
        class: "prose prose-sm sm:prose lg:prose-lg xl:prose-xl max-w-none focus:outline-none",
      },
    },
  });

  // Update editor content when page changes
  useEffect(() => {
    if (editor && currentPage?.content) {
      editor.commands.setContent(currentPage.content);
    }
  }, [editor, currentPage?.content, pageId]);

  const isLoading = versionLoading || pagesLoading;

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (versionError || !version || !currentPage) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Alert variant="destructive" className="max-w-md">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Page not found in this version or you don't have permission to view it.
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
                  Read-only view of historical page
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate(`/book/${bookId}/version/${versionId}`)}
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Version
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
      <div className="flex-1 container max-w-4xl mx-auto px-4 py-6">
        {/* Page Header */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-2">
            <Link
              to={`/book/${bookId}/version/${versionId}`}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              {version.bookName}
            </Link>
            <span className="text-muted-foreground">/</span>
            <Badge variant="outline">Version {version.versionNumber}</Badge>
          </div>
          <h1 className="text-3xl font-bold">{currentPage.title}</h1>
          <div className="flex items-center gap-2 mt-2">
            <Badge variant="secondary" className="bg-amber-100 text-amber-900">
              <Eye className="mr-1 h-3 w-3" />
              Read-only
            </Badge>
            {pageVersions && (
              <span className="text-sm text-muted-foreground">
                Page {currentIndex + 1} of {pageVersions.length}
              </span>
            )}
          </div>
        </div>

        {/* Page Content */}
        <div className="bg-card rounded-lg border p-6 mb-6">
          {editor && <EditorContent editor={editor} />}
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between border-t pt-4">
          {prevPage ? (
            <Button
              variant="outline"
              onClick={() =>
                navigate(`/book/${bookId}/version/${versionId}/page/${prevPage.page_index}`)
              }
            >
              <ChevronLeft className="mr-2 h-4 w-4" />
              {prevPage.title}
            </Button>
          ) : (
            <div />
          )}

          {nextPage ? (
            <Button
              variant="outline"
              onClick={() =>
                navigate(`/book/${bookId}/version/${versionId}/page/${nextPage.page_index}`)
              }
            >
              {nextPage.title}
              <ChevronRight className="ml-2 h-4 w-4" />
            </Button>
          ) : (
            <div />
          )}
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

export default VersionPageView;
