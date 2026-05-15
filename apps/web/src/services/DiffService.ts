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
  contextBefore?: number; // Number of unchanged blocks before this change
  contextAfter?: number; // Number of unchanged blocks after this change
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
  versionId?: number;  // ID of the committed version
  versionPageIndex?: number;  // Page index in the committed version
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

    let versionId: number | undefined;
    let versionPageIndex: number | undefined;

    if (lastVersion) {
      versionId = lastVersion.id;
      
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
        versionPageIndex = pageVersion.page_index;
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

    // Generate block-level diffs (already includes context blocks)
    const newContentJson = currentPage?.content || null;
    const blockDiffs = this.compareBlocks(oldContentJson, newContentJson, 2);

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
      versionId,
      versionPageIndex,
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
   * Includes context blocks (unchanged blocks) around changes for better understanding
   */
  static compareBlocks(oldContent: any, newContent: any, contextLines: number = 2): BlockDiff[] {
    const oldBlocks = this.extractBlocks(oldContent);
    const newBlocks = this.extractBlocks(newContent);
    const diffs: BlockDiff[] = [];

    // Track which blocks we've processed
    const processedOld = new Set<number>();
    const processedNew = new Set<number>();
    const changeIndices: number[] = []; // Track indices where changes occur

    // First pass: Identify all changes and unchanged blocks
    const allBlocks: Array<{
      oldIndex?: number;
      newIndex?: number;
      type: BlockChangeType;
      oldBlock?: any;
      newBlock?: any;
    }> = [];

    // Build a mapping of all blocks with their change status
    const maxLength = Math.max(oldBlocks.length, newBlocks.length);
    for (let i = 0; i < maxLength; i++) {
      const oldBlock = oldBlocks[i];
      const newBlock = newBlocks[i];

      if (oldBlock && newBlock) {
        if (this.areBlocksEqual(oldBlock, newBlock)) {
          // Unchanged block
          allBlocks.push({
            oldIndex: i,
            newIndex: i,
            type: "unchanged",
            oldBlock: oldBlock,
            newBlock: newBlock,
          });
          processedOld.add(i);
          processedNew.add(i);
        } else if (oldBlock.type === newBlock.type) {
          // Modified block
          allBlocks.push({
            oldIndex: i,
            newIndex: i,
            type: "modified",
            oldBlock: oldBlock,
            newBlock: newBlock,
          });
          changeIndices.push(allBlocks.length - 1);
          processedOld.add(i);
          processedNew.add(i);
        }
      } else if (oldBlock && !newBlock) {
        // Removed block
        allBlocks.push({
          oldIndex: i,
          type: "removed",
          oldBlock: oldBlock,
        });
        changeIndices.push(allBlocks.length - 1);
        processedOld.add(i);
      } else if (!oldBlock && newBlock) {
        // Added block
        allBlocks.push({
          newIndex: i,
          type: "added",
          newBlock: newBlock,
        });
        changeIndices.push(allBlocks.length - 1);
        processedNew.add(i);
      }
    }

    // Second pass: Find added blocks that weren't matched by position
    newBlocks.forEach((newBlock, newIndex) => {
      if (!processedNew.has(newIndex)) {
        let foundMatch = false;

        for (let oldIndex = 0; oldIndex < oldBlocks.length; oldIndex++) {
          if (processedOld.has(oldIndex)) continue;

          const oldBlock = oldBlocks[oldIndex];
          const sameAudioBlock =
            oldBlock.attrs?.audioBlock !== undefined &&
            oldBlock.attrs?.audioBlock === newBlock.attrs?.audioBlock;
          const similarContent =
            oldBlock.type === newBlock.type &&
            this.blockToText(oldBlock).length > 0 &&
            this.blockToText(oldBlock) === this.blockToText(newBlock);

          if (sameAudioBlock || similarContent) {
            if (!this.areBlocksEqual(oldBlock, newBlock)) {
              allBlocks.push({
                oldIndex,
                newIndex,
                type: "modified",
                oldBlock: oldBlock,
                newBlock: newBlock,
              });
              changeIndices.push(allBlocks.length - 1);
            }
            processedOld.add(oldIndex);
            processedNew.add(newIndex);
            foundMatch = true;
            break;
          }
        }

        if (!foundMatch) {
          allBlocks.push({
            newIndex,
            type: "added",
            newBlock: newBlock,
          });
          changeIndices.push(allBlocks.length - 1);
          processedNew.add(newIndex);
        }
      }
    });

    // Third pass: Find removed blocks
    oldBlocks.forEach((oldBlock, oldIndex) => {
      if (!processedOld.has(oldIndex)) {
        allBlocks.push({
          oldIndex,
          type: "removed",
          oldBlock: oldBlock,
        });
        changeIndices.push(allBlocks.length - 1);
      }
    });

    // Sort all blocks by their position (oldIndex or newIndex)
    allBlocks.sort((a, b) => {
      const aIndex = a.oldIndex ?? a.newIndex ?? -1;
      const bIndex = b.oldIndex ?? b.newIndex ?? -1;
      return aIndex - bIndex;
    });

    // Build final diff array with context
    const finalDiffs: BlockDiff[] = [];
    const includedIndices = new Set<number>();

    // Include all changed blocks and context around them
    changeIndices.forEach((changeIdx) => {
      const startIdx = Math.max(0, changeIdx - contextLines);
      const endIdx = Math.min(allBlocks.length - 1, changeIdx + contextLines);

      for (let i = startIdx; i <= endIdx; i++) {
        if (!includedIndices.has(i)) {
          const block = allBlocks[i];
          const blockDiff: BlockDiff = {
            type: block.type,
            blockType: (block.oldBlock || block.newBlock)?.type || "unknown",
            oldContent: block.oldBlock ? this.blockToText(block.oldBlock) : undefined,
            newContent: block.newBlock ? this.blockToText(block.newBlock) : undefined,
            oldBlock: block.oldBlock,
            newBlock: block.newBlock,
          };
          finalDiffs.push(blockDiff);
          includedIndices.add(i);
        }
      }
    });

    // If no changes, return empty array (or all blocks if needed)
    if (finalDiffs.length === 0 && allBlocks.length > 0) {
      // No changes detected, return empty
      return [];
    }

    return finalDiffs;
  }

  /**
   * Adds context blocks (unchanged blocks) around changes for better understanding
   * Similar to Git's diff context lines
   */
  static addContextBlocks(
    blockDiffs: BlockDiff[],
    oldContent: any,
    newContent: any,
    contextLines: number = 2
  ): BlockDiff[] {
    if (blockDiffs.length === 0) return [];

    const oldBlocks = this.extractBlocks(oldContent);
    const newBlocks = this.extractBlocks(newContent);
    const result: BlockDiff[] = [];
    const includedOldIndices = new Set<number>();
    const includedNewIndices = new Set<number>();

    // First, mark which blocks are already included
    blockDiffs.forEach((diff) => {
      // Find the indices of changed blocks
      if (diff.oldBlock) {
        const idx = oldBlocks.findIndex((b) => this.areBlocksEqual(b, diff.oldBlock));
        if (idx >= 0) includedOldIndices.add(idx);
      }
      if (diff.newBlock) {
        const idx = newBlocks.findIndex((b) => this.areBlocksEqual(b, diff.newBlock));
        if (idx >= 0) includedNewIndices.add(idx);
      }
    });

    // Build a map of all blocks with their positions
    const blockMap = new Map<string, { oldIdx?: number; newIdx?: number; block: any }>();
    
    oldBlocks.forEach((block, idx) => {
      const key = this.getBlockId(block, idx);
      if (!blockMap.has(key)) {
        blockMap.set(key, { oldIdx: idx, block });
      } else {
        blockMap.get(key)!.oldIdx = idx;
      }
    });

    newBlocks.forEach((block, idx) => {
      const key = this.getBlockId(block, idx);
      if (!blockMap.has(key)) {
        blockMap.set(key, { newIdx: idx, block });
      } else {
        blockMap.get(key)!.newIdx = idx;
      }
    });

    // For each change, add context blocks before and after
    blockDiffs.forEach((diff, diffIdx) => {
      // Find the position of this change
      let oldIdx = -1;
      let newIdx = -1;

      if (diff.oldBlock) {
        oldIdx = oldBlocks.findIndex((b) => this.areBlocksEqual(b, diff.oldBlock));
      }
      if (diff.newBlock) {
        newIdx = newBlocks.findIndex((b) => this.areBlocksEqual(b, diff.newBlock));
      }

      // Add context before
      if (diffIdx === 0 || result.length === 0 || result[result.length - 1].type !== "unchanged") {
        const contextStart = Math.max(0, Math.min(oldIdx >= 0 ? oldIdx : newIdx, newIdx >= 0 ? newIdx : oldIdx) - contextLines);
        const contextEnd = Math.min(oldIdx >= 0 ? oldIdx : newIdx, newIdx >= 0 ? newIdx : oldIdx);
        
        for (let i = contextStart; i < contextEnd; i++) {
          if (oldIdx >= 0 && i < oldBlocks.length && !includedOldIndices.has(i)) {
            const block = oldBlocks[i];
            const matchingNewIdx = newBlocks.findIndex((b) => this.areBlocksEqual(b, block));
            if (matchingNewIdx >= 0 && !includedNewIndices.has(matchingNewIdx)) {
              result.push({
                type: "unchanged",
                blockType: block.type || "unknown",
                oldContent: this.blockToText(block),
                newContent: this.blockToText(newBlocks[matchingNewIdx]),
                oldBlock: block,
                newBlock: newBlocks[matchingNewIdx],
              });
              includedOldIndices.add(i);
              includedNewIndices.add(matchingNewIdx);
            }
          }
        }
      }

      // Add the change itself
      result.push(diff);
      if (oldIdx >= 0) includedOldIndices.add(oldIdx);
      if (newIdx >= 0) includedNewIndices.add(newIdx);

      // Add context after
      const nextChangeIdx = diffIdx < blockDiffs.length - 1 ? 
        (() => {
          const next = blockDiffs[diffIdx + 1];
          if (next.oldBlock) {
            const idx = oldBlocks.findIndex((b) => this.areBlocksEqual(b, next.oldBlock));
            return idx >= 0 ? idx : (next.newBlock ? newBlocks.findIndex((b) => this.areBlocksEqual(b, next.newBlock)) : -1);
          }
          return next.newBlock ? newBlocks.findIndex((b) => this.areBlocksEqual(b, next.newBlock)) : -1;
        })() : -1;

      const contextStart = Math.max(0, Math.min(oldIdx >= 0 ? oldIdx : newIdx, newIdx >= 0 ? newIdx : oldIdx) + 1);
      const contextEnd = nextChangeIdx >= 0 
        ? Math.min(contextStart + contextLines, nextChangeIdx)
        : Math.min(contextStart + contextLines, Math.max(oldBlocks.length, newBlocks.length));

      for (let i = contextStart; i < contextEnd; i++) {
        if (oldIdx >= 0 && i < oldBlocks.length && !includedOldIndices.has(i)) {
          const block = oldBlocks[i];
          const matchingNewIdx = newBlocks.findIndex((b) => this.areBlocksEqual(b, block));
          if (matchingNewIdx >= 0 && !includedNewIndices.has(matchingNewIdx)) {
            result.push({
              type: "unchanged",
              blockType: block.type || "unknown",
              oldContent: this.blockToText(block),
              newContent: this.blockToText(newBlocks[matchingNewIdx]),
              oldBlock: block,
              newBlock: newBlocks[matchingNewIdx],
            });
            includedOldIndices.add(i);
            includedNewIndices.add(matchingNewIdx);
          }
        }
      }
    });

    return result.length > 0 ? result : blockDiffs;
  }
}
