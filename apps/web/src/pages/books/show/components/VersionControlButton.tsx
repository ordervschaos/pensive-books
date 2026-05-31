import { useNavigate } from "react-router-dom";
import { ChevronDown, FileEdit, GitCommit, Globe, History, Loader2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useUncommittedChanges } from "@/hooks/use-uncommitted-changes";
import { VersionService } from "@/services/VersionService";

interface VersionControlButtonProps {
  bookId: number;
  bookSlug: string | undefined;
  onSaveVersion: () => void;
}

/**
 * Compact split button that combines the draft status, latest version, and
 * "Save this version" action into one control. Left half triggers Save; the
 * chevron opens a menu with View drafts / View history.
 */
export function VersionControlButton({
  bookId,
  bookSlug,
  onSaveVersion,
}: VersionControlButtonProps) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { hasChanges, changedPages, lastCommitAt, isLoading } =
    useUncommittedChanges(bookId);

  const { data: latestVersion } = useQuery({
    queryKey: ["latest-version", bookId],
    queryFn: () => VersionService.getLatestVersion(bookId),
    enabled: bookId > 0,
  });

  const { data: publishedVersion } = useQuery({
    queryKey: ["published-version", bookId],
    queryFn: () => VersionService.getPublishedVersion(bookId),
    enabled: bookId > 0,
  });

  // True when a version is published but newer committed versions exist.
  const publishedBehind =
    !!publishedVersion &&
    !!latestVersion &&
    publishedVersion.version_number < latestVersion.version_number;

  const publishLatestMutation = useMutation({
    mutationFn: () => {
      if (!latestVersion) throw new Error("No version to publish");
      return VersionService.publishVersion(bookId, latestVersion.id);
    },
    onSuccess: () => {
      toast({
        title: "Latest version published",
        description: `v${latestVersion?.version_number} is now the published version.`,
      });
      queryClient.invalidateQueries({ queryKey: ["published-version", bookId] });
      queryClient.invalidateQueries({ queryKey: ["latest-version", bookId] });
      queryClient.invalidateQueries({ queryKey: ["version-history", bookId] });
      queryClient.invalidateQueries({ queryKey: ["books", bookId] });
      queryClient.invalidateQueries({ queryKey: ["books"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Publish failed",
        description: error.message || "Failed to publish the latest version.",
        variant: "destructive",
      });
    },
  });

  const tooltipText = (() => {
    if (isLoading) return "Checking workspace…";
    if (hasChanges && lastCommitAt) {
      return `${changedPages} page${changedPages !== 1 ? "s" : ""} modified ${formatDistanceToNow(
        new Date(lastCommitAt),
        { addSuffix: true },
      )}`;
    }
    if (hasChanges) return `${changedPages} page${changedPages !== 1 ? "s" : ""} modified (no commits yet)`;
    if (lastCommitAt) return `No changes since last commit (${formatDistanceToNow(new Date(lastCommitAt), { addSuffix: true })})`;
    return "No commits yet";
  })();

  const versionLabel = latestVersion ? `v${latestVersion.version_number}` : "no version";

  return (
    <div
      className={cn(
        "inline-flex w-fit items-stretch overflow-hidden rounded-full bg-transparent",
        hasChanges ? "" : "border border-border",
      )}
    >
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="sm"
              onClick={onSaveVersion}
              className={cn(
                "pv-serif h-9 gap-1.5 rounded-none rounded-l-full border-0 px-3.5 text-[13px] font-normal tracking-[0.01em]",
                hasChanges
                  ? "bg-foreground text-background hover:opacity-90"
                  : "bg-transparent text-[hsl(var(--pv-text-muted))] hover:bg-[hsl(var(--pv-surface-2))] hover:text-foreground",
              )}
            >
              {isLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <GitCommit className="h-3.5 w-3.5" />
              )}
              <span>Save this version</span>
              {hasChanges && (
                <span className="pv-mono ml-1 rounded-full bg-background/20 px-1.5 py-0.5 text-[10px] not-italic tabular-nums">
                  {changedPages}
                </span>
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>{tooltipText}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <span className="w-px self-stretch bg-border" />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Version control menu"
            className={cn(
              "relative h-9 w-9 rounded-none rounded-r-full border-0",
              hasChanges
                ? "bg-foreground text-background hover:opacity-90"
                : "bg-transparent text-[hsl(var(--pv-text-muted))] hover:bg-[hsl(var(--pv-surface-2))] hover:text-foreground",
            )}
          >
            <ChevronDown className="h-3.5 w-3.5" />
            {(hasChanges || publishedBehind) && (
              <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-amber-400" />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel className="pv-mono text-[10.5px] uppercase tracking-[0.18em] text-[hsl(var(--pv-text-faint))]">
            Version control
          </DropdownMenuLabel>
          <DropdownMenuItem
            onClick={onSaveVersion}
            className="flex items-center gap-2"
          >
            <GitCommit className="h-4 w-4" />
            <span>Save this version…</span>
          </DropdownMenuItem>
          {publishedBehind && (
            <DropdownMenuItem
              onClick={(e) => {
                e.preventDefault();
                publishLatestMutation.mutate();
              }}
              disabled={publishLatestMutation.isPending}
              className="flex items-center gap-2"
            >
              {publishLatestMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Globe className="h-4 w-4" />
              )}
              <span>Publish latest version</span>
              <span className="pv-mono ml-auto text-[11px] tabular-nums text-[hsl(var(--pv-text-muted))]">
                v{latestVersion?.version_number}
              </span>
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          {hasChanges && bookSlug && (
            <DropdownMenuItem
              onClick={() => navigate(`/books/${bookSlug}/draft`)}
              className="flex items-center gap-2"
            >
              <FileEdit className="h-4 w-4" />
              <span>View drafts</span>
              <span className="pv-mono ml-auto text-[11px] tabular-nums text-[hsl(var(--pv-text-muted))]">
                {changedPages}
              </span>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onClick={() => bookSlug && navigate(`/books/${bookSlug}/versions`)}
            disabled={!bookSlug}
            className="flex items-center gap-2"
          >
            <History className="h-4 w-4" />
            <span>View history</span>
            <span className="pv-mono ml-auto text-[11px] tabular-nums text-[hsl(var(--pv-text-muted))]">
              {versionLabel}
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
