/**
 * FormattedDiffViewer Component
 *
 * Side-by-side diff viewer that preserves TipTap formatting
 * Shows rich text content instead of plain text comparison
 */

import { useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileEdit, FilePlus, FileX, ChevronDown, ChevronUp, MoreHorizontal, GitCompare, FileText, ExternalLink } from "lucide-react";
import { type PageDiff } from "@/services/DiffService";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Link } from "react-router-dom";

interface FormattedDiffViewerProps {
  diff: PageDiff;
  compact?: boolean;
  bookSlug?: string;  // Book slug for generating version link
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

export function FormattedDiffViewer({ diff, compact = false, bookSlug }: FormattedDiffViewerProps) {
  const blockDiffs = diff.blockDiffs || [];
  const hasBlockDiffs = blockDiffs.length > 0;
  const [expandedContext, setExpandedContext] = useState<Set<number>>(new Set());
  const [viewMode, setViewMode] = useState<"diff" | "full-old">("diff");
  
  // Only allow full old view if there's an old version
  const canViewOldVersion = diff.oldContentJson && diff.status !== "added";
  
  // Generate link to committed version
  const versionLink = bookSlug && diff.versionId !== undefined && diff.versionPageIndex !== undefined
    ? `/books/${bookSlug}/versions/${diff.versionId}/pages/${diff.versionPageIndex}`
    : null;

  // Toggle context expansion
  const toggleContext = (index: number) => {
    const newExpanded = new Set(expandedContext);
    if (newExpanded.has(index)) {
      newExpanded.delete(index);
    } else {
      newExpanded.add(index);
    }
    setExpandedContext(newExpanded);
  };

  // Check if a context block should be shown (expanded or if it's near a change)
  const shouldShowContext = (index: number, type: string): boolean => {
    if (type !== "unchanged") return true;
    
    // Show context if expanded
    if (expandedContext.has(index)) return true;
    
    // Show context if it's adjacent to a change
    const prevIsChange = index > 0 && blockDiffs[index - 1]?.type !== "unchanged";
    const nextIsChange = index < blockDiffs.length - 1 && blockDiffs[index + 1]?.type !== "unchanged";
    
    return prevIsChange || nextIsChange;
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      {!compact && (
        <div className="flex items-center justify-between pb-3 border-b">
          <div className="flex items-center gap-3">
            {getStatusIcon(diff.status)}
            <h2 className="text-xl font-semibold text-foreground">{diff.title}</h2>
            {getStatusBadge(diff.status)}
          </div>
          
          <div className="flex items-center gap-3">
            {/* View Mode Toggle */}
            {canViewOldVersion && (
              <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as "diff" | "full-old")}>
                <TabsList>
                  <TabsTrigger value="diff" className="flex items-center gap-2">
                    <GitCompare className="h-4 w-4" />
                    <span>Diff</span>
                  </TabsTrigger>
                  <TabsTrigger value="full-old" className="flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    <span>Old Version</span>
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            )}
            
            {/* Link to Committed Version */}
            {versionLink && (
              <Link to={versionLink}>
                <Button variant="outline" size="sm" className="flex items-center gap-2">
                  <ExternalLink className="h-4 w-4" />
                  <span>View Committed Version</span>
                </Button>
              </Link>
            )}
          </div>
        </div>
      )}

