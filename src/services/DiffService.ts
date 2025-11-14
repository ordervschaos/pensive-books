/**
 * DiffService
 *
 * Service for comparing page content between versions
 * Provides utilities for detecting changes and generating diffs
 */

import { supabase } from "@/integrations/supabase/client";
import { VersionService } from "./VersionService";
import { jsonToText } from "@/utils/tiptapHelpers";

export type FileStatus = "modified" | "added" | "deleted";
export type BlockChangeType = "added" | "removed" | "modified" | "unchanged";

export interface BlockDiff {
  type: BlockChangeType;
  blockType: string; // "heading", "paragraph", etc.
  oldContent?: string;
  newContent?: string;
  oldBlock?: any;
  newBlock?: any;
}

export interface PageDiff {
  pageId: number;
  title: string;
  pageIndex: number;
  status: FileStatus;
  oldContent: string;
  newContent: string;
  oldContentJson?: any;  // TipTap JSON for old version
  newContentJson?: any;  // TipTap JSON for new version
  lastModified: string;
  slug: string;
  blockDiffs?: BlockDiff[];
}

export class DiffService {
  /**
   * Gets the status of multiple pages in batch (much more efficient)
   * @param pageIds - Array of page IDs to check
   * @param bookId - The book ID
   * @param lastVersion - Optional: The last committed version (to avoid repeated queries)
   */
  static async getPageStatusesBatch(
    pageIds: number[],
    bookId: number,
    lastVersion?: any
  ): Promise<Array<{ pageId: number; status: FileStatus | null }>> {
    if (pageIds.length === 0) {
      return [];
    }

    // Get the last committed version if not provided
    if (!lastVersion) {
      lastVersion = await VersionService.getLatestVersion(bookId);
    }

    if (!lastVersion) {
      // No commits yet, so all pages are "added"
      return pageIds.map(pageId => ({ pageId, status: "added" as FileStatus }));
    }

    // Batch fetch all page versions at once
    const { data: pageVersions = [] } = await supabase
      .from("page_versions")
      .select("*")
      .eq("book_version_id", lastVersion.id)
      .in("page_id", pageIds);

    // Batch fetch all current pages at once
    const { data: currentPages = [] } = await supabase
      .from("pages")
      .select("*")
      .in("id", pageIds)
      .eq("archived", false);

    // Create maps for quick lookup
    const pageVersionMap = new Map(
      pageVersions.map(pv => [pv.page_id, pv])
    );
    const currentPageMap = new Map(
      currentPages.map(p => [p.id, p])
    );

    // Process each page
    return pageIds.map(pageId => {
      const pageVersion = pageVersionMap.get(pageId);
      const currentPage = currentPageMap.get(pageId);

      if (!pageVersion && currentPage) {
        return { pageId, status: "added" as FileStatus };
      }

      if (pageVersion && !currentPage) {
        return { pageId, status: "deleted" as FileStatus };
      }

      // Both exist - check if content actually changed
      if (pageVersion && currentPage) {
        // Compare content by converting both to text
        const oldContent = pageVersion.content
          ? jsonToText(pageVersion.content)
          : "";
        const newContent = currentPage.content
          ? jsonToText(currentPage.content)
          : "";

        // Also compare titles
        const oldTitle = (pageVersion.title || "").trim();
        const newTitle = (currentPage.title || "").trim();

        // If content and title are identical, return null (unchanged)
        if (oldContent === newContent && oldTitle === newTitle) {
          return { pageId, status: null }; // Content unchanged
        }

        return { pageId, status: "modified" as FileStatus };
      }

      return { pageId, status: "modified" as FileStatus };
    });
  }

  /**
   * Gets the status of a page (modified, added, or deleted)
   * @param pageId - The page ID to check
   * @param bookId - The book ID
   * @param lastVersion - Optional: The last committed version (to avoid repeated queries)
   */
  static async getPageStatus(
    pageId: number,
    bookId: number,
    lastVersion?: any
  ): Promise<FileStatus | null> {
    // Get the last committed version if not provided
    if (!lastVersion) {
      lastVersion = await VersionService.getLatestVersion(bookId);
    }

    if (!lastVersion) {
      // No commits yet, so all pages are "added"
      return "added";
    }

    // Check if page exists in the last version
    const { data: pageVersion } = await supabase
      .from("page_versions")
      .select("*")
      .eq("book_version_id", lastVersion.id)
      .eq("page_id", pageId)
      .maybeSingle();

    // Check if page exists in current workspace
    const { data: currentPage } = await supabase
      .from("pages")
      .select("*")
      .eq("id", pageId)
      .eq("archived", false)
      .maybeSingle();

    if (!pageVersion && currentPage) {
      return "added";
    }

    if (pageVersion && !currentPage) {
      return "deleted";
    }

    // Both exist - check if content actually changed
    if (pageVersion && currentPage) {
      // Compare content by converting both to text
      const oldContent = pageVersion.content
        ? jsonToText(pageVersion.content)
        : "";
      const newContent = currentPage.content
        ? jsonToText(currentPage.content)
        : "";

      // Also compare titles
      const oldTitle = (pageVersion.title || "").trim();
      const newTitle = (currentPage.title || "").trim();

      // If content and title are identical, return null (unchanged)
      if (oldContent === newContent && oldTitle === newTitle) {
        return null; // Content unchanged
      }

      return "modified";
    }

    return "modified";
  }

