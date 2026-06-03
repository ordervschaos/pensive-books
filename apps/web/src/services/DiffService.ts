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
   * Rough similarity between two strings (Jaccard over word sets, 0..1). Used to
   * pair a reworded paragraph with its counterpart when aligning block changes.
   */
  static textSimilarity(t1: string, t2: string): number {
    const w1 = new Set(t1.toLowerCase().split(/\s+/).filter(Boolean));
    const w2 = new Set(t2.toLowerCase().split(/\s+/).filter(Boolean));
    if (w1.size === 0 && w2.size === 0) return 1;
    if (w1.size === 0 || w2.size === 0) return 0;
    let inter = 0;
    for (const w of w1) if (w2.has(w)) inter++;
    return inter / (w1.size + w2.size - inter);
  }

  /**
   * Signature of a block's inline formatting (marks per text run). Used to detect
   * formatting-only changes between two blocks whose plain text is identical.
   */
  static blockInlineSignature(block: any): string {
    const runs: string[] = [];
    const walk = (nodes: any[]) => {
      for (const n of nodes || []) {
        if (n?.type === "text") {
          runs.push(`${n.text || ""}${(n.marks || []).map((m: any) => m.type).sort().join(",")}`);
        } else if (n?.content) {
          walk(n.content);
        }
      }
    };
    walk(block?.content || []);
    return runs.join("");
  }

  /**
   * Content key used to align blocks across versions. Ignores marks so a block is
   * matched to its counterpart by text/type even if formatting changed; mark
   * differences are then surfaced as "modified" via blockInlineSignature.
   */
  static blockMatchKey(block: any): string {
    const level = block?.attrs?.level ?? "";
    return `${block?.type || "unknown"}${level}${this.blockToText(block)}`;
  }

  /**
   * Compares blocks between two versions and generates block-level diffs.
   *
   * Alignment uses a Longest-Common-Subsequence over block content keys, so
   * inserting/deleting/reordering blocks no longer shifts every later block out
   * of alignment (the previous positional matching compared block N against
   * block N, which broke as soon as a block was added). Adjacent deleted/inserted
   * blocks at the same spot are paired into a single "modified" entry so the
   * word-level diff can highlight what actually changed within them.
   * Unchanged blocks are kept only within `contextLines` of a change.
   */
  static compareBlocks(oldContent: any, newContent: any, contextLines: number = 2): BlockDiff[] {
    const oldBlocks = this.extractBlocks(oldContent);
    const newBlocks = this.extractBlocks(newContent);

    const changeIndices: number[] = [];
    const allBlocks: Array<{
      type: BlockChangeType;
      oldBlock?: any;
      newBlock?: any;
    }> = [];

    // --- Block-level LCS alignment by content key ---
    const a = oldBlocks.map((b) => this.blockMatchKey(b));
    const b = newBlocks.map((bl) => this.blockMatchKey(bl));
    const n = a.length;
    const m = b.length;
    const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }

    // Walk the alignment into a sequence of equal / del / ins steps.
    type Step = { op: "equal" | "del" | "ins"; oldBlock?: any; newBlock?: any };
    const steps: Step[] = [];
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) {
        steps.push({ op: "equal", oldBlock: oldBlocks[i], newBlock: newBlocks[j] });
        i++;
        j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        steps.push({ op: "del", oldBlock: oldBlocks[i] });
        i++;
      } else {
        steps.push({ op: "ins", newBlock: newBlocks[j] });
        j++;
      }
    }
    while (i < n) steps.push({ op: "del", oldBlock: oldBlocks[i++] });
    while (j < m) steps.push({ op: "ins", newBlock: newBlocks[j++] });

    // Collapse the steps into ordered diff entries, pairing each run of adjacent
    // deletions+insertions into "modified" entries (a replaced paragraph).
    const pushEntry = (entry: { type: BlockChangeType; oldBlock?: any; newBlock?: any }) => {
      allBlocks.push(entry);
      if (entry.type !== "unchanged") changeIndices.push(allBlocks.length - 1);
    };

    let k = 0;
    while (k < steps.length) {
      const step = steps[k];
      if (step.op === "equal") {
        // Same text — but flag mark-only changes as modified so they're visible.
        const formattingChanged =
          this.blockInlineSignature(step.oldBlock) !== this.blockInlineSignature(step.newBlock);
        pushEntry({
          type: formattingChanged ? "modified" : "unchanged",
          oldBlock: step.oldBlock,
          newBlock: step.newBlock,
        });
        k++;
        continue;
      }

      // Gather a contiguous run of dels and ins.
      const dels: any[] = [];
      const ins: any[] = [];
      while (k < steps.length && steps[k].op !== "equal") {
        if (steps[k].op === "del") dels.push(steps[k].oldBlock);
        else ins.push(steps[k].newBlock);
        k++;
      }

      // Pair a deleted block with the most similar inserted block (so a reworded
      // paragraph is matched to its counterpart, not just by position). Anything
      // left unpaired is a pure removal / addition.
      const usedIns = new Set<number>();
      for (let di = 0; di < dels.length; di++) {
        let bestIdx = -1;
        let bestScore = 0;
        for (let ii = 0; ii < ins.length; ii++) {
          if (usedIns.has(ii)) continue;
          const score = this.textSimilarity(this.blockToText(dels[di]), this.blockToText(ins[ii]));
          if (score > bestScore) {
            bestScore = score;
            bestIdx = ii;
          }
        }
        if (bestIdx >= 0 && bestScore >= 0.25) {
          usedIns.add(bestIdx);
          pushEntry({ type: "modified", oldBlock: dels[di], newBlock: ins[bestIdx] });
        } else {
          pushEntry({ type: "removed", oldBlock: dels[di] });
        }
      }
      for (let ii = 0; ii < ins.length; ii++) {
        if (!usedIns.has(ii)) pushEntry({ type: "added", newBlock: ins[ii] });
      }
    }

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

}
