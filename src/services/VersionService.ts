/**
 * VersionService
 *
 * Service for managing book version control operations including:
 * - Creating commits (snapshots)
 * - Publishing versions
 * - Retrieving version history
 * - Checking uncommitted changes
 */

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type BookVersion = Database["public"]["Tables"]["book_versions"]["Row"];
type PageVersion = Database["public"]["Tables"]["page_versions"]["Row"];

export interface VersionDetails {
  versionId: number;
  bookId: number;
  versionNumber: number;
  bookName: string;
  commitMessage: string | null;
  committedAt: string;
  committedBy: string | null;
  isPublished: boolean;
  publishedAt: string | null;
  pageCount: number;
}

export interface VersionHistoryItem {
  versionId: number;
  versionNumber: number;
  commitMessage: string | null;
  committedAt: string;
  committedBy: string | null;
  committerEmail: string | null;
  isPublished: boolean;
  publishedAt: string | null;
  pageCount: number;
}

export interface UncommittedChanges {
  changedPages: number;
  lastCommitAt: string | null;
  hasChanges: boolean;
}

export class VersionService {
  /**
   * Creates a new version (commit) of a book
   * Captures complete snapshot of book + all pages
   */
  static async createCommit(
    bookId: number,
    commitMessage?: string
  ): Promise<number> {
    const { data, error } = await supabase.rpc("create_book_version", {
      p_book_id: bookId,
      p_commit_message: commitMessage || null,
    });

    if (error) {
      console.error("Error creating book version:", error);
      throw new Error(`Failed to create commit: ${error.message}`);
    }

    if (!data) {
      throw new Error("No version ID returned from commit");
    }

    return data as number;
  }

  /**
   * Publishes a specific version of a book
   * Makes it visible to public viewers if book is public
   */
  static async publishVersion(
    bookId: number,
    versionId: number
  ): Promise<void> {
    const { error } = await supabase.rpc("publish_version", {
      p_book_id: bookId,
      p_version_id: versionId,
    });

    if (error) {
      console.error("Error publishing version:", error);
      throw new Error(`Failed to publish version: ${error.message}`);
    }
  }

  /**
   * Gets detailed information about a specific version
   */
  static async getVersionDetails(
    versionId: number
  ): Promise<VersionDetails | null> {
    const { data, error } = await supabase.rpc("get_version_details", {
      p_version_id: versionId,
    });

    if (error) {
      console.error("Error fetching version details:", error);
      throw new Error(`Failed to get version details: ${error.message}`);
    }

    if (!data || data.length === 0) {
      return null;
    }

    const version = data[0];
    return {
      versionId: version.version_id,
      bookId: version.book_id,
      versionNumber: version.version_number,
      bookName: version.book_name,
      commitMessage: version.commit_message,
      committedAt: version.committed_at,
      committedBy: version.committed_by,
      isPublished: version.is_published,
      publishedAt: version.published_at,
      pageCount: version.page_count,
    };
  }

  /**
   * Gets complete version history for a book
   * Returns all versions in reverse chronological order
   */
  static async getVersionHistory(
    bookId: number
  ): Promise<VersionHistoryItem[]> {
    const { data, error } = await supabase.rpc("get_version_history", {
      p_book_id: bookId,
    });

    if (error) {
      console.error("Error fetching version history:", error);
      throw new Error(`Failed to get version history: ${error.message}`);
    }

    if (!data) {
      return [];
    }

    return data.map((v) => ({
      versionId: v.version_id,
      versionNumber: v.version_number,
      commitMessage: v.commit_message,
      committedAt: v.committed_at,
      committedBy: v.committed_by,
      committerEmail: v.committer_email,
      isPublished: v.is_published,
      publishedAt: v.published_at,
      pageCount: v.page_count,
    }));
  }