  /**
   * Gets the diff for a specific page
   * @param pageId - The page ID to diff
   * @param bookId - The book ID
   * @param lastVersion - Optional: The last committed version (to avoid repeated queries)
   */
  static async getPageDiff(
    pageId: number,
    bookId: number,
    lastVersion?: any
  ): Promise<PageDiff | null> {
    // Get current page
    const { data: currentPage, error: currentError } = await supabase
      .from("pages")
      .select("*")
      .eq("id", pageId)
      .maybeSingle();

    if (currentError) {
      console.error("Error fetching current page:", currentError);
      throw new Error(`Failed to fetch current page: ${currentError.message}`);
    }

    // Get the last committed version if not provided
    if (!lastVersion) {
      lastVersion = await VersionService.getLatestVersion(bookId);
    }

    let oldContent = "";
    let oldTitle = "";
    let oldContentJson: any = null;
    let status: FileStatus = "added";

    if (lastVersion) {
      // Get page from last version
      const { data: pageVersion } = await supabase
        .from("page_versions")
        .select("*")
        .eq("book_version_id", lastVersion.id)
        .eq("page_id", pageId)
        .maybeSingle();

      if (pageVersion) {
        oldTitle = pageVersion.title || "";
        oldContent = pageVersion.content
          ? jsonToText(pageVersion.content)
          : "";
        oldContentJson = pageVersion.content;
        status = currentPage ? "modified" : "deleted";
      }
    }

    if (!currentPage && !lastVersion) {
      return null;
    }

    const newTitle = currentPage?.title || oldTitle;
    const newContent = currentPage?.content
      ? jsonToText(currentPage.content)
      : "";

    // Generate block-level diffs
    const newContentJson = currentPage?.content || null;
    const blockDiffs = this.compareBlocks(oldContentJson, newContentJson);

    return {
      pageId,
      title: newTitle,
      pageIndex: currentPage?.page_index ?? 0,
      status,
      oldContent,
      newContent,
      oldContentJson,
      newContentJson,
      lastModified: currentPage?.updated_at || new Date().toISOString(),
      slug: currentPage?.slug || pageId.toString(),
      blockDiffs,
    };
  }

  /**
   * Gets diffs for all modified pages in a book
   */
  static async getAllPageDiffs(bookId: number): Promise<PageDiff[]> {
    const modifiedPageIds = await VersionService.getModifiedPageIds(bookId);
    const diffs: PageDiff[] = [];

    for (const pageId of modifiedPageIds) {
      const diff = await this.getPageDiff(pageId, bookId);
      if (diff) {
        diffs.push(diff);
      }
    }

    return diffs;
  }

  /**
   * Converts TipTap JSON content to plain text for diffing
   */
  static contentToText(content: any): string {
    if (!content) return "";
    return jsonToText(content);
  }

  /**
   * Extracts individual blocks from TipTap JSON content
   */
  static extractBlocks(content: any): any[] {
    if (!content) return [];

    // Handle both {type: "doc", content: [...]} and direct array formats
    if (content.type === "doc" && Array.isArray(content.content)) {
      return content.content;
    }

    if (Array.isArray(content)) {
      return content;
    }

    return [];
  }

  /**
   * Converts a single block to readable text
   */
  static blockToText(block: any): string {
    if (!block) return "";

    // Extract text from block
    if (block.content && Array.isArray(block.content)) {
      return block.content
        .map((node: any) => {
          if (node.type === "text") return node.text || "";
          if (node.type === "hardBreak") return "\n";
          return this.blockToText(node);
        })
        .join("");
    }

    if (block.text) return block.text;

    return "";
  }

