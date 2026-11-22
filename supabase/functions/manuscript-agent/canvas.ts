// The canvas is an anchor for "this page", not a boundary on what the agent may edit.
// Only ids and enum values cross from the browser; names come from the book's own rows.
export type ManuscriptCanvas = { kind: "book" } | { kind: "page"; pageId: number } | { kind: "add"; changeId: string };
export interface CanvasSnapshot { target: ManuscriptCanvas; label: string }

interface CanvasPage { id: number; page_index: number; title: string | null }
interface CanvasChange { id: string; kind: string; title?: string | null }

export function parseCanvas(value: unknown): ManuscriptCanvas | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (v.kind === "book") return { kind: "book" };
  if (v.kind === "page" && Number.isSafeInteger(v.pageId) && (v.pageId as number) > 0) return { kind: "page", pageId: v.pageId as number };
  if (v.kind === "add" && typeof v.changeId === "string" && v.changeId.length > 0 && v.changeId.length <= 100) return { kind: "add", changeId: v.changeId };
  return null;
}

/** `pages` must belong to the authorized book; `changes` must be its current proposals. */
export function canvasSnapshot(value: unknown, pages: CanvasPage[], changes: CanvasChange[]): CanvasSnapshot | null {
  const target = parseCanvas(value);
  if (!target) return null;
  if (target.kind === "book") return { target, label: "Book details" };
  if (target.kind === "page") {
    const page = pages.find((p) => p.id === target.pageId);
    return page ? { target, label: `p${page.page_index + 1} · ${page.title?.trim() || "Untitled"}` } : null;
  }
  const change = changes.find((c) => c.id === target.changeId && c.kind === "page_add");
  return change ? { target, label: `New page · ${change.title?.trim() || "Untitled"}` } : null;
}

// Kept in the transcript as a separate text block: replay sees the canvas as it was at send time.
// The task echo excludes this block; it is reference data, not part of the author's request.
export const CANVAS_CONTEXT_PREFIX = "Open beside the chat (reference only): ";
export function canvasContext(snapshot: CanvasSnapshot | null): string {
  if (!snapshot) return "";
  const { target, label } = snapshot;
  return CANVAS_CONTEXT_PREFIX + JSON.stringify({ ...target, label }) +
    (target.kind === "add" ? ". This is a proposed page, not yet part of the manuscript." : "");
}
