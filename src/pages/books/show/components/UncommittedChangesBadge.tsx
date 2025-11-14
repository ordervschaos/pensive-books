/**
 * UncommittedChangesBadge Component
 *
 * Displays a badge showing uncommitted changes status for a book.
 * Shows "Draft" if changes exist, "Up to date" if workspace matches last commit.
 */

import { Badge } from "@/components/ui/badge";
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
      <Badge variant="outline" className="gap-1">
        <Loader2 className="h-3 w-3 animate-spin" />
        Checking...
      </Badge>
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
            <Badge
              variant="secondary"
              className="gap-1.5 h-7 px-2.5 text-xs bg-amber-100 text-amber-900 hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-200 cursor-pointer transition-all border border-amber-200 dark:border-amber-800"
              onClick={handleClick}
            >
              <FileEdit className="h-3.5 w-3.5" />
              Draft
              {showCount && changedPages > 0 && (
                <span className="ml-0.5">({changedPages})</span>
              )}
            </Badge>
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
          <Badge
            variant="outline"
            className="gap-1.5 h-7 px-2.5 text-xs bg-green-50 text-green-700 border-green-200 hover:bg-green-100 dark:bg-green-900/20 dark:text-green-300 dark:border-green-800"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            Up to date
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <p>{tooltipText}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