  /**
   * Creates a unique identifier for a block to help with comparison
   * Uses multiple attributes to create a robust identifier
   */
  static getBlockId(block: any, index: number): string {
    const type = block.type || "unknown";
    const text = this.blockToText(block).substring(0, 100).trim();
    const audioBlock = block.attrs?.audioBlock;
    const level = block.attrs?.level; // for headings

    // Create a more unique ID by combining multiple factors
    const textHash = text.length > 0 ? text.substring(0, 50) : `empty-${index}`;

    // Include level for headings to distinguish h1 from h2, etc.
    const levelPart = level !== undefined ? `-l${level}` : "";

    // AudioBlock is important for your use case
    const audioBlockPart = audioBlock !== undefined && audioBlock !== null ? `-ab${audioBlock}` : "";

    return `${type}${levelPart}${audioBlockPart}-${textHash}`;
  }

  /**
   * Compares two blocks and determines if they're the same
   */
  static areBlocksEqual(block1: any, block2: any): boolean {
    if (!block1 && !block2) return true;
    if (!block1 || !block2) return false;

    // Compare type
    if (block1.type !== block2.type) return false;

    // Compare text content
    const text1 = this.blockToText(block1);
    const text2 = this.blockToText(block2);
    if (text1 !== text2) return false;

    // Compare attributes (level for headings, etc.)
    if (block1.attrs?.level !== block2.attrs?.level) return false;

    return true;
  }

  /**
   * Compares blocks between two versions and generates block-level diffs
   * Uses a smart matching algorithm that handles reordering and modifications
   */
  static compareBlocks(oldContent: any, newContent: any): BlockDiff[] {
    const oldBlocks = this.extractBlocks(oldContent);
    const newBlocks = this.extractBlocks(newContent);
    const diffs: BlockDiff[] = [];

    // Track which blocks we've processed
    const processedOld = new Set<number>();
    const processedNew = new Set<number>();

    // First pass: Look for exact matches by position and content
    const minLength = Math.min(oldBlocks.length, newBlocks.length);
    for (let i = 0; i < minLength; i++) {
      const oldBlock = oldBlocks[i];
      const newBlock = newBlocks[i];

      // Check if blocks at same position are equal
      if (this.areBlocksEqual(oldBlock, newBlock)) {
        // Unchanged block at same position - skip it
        processedOld.add(i);
        processedNew.add(i);
      } else if (oldBlock.type === newBlock.type) {
        // Same type, different content - this is a modification
        processedOld.add(i);
        processedNew.add(i);
        diffs.push({
          type: "modified",
          blockType: newBlock.type || "unknown",
          oldContent: this.blockToText(oldBlock),
          newContent: this.blockToText(newBlock),
          oldBlock: oldBlock,
          newBlock: newBlock,
        });
      }
    }

    // Second pass: Find added blocks (in new but not in old)
    newBlocks.forEach((newBlock, newIndex) => {
      if (!processedNew.has(newIndex)) {
        // Try to find a similar block in old that hasn't been processed
        let foundMatch = false;

        for (let oldIndex = 0; oldIndex < oldBlocks.length; oldIndex++) {
          if (processedOld.has(oldIndex)) continue;

          const oldBlock = oldBlocks[oldIndex];

          // Check if this is the same block (by audioBlock or similar content)
          const sameAudioBlock =
            oldBlock.attrs?.audioBlock !== undefined &&
            oldBlock.attrs?.audioBlock === newBlock.attrs?.audioBlock;

          const similarContent =
            oldBlock.type === newBlock.type &&
            this.blockToText(oldBlock).length > 0 &&
            this.blockToText(oldBlock) === this.blockToText(newBlock);

          if (sameAudioBlock || similarContent) {
            // This is a match - check if modified
            if (!this.areBlocksEqual(oldBlock, newBlock)) {
              diffs.push({
                type: "modified",
                blockType: newBlock.type || "unknown",
                oldContent: this.blockToText(oldBlock),
                newContent: this.blockToText(newBlock),
                oldBlock: oldBlock,
                newBlock: newBlock,
              });
            }
            processedOld.add(oldIndex);
            processedNew.add(newIndex);
            foundMatch = true;
            break;
          }
        }

        // If no match found, this is a new block
        if (!foundMatch) {
          processedNew.add(newIndex);
          diffs.push({
            type: "added",
            blockType: newBlock.type || "unknown",
            newContent: this.blockToText(newBlock),
            newBlock: newBlock,
          });
        }
      }
    });

    // Third pass: Find removed blocks (in old but not in new)
    oldBlocks.forEach((oldBlock, oldIndex) => {
      if (!processedOld.has(oldIndex)) {
        diffs.push({
          type: "removed",
          blockType: oldBlock.type || "unknown",
          oldContent: this.blockToText(oldBlock),
          oldBlock: oldBlock,
        });
      }
    });

    return diffs;
  }
}
