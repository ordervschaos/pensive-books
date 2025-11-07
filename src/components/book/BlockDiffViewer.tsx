/**
 * BlockDiffViewer Component
 *
 * Displays block-by-block diffs for TipTap content
 * Shows added, removed, and modified blocks separately
 */

import { BlockDiff } from "@/services/DiffService";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FilePlus, FileX, FileEdit, FileText } from "lucide-react";

interface BlockDiffViewerProps {
  blockDiffs: BlockDiff[];
  compact?: boolean;
}

const getBlockTypeLabel = (blockType: string): string => {
  switch (blockType) {
    case "heading":
      return "Heading";
    case "paragraph":
      return "Paragraph";
    case "bulletList":
      return "Bullet List";
    case "orderedList":
      return "Numbered List";
    case "codeBlock":
      return "Code Block";
    case "blockquote":
      return "Quote";
    default:
      return blockType;
  }
};

const getChangeIcon = (type: BlockDiff["type"]) => {
  switch (type) {
    case "added":
      return <FilePlus className="h-4 w-4 text-green-600" />;
    case "removed":
      return <FileX className="h-4 w-4 text-red-600" />;
    case "modified":
      return <FileEdit className="h-4 w-4 text-orange-600" />;
    default:
      return <FileText className="h-4 w-4 text-muted-foreground" />;
  }
};

const getChangeBadge = (type: BlockDiff["type"]) => {
  switch (type) {
    case "added":
      return (
        <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 text-xs">
          Added
        </Badge>
      );
    case "removed":
      return (
        <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 text-xs">
          Removed
        </Badge>
      );
    case "modified":
      return (
        <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200 text-xs">
          Modified
        </Badge>
      );
    default:
      return null;
  }
};

export function BlockDiffViewer({ blockDiffs, compact = false }: BlockDiffViewerProps) {
  if (!blockDiffs || blockDiffs.length === 0) {
    return (
      <div className="text-sm text-muted-foreground text-center py-4">
        No changes detected in this page
      </div>
    );
  }

  return (
    <div className={compact ? "space-y-3" : "space-y-4"}>
      {blockDiffs.map((diff, index) => (
        <Card
          key={index}
          className={`p-3 ${
            diff.type === "added"
              ? "bg-green-50/50 border-green-200"
              : diff.type === "removed"
              ? "bg-red-50/50 border-red-200"
              : "bg-orange-50/50 border-orange-200"
          }`}
        >
          {/* Header */}
          <div className="flex items-center gap-2 mb-2">
            {getChangeIcon(diff.type)}
            <span className="text-xs font-medium text-muted-foreground">
              {getBlockTypeLabel(diff.blockType)}
            </span>
            {getChangeBadge(diff.type)}
          </div>

          {/* Content */}
          <div className="space-y-2">
            {/* Removed/Old Content */}
            {(diff.type === "removed" || diff.type === "modified") && (
              <div className="bg-red-100/50 border border-red-200 rounded px-3 py-2">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-medium text-red-700">Before</span>
                </div>
                <div className="text-sm text-red-900 whitespace-pre-wrap break-words">
                  {diff.oldContent || <span className="italic text-red-600/60">(empty)</span>}
                </div>
              </div>
            )}

            {/* Added/New Content */}
            {(diff.type === "added" || diff.type === "modified") && (
              <div className="bg-green-100/50 border border-green-200 rounded px-3 py-2">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-medium text-green-700">After</span>
                </div>
                <div className="text-sm text-green-900 whitespace-pre-wrap break-words">
                  {diff.newContent || <span className="italic text-green-600/60">(empty)</span>}
                </div>
              </div>
            )}
          </div>
        </Card>
      ))}

      {/* Summary */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground pt-2 border-t">
        <div>
          <span className="font-medium">Total changes:</span> {blockDiffs.length}
        </div>
        <div className="text-green-600">
          <span className="font-medium">+{blockDiffs.filter((d) => d.type === "added").length}</span> added
        </div>
        <div className="text-red-600">
          <span className="font-medium">-{blockDiffs.filter((d) => d.type === "removed").length}</span> removed
        </div>
        <div className="text-orange-600">
          <span className="font-medium">~{blockDiffs.filter((d) => d.type === "modified").length}</span> modified
        </div>
      </div>
    </div>
  );
}
