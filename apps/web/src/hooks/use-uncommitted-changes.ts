/**
 * useUncommittedChanges Hook
 *
 * React hook for tracking uncommitted changes in a book.
 * Provides real-time status of workspace modifications since last commit.
 */

import { useQuery } from "@tanstack/react-query";
import { VersionService } from "@/services/VersionService";

export interface UseUncommittedChangesResult {
  /** Number of pages modified since last commit */
  changedPages: number;
  /** Timestamp of last commit */
  lastCommitAt: string | null;
  /** Whether there are any uncommitted changes */
  hasChanges: boolean;
  /** Loading state */
  isLoading: boolean;
  /** Error state */
  error: Error | null;
  /** Refetch function */
  refetch: () => void;
}

/**
 * Hook to check for uncommitted changes in a book
 *
 * @param bookId - ID of the book to check
 * @param options - Query options
 * @returns Uncommitted changes data and status
 *
 * @example
 * ```tsx
 * const { hasChanges, changedPages, refetch } = useUncommittedChanges(bookId);
 *
 * if (hasChanges) {
 *   return <Badge>{changedPages} uncommitted changes</Badge>;
 * }
 * ```
 */
export function useUncommittedChanges(
  bookId: number | undefined,
  options?: {
    enabled?: boolean;
    refetchInterval?: number;
  }
): UseUncommittedChangesResult {
  const {
    data,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["uncommitted-changes", bookId],
    queryFn: () => {
      if (!bookId) {
        throw new Error("Book ID is required");
      }
      return VersionService.getUncommittedChanges(bookId);
    },
    enabled: options?.enabled !== false && !!bookId,
    refetchInterval: options?.refetchInterval,
    // Refetch when window regains focus to catch external changes
    refetchOnWindowFocus: true,
    // Keep previous data while refetching to avoid flickering
    placeholderData: (previousData) => previousData,
  });

  return {
    changedPages: data?.changedPages ?? 0,
    lastCommitAt: data?.lastCommitAt ?? null,
    hasChanges: data?.hasChanges ?? false,
    isLoading,
    error: error as Error | null,
    refetch,
  };
}
