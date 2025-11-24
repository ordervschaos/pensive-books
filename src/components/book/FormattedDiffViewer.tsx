/**
 * FormattedDiffViewer Component
 *
 * Side-by-side diff viewer that preserves TipTap formatting
 * Shows rich text content instead of plain text comparison
 */

import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileEdit, FilePlus, FileX } from "lucide-react";
import { type PageDiff } from "@/services/DiffService";
import { ScrollArea } from "@/components/ui/scroll-area";

interface FormattedDiffViewerProps {
  diff: PageDiff;
  compact?: boolean;
}

const getStatusIcon = (status: PageDiff["status"]) => {
  switch (status) {
    case "added":
      return <FilePlus className="h-4 w-4 text-green-600" />;
    case "deleted":
      return <FileX className="h-4 w-4 text-red-600" />;
    case "modified":
      return <FileEdit className="h-4 w-4 text-orange-600" />;
  }
};

const getStatusBadge = (status: PageDiff["status"]) => {
  switch (status) {
    case "added":
      return (
        <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
          Added
        </Badge>
      );
    case "deleted":
      return (
        <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
          Deleted
        </Badge>
      );
    case "modified":
      return (
        <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200">
          Modified
        </Badge>
      );
  }
};

function ReadOnlyTipTapViewer({ content }: { content: any }) {
  const editor = useEditor({
    extensions: [StarterKit],
    content: content,
    editable: false,
    editorProps: {
      attributes: {
        class: "prose prose-sm max-w-none focus:outline-none prose-foreground text-foreground",
      },
    },
  });

  return <EditorContent editor={editor} />;
}

function DiffBlockViewer({ block, type }: { block: any; type: "old" | "new" | "unchanged" }) {
  const editor = useEditor({
    extensions: [StarterKit],
    content: { type: "doc", content: [block] },
    editable: false,
    editorProps: {
      attributes: {
        class: "prose prose-sm max-w-none focus:outline-none prose-foreground text-foreground",
      },
    },
  });

  return <EditorContent editor={editor} />;
}

export function FormattedDiffViewer({ diff, compact = false }: FormattedDiffViewerProps) {
  const blockDiffs = diff.blockDiffs || [];
  const hasBlockDiffs = blockDiffs.length > 0;

  // Organize blocks for side-by-side display
  const oldBlocks = blockDiffs
    .filter(d => d.oldBlock)
    .map((d, idx) => ({ block: d.oldBlock, type: d.type, idx }));

  const newBlocks = blockDiffs
    .filter(d => d.newBlock)
    .map((d, idx) => ({ block: d.newBlock, type: d.type, idx }));

  return (
    <div className="space-y-4">
      {/* Header */}
      {!compact && (
        <div className="flex items-center gap-3 pb-3 border-b">
          {getStatusIcon(diff.status)}
          <h2 className="text-xl font-semibold text-foreground">{diff.title}</h2>
          {getStatusBadge(diff.status)}
        </div>
      )}

      {/* Side-by-side comparison with block-level highlighting */}
      <div className="grid grid-cols-2 gap-4">
        {/* Left: Committed version */}
        <div className="space-y-2">
          <div className="flex items-center justify-between px-3 py-2 bg-muted/50 rounded-t-lg border border-b-0">
            <span className="text-sm font-medium text-foreground">Committed</span>
            {diff.status === "modified" && (
              <Badge variant="outline" className="text-xs text-foreground/80">Before</Badge>
            )}
          </div>
          <Card className="rounded-t-none bg-card">
            <ScrollArea className="h-[600px]">
              <div className="p-4 space-y-2 text-foreground">
                {hasBlockDiffs ? (
                  blockDiffs.map((blockDiff, idx) => {
                    if (!blockDiff.oldBlock) return null;

                    const bgColor =
                      blockDiff.type === "removed" ? "bg-red-100 dark:bg-red-900/30 border-l-4 border-red-500" :
                      blockDiff.type === "modified" ? "bg-red-100 dark:bg-red-900/30 border-l-4 border-red-500" :
                      "";

                    return (
                      <div key={idx} className={`p-2 rounded ${bgColor} text-foreground`}>
                        <div className="prose prose-sm max-w-none prose-foreground dark:prose-invert">
                          <DiffBlockViewer block={blockDiff.oldBlock} type="old" />
                        </div>
                      </div>
                    );
                  })
                ) : diff.oldContentJson ? (
                  // Fallback to full content if no block diffs
                  <div className="text-foreground">
                    <ReadOnlyTipTapViewer content={diff.oldContentJson} />
                  </div>
                ) : (
                  <div className="text-foreground/70 italic text-sm">
                    (No previous version)
                  </div>
                )}
              </div>
            </ScrollArea>
          </Card>
        </div>

        {/* Right: Current version */}
        <div className="space-y-2">
          <div className="flex items-center justify-between px-3 py-2 bg-muted/50 rounded-t-lg border border-b-0">
            <span className="text-sm font-medium text-foreground">Current</span>
            {diff.status === "modified" && (
              <Badge variant="outline" className="text-xs text-foreground/80">After</Badge>
            )}
          </div>
          <Card className="rounded-t-none bg-card">
            <ScrollArea className="h-[600px]">
              <div className="p-4 space-y-2 text-foreground">
                {hasBlockDiffs ? (
                  blockDiffs.map((blockDiff, idx) => {
                    if (!blockDiff.newBlock) return null;

                    const bgColor =
                      blockDiff.type === "added" ? "bg-green-100 dark:bg-green-900/30 border-l-4 border-green-500" :
                      blockDiff.type === "modified" ? "bg-green-100 dark:bg-green-900/30 border-l-4 border-green-500" :
                      "";

                    return (
                      <div key={idx} className={`p-2 rounded ${bgColor} text-foreground`}>
                        <div className="prose prose-sm max-w-none prose-foreground dark:prose-invert">
                          <DiffBlockViewer block={blockDiff.newBlock} type="new" />
                        </div>
                      </div>
                    );
                  })
                ) : diff.newContentJson ? (
                  // Fallback to full content if no block diffs
                  <div className="text-foreground">
                    <ReadOnlyTipTapViewer content={diff.newContentJson} />
                  </div>
                ) : (
                  <div className="text-foreground/70 italic text-sm">
                    (No current version)
                  </div>
                )}
              </div>
            </ScrollArea>
          </Card>
        </div>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-4 text-sm text-foreground/80 pt-2 border-t">
        <div>
          <span className="font-medium text-foreground">Status:</span> {diff.status}
        </div>
        {diff.blockDiffs && (
          <>
            <div className="text-green-700 dark:text-green-400">
              <span className="font-medium">+{diff.blockDiffs.filter(d => d.type === "added").length}</span> added
            </div>
            <div className="text-red-700 dark:text-red-400">
              <span className="font-medium">-{diff.blockDiffs.filter(d => d.type === "removed").length}</span> removed
            </div>
            <div className="text-orange-700 dark:text-orange-400">
              <span className="font-medium">~{diff.blockDiffs.filter(d => d.type === "modified").length}</span> modified
            </div>
          </>
        )}
      </div>
    </div>
  );
}