  /**
   * Gets count of pages modified since last commit
   */
  static async getUncommittedChanges(
    bookId: number
  ): Promise<UncommittedChanges> {
    const { data, error } = await supabase.rpc(
      "get_uncommitted_changes_count",
      {
        p_book_id: bookId,
      }
    );

    if (error) {
      console.error("Error fetching uncommitted changes:", error);
      throw new Error(`Failed to get uncommitted changes: ${error.message}`);
    }

    if (!data || data.length === 0) {
      return {
        changedPages: 0,
        lastCommitAt: null,
        hasChanges: false,
      };
    }

    const result = data[0];
    return {
      changedPages: result.changed_pages || 0,
      lastCommitAt: result.last_commit_at,
      hasChanges: (result.changed_pages || 0) > 0,
    };
  }

  /**
   * Gets a specific book version with its metadata
   */
  static async getBookVersion(versionId: number): Promise<BookVersion | null> {
    const { data, error } = await supabase
      .from("book_versions")
      .select("*")
      .eq("id", versionId)
      .single();

    if (error) {
      console.error("Error fetching book version:", error);
      return null;
    }

    return data;
  }

  /**
   * Gets all page versions for a specific book version
   */
  static async getPageVersions(versionId: number): Promise<PageVersion[]> {
    const { data, error } = await supabase
      .from("page_versions")
      .select("*")
      .eq("book_version_id", versionId)
      .order("page_index", { ascending: true });

    if (error) {
      console.error("Error fetching page versions:", error);
      throw new Error(`Failed to get page versions: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Gets the currently published version for a book
   */
  static async getPublishedVersion(
    bookId: number
  ): Promise<BookVersion | null> {
    const { data, error } = await supabase
      .from("book_versions")
      .select("*")
      .eq("book_id", bookId)
      .eq("is_published", true)
      .single();

    if (error) {
      // No published version is not an error
      if (error.code === "PGRST116") {
        return null;
      }
      console.error("Error fetching published version:", error);
      return null;
    }

    return data;
  }

  /**
   * Gets the latest version for a book
   */
  static async getLatestVersion(bookId: number): Promise<BookVersion | null> {
    const { data, error } = await supabase
      .from("book_versions")
      .select("*")
      .eq("book_id", bookId)
      .order("version_number", { ascending: false })
      .limit(1)
      .single();

    if (error) {
      // No versions exist yet
      if (error.code === "PGRST116") {
        return null;
      }
      console.error("Error fetching latest version:", error);
      return null;
    }

    return data;
  }

  /**
   * Checks if a book has any uncommitted changes
   */
  static async hasUncommittedChanges(bookId: number): Promise<boolean> {
    const changes = await this.getUncommittedChanges(bookId);
    return changes.hasChanges;
  }

  /**
   * Rolls back workspace to a specific version
   * Restores all pages to the state they were in at that version
   * Creates a new commit documenting the rollback
   */
  static async rollbackToVersion(
    bookId: number,
    versionId: number
  ): Promise<number> {
    const { data, error } = await supabase.rpc("rollback_to_version", {
      p_book_id: bookId,
      p_version_id: versionId,
    });

    if (error) {
      console.error("Error rolling back to version:", error);
      throw new Error(`Failed to rollback: ${error.message}`);
    }

    if (!data) {
      throw new Error("No version ID returned from rollback");
    }

    return data as number;
  }

  /**
   * Gets list of page IDs that have been modified since last commit
   */
  static async getModifiedPageIds(bookId: number): Promise<number[]> {
    // Get last commit timestamp
    const { data: book } = await supabase
      .from("books")
      .select("last_commit_version_id")
      .eq("id", bookId)
      .single();

    if (!book || !book.last_commit_version_id) {
      // No commits yet - all pages are "modified"
      const { data: pages } = await supabase
        .from("pages")
        .select("id")
        .eq("book_id", bookId)
        .eq("archived", false);

      return pages?.map((p) => p.id) || [];
    }

    // Get last commit time
    const { data: version } = await supabase
      .from("book_versions")
      .select("committed_at")
      .eq("id", book.last_commit_version_id)
      .single();

    if (!version) {
      return [];
    }

    // Find pages modified after last commit
    const { data: pages } = await supabase
      .from("pages")
      .select("id")
      .eq("book_id", bookId)
      .eq("archived", false)
      .or(
        `updated_at.gt.${version.committed_at},created_at.gt.${version.committed_at}`
      );

    return pages?.map((p) => p.id) || [];
  }
}
