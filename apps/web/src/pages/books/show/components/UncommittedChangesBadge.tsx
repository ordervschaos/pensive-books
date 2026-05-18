/**
 * UncommittedChangesBadge Component
 *
 * Displays a badge showing uncommitted changes status for a book.
 * Shows "Draft" if changes exist, "Up to date" if workspace matches last commit.
 */

import { useUncommittedChanges } from "@/hooks/use-uncommitted-changes";
import { Loader2, FileEdit, CheckCircle2 } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatDistanceToNow } from "date-fns";
import { useNavigate } from "react-router-dom";

interface UncommittedChangesBadgeProps {
  bookId: number;
  /** Book slug for navigation */
  bookSlug?: string;
  /** Whether to show count of changed pages */
  showCount?: boolean;
  /** Size variant */
  variant?: "default" | "sm";
}

export function UncommittedChangesBadge({
  bookId,
  bookSlug,
  showCount = false,
  variant = "default",
}: UncommittedChangesBadgeProps) {
  const navigate = useNavigate();
  const { hasChanges, changedPages, lastCommitAt, isLoading } =
    useUncommittedChanges(bookId);

  const handleClick = () => {
    if (hasChanges && bookSlug) {
      navigate(`/books/${bookSlug}/draft`);
    }
  };

  if (isLoading) {
    return (
      <span className="pv-serif inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-transparent px-3.5 text-[13px] italic text-[hsl(var(--pv-text-muted))]">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Checking…
      </span>
    );
  }

  if (hasChanges) {
    const tooltipText = lastCommitAt
      ? `${changedPages} page${
          changedPages !== 1 ? "s" : ""
        } modified since last commit (${formatDistanceToNow(
          new Date(lastCommitAt),
          { addSuffix: true }
        )})`
      : `${changedPages} page${
          changedPages !== 1 ? "s" : ""
        } modified (no commits yet)`;

    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={handleClick}
              className="pv-serif inline-flex h-9 items-center gap-1.5 rounded-full border border-foreground/30 bg-foreground/5 px-3.5 text-[13px] italic text-foreground transition-colors hover:border-foreground/50 hover:bg-foreground/10"
            >
              <FileEdit className="h-3.5 w-3.5" />
              <span>Draft</span>
              {showCount && changedPages > 0 && (
                <span className="pv-mono text-[11px] not-italic tabular-nums text-[hsl(var(--pv-text-muted))]">
                  {changedPages}
                </span>
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{tooltipText}</p>
            {bookSlug && <p className="text-xs mt-1 text-muted-foreground">Click to view changes</p>}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  // No changes - workspace is clean
  const tooltipText = lastCommitAt
    ? `No changes since last commit (${formatDistanceToNow(
        new Date(lastCommitAt),
        { addSuffix: true }
      )})`
    : "No commits yet";

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="pv-serif inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-transparent px-3.5 text-[13px] italic text-[hsl(var(--pv-text-muted))]">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Up to date
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <p>{tooltipText}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
