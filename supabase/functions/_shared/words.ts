// Word counting + cumulative offsets over TipTap JSON — the server twin of the client's
// cumulativeWordOffsets (apps/web/src/utils/tiptapHelpers.ts). Used by scan-threads to measure
// foreshadowing DISTANCE: cumulative words before a page begins, so the gap between a setup and
// its payoff is a subtraction. Kept dependency-free (plain tree walk) for the Deno runtime.

export interface PageLike {
  id: number;
  page_type?: string | null;
  content?: unknown;
}

export interface PageWordPosition {
  /** Manuscript words BEFORE this page begins. */
  start: number;
  /** This page's own word count (0 for non-text or empty pages). */
  count: number;
}

/** Flatten a TipTap JSON node to plain text (block nodes separated by blank lines). */
export function tiptapToText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as { type?: string; text?: string; content?: unknown[] };
  if (n.type === "text") return n.text ?? "";
  if (n.type === "hardBreak") return "\n";
  let out = "";
  for (const child of n.content ?? []) out += tiptapToText(child);
  if (["paragraph", "heading", "blockquote", "listItem", "codeBlock"].includes(n.type ?? "")) out += "\n\n";
  return out;
}

/** Word count of a TipTap JSON document. */
export function wordCount(content: unknown): number {
  const text = tiptapToText(content).trim();
  if (!text) return 0;
  return text.split(/\s+/).length;
}

/**
 * Cumulative word offsets across an ordered list of pages. Only `text` pages contribute to the
 * running total; section/other pages get count 0 and carry the current offset forward. Pages
 * MUST already be in reading (page_index) order.
 */
export function cumulativeWordOffsets<T extends PageLike>(
  pages: T[]
): { positions: Map<number, PageWordPosition>; total: number } {
  const positions = new Map<number, PageWordPosition>();
  let running = 0;
  for (const page of pages) {
    const count = page.page_type === "text" && page.content ? wordCount(page.content) : 0;
    positions.set(page.id, { start: running, count });
    running += count;
  }
  return { positions, total: running };
}
