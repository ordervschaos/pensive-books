/**
 * Type definitions for TipTap editor
 */

/**
 * TipTap JSON content structure
 * Represents the structured JSON format of editor content
 */
export interface EditorJSON {
  type: string;
  content?: EditorJSON[];
  attrs?: Record<string, unknown>;
  marks?: Array<{
    type: string;
    attrs?: Record<string, unknown>;
  }>;
  text?: string;
  [key: string]: unknown;
}

/**
 * Callback function for editor content changes
 * @param html - HTML string representation of the content
 * @param json - Structured JSON representation of the content (null when reverting to a version)
 */
export type EditorChangeHandler = (html: string, json: EditorJSON | null) => void;

/**
 * Callback for saving page content
 * Used in PageContent component
 */
export type PageSaveHandler = (json: EditorJSON | null) => void | Promise<void>;