      {/* Full Old Version View */}
      {viewMode === "full-old" && canViewOldVersion ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between px-3 py-2 bg-muted/50 rounded-t-lg border border-b-0">
            <span className="text-sm font-medium text-foreground">Committed Version</span>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs text-foreground/80">Before</Badge>
              {versionLink && (
                <Link to={versionLink}>
                  <Button variant="ghost" size="sm" className="h-7 text-xs flex items-center gap-1">
                    <ExternalLink className="h-3 w-3" />
                    <span>View Full Page</span>
                  </Button>
                </Link>
              )}
            </div>
          </div>
          <Card className="rounded-t-none bg-card">
            <ScrollArea className="h-[600px]">
              <div className="p-4 text-foreground">
                <ReadOnlyTipTapViewer content={diff.oldContentJson} />
              </div>
            </ScrollArea>
          </Card>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
        {/* Left: Committed version */}
        <div className="space-y-2">
          <div className="flex items-center justify-between px-3 py-2 bg-muted/50 rounded-t-lg border border-b-0">
            <span className="text-sm font-medium text-foreground">Committed</span>
            <div className="flex items-center gap-2">
              {diff.status === "modified" && (
                <Badge variant="outline" className="text-xs text-foreground/80">Before</Badge>
              )}
              {versionLink && (
                <Link to={versionLink}>
                  <Button variant="ghost" size="sm" className="h-7 text-xs flex items-center gap-1">
                    <ExternalLink className="h-3 w-3" />
                    <span>View Full Page</span>
                  </Button>
                </Link>
              )}
            </div>
          </div>
          <Card className="rounded-t-none bg-card">
            <ScrollArea className="h-[600px]">
              <div className="p-4 space-y-1 text-foreground">
                {hasBlockDiffs ? (
                  blockDiffs.map((blockDiff, idx) => {
                    if (!blockDiff.oldBlock && blockDiff.type !== "added") return null;

                    const isContext = blockDiff.type === "unchanged";
                    const isExpanded = expandedContext.has(idx);
                    const showContext = shouldShowContext(idx, blockDiff.type);

                    // Skip collapsed context blocks
                    if (isContext && !showContext) {
                      // Show expand button
                      const prevIsChange = idx > 0 && blockDiffs[idx - 1]?.type !== "unchanged";
                      const nextIsChange = idx < blockDiffs.length - 1 && blockDiffs[idx + 1]?.type !== "unchanged";
                      
                      if (prevIsChange || nextIsChange) {
                        return (
                          <div key={idx} className="flex items-center justify-center py-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => toggleContext(idx)}
                              className="text-xs text-muted-foreground hover:text-foreground"
                            >
                              <MoreHorizontal className="h-4 w-4 mr-1" />
                              <span>Show {idx > 0 && blockDiffs[idx - 1]?.type !== "unchanged" ? "previous" : "next"} context</span>
                              <ChevronDown className="h-3 w-3 ml-1" />
                            </Button>
                          </div>
                        );
                      }
                      return null;
                    }

                    const bgColor =
                      blockDiff.type === "removed" ? "bg-red-100 dark:bg-red-900/30 border-l-4 border-red-500" :
                      blockDiff.type === "modified" ? "bg-red-100 dark:bg-red-900/30 border-l-4 border-red-500" :
                      isContext ? "bg-muted/30 border-l-2 border-muted-foreground/20" :
                      "";

                    return (
                      <div key={idx} className={cn("rounded", bgColor, isContext && "opacity-60")}>
                        {isContext && showContext && (
                          <div className="flex items-center justify-between px-2 pt-1">
                            <span className="text-xs text-muted-foreground italic">Unchanged</span>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => toggleContext(idx)}
                              className="h-6 text-xs text-muted-foreground hover:text-foreground"
                            >
                              {isExpanded ? (
                                <>
                                  <ChevronUp className="h-3 w-3 mr-1" />
                                  <span>Hide</span>
                                </>
                              ) : (
                                <>
                                  <ChevronDown className="h-3 w-3 mr-1" />
                                  <span>Show more</span>
                                </>
                              )}
                            </Button>
                          </div>
                        )}
                        <div className={cn("p-2", isContext && !isExpanded && "max-h-20 overflow-hidden")}>
                          <div className="prose prose-sm max-w-none prose-foreground dark:prose-invert">
                            {blockDiff.oldBlock && (
                              <DiffBlockViewer block={blockDiff.oldBlock} type="old" />
                            )}
                          </div>
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
              <div className="p-4 space-y-1 text-foreground">
                {hasBlockDiffs ? (
                  blockDiffs.map((blockDiff, idx) => {
                    if (!blockDiff.newBlock && blockDiff.type !== "removed") return null;

                    const isContext = blockDiff.type === "unchanged";
                    const isExpanded = expandedContext.has(idx);
                    const showContext = shouldShowContext(idx, blockDiff.type);

                    // Skip collapsed context blocks
                    if (isContext && !showContext) {
                      // Show expand button
                      const prevIsChange = idx > 0 && blockDiffs[idx - 1]?.type !== "unchanged";
                      const nextIsChange = idx < blockDiffs.length - 1 && blockDiffs[idx + 1]?.type !== "unchanged";
                      
                      if (prevIsChange || nextIsChange) {
                        return (
                          <div key={idx} className="flex items-center justify-center py-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => toggleContext(idx)}
                              className="text-xs text-muted-foreground hover:text-foreground"
                            >
                              <MoreHorizontal className="h-4 w-4 mr-1" />
                              <span>Show {idx > 0 && blockDiffs[idx - 1]?.type !== "unchanged" ? "previous" : "next"} context</span>
                              <ChevronDown className="h-3 w-3 ml-1" />
                            </Button>
                          </div>
                        );
                      }
                      return null;
                    }

                    const bgColor =
                      blockDiff.type === "added" ? "bg-green-100 dark:bg-green-900/30 border-l-4 border-green-500" :
                      blockDiff.type === "modified" ? "bg-green-100 dark:bg-green-900/30 border-l-4 border-green-500" :
                      isContext ? "bg-muted/30 border-l-2 border-muted-foreground/20" :
                      "";

                    return (
                      <div key={idx} className={cn("rounded", bgColor, isContext && "opacity-60")}>
                        {isContext && showContext && (
                          <div className="flex items-center justify-between px-2 pt-1">
                            <span className="text-xs text-muted-foreground italic">Unchanged</span>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => toggleContext(idx)}
                              className="h-6 text-xs text-muted-foreground hover:text-foreground"
                            >
                              {isExpanded ? (
                                <>
                                  <ChevronUp className="h-3 w-3 mr-1" />
                                  <span>Hide</span>
                                </>
                              ) : (
                                <>
                                  <ChevronDown className="h-3 w-3 mr-1" />
                                  <span>Show more</span>
                                </>
                              )}
                            </Button>
                          </div>
                        )}
                        <div className={cn("p-2", isContext && !isExpanded && "max-h-20 overflow-hidden")}>
                          <div className="prose prose-sm max-w-none prose-foreground dark:prose-invert">
                            {blockDiff.newBlock && (
                              <DiffBlockViewer block={blockDiff.newBlock} type="new" />
                            )}
                          </div>
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
      )}

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
