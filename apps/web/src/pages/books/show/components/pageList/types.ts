import type { ReactNode } from "react";
import type { EditorJSON } from "@/types/editor";

export interface Page {
  id: number;
  page_index: number;
  updated_at: string;
  title: string;
  content?: EditorJSON | null;
  page_type: 'text' | 'section';
  metadata?: { objective?: string } | null;
}

export interface PagesListProps {
  pages: Page[];
  bookId: number;
  isReorderMode?: boolean;
  isDeleteMode?: boolean;
  canEdit?: boolean;
  onDeleteModeChange?: (isDelete: boolean) => void;
  /** Manuscript word count shown in the section header (text pages only). */
  wordCount?: number;
  /** Save-version control rendered in the manuscript header (editors only). */
  versionControl?: ReactNode;
}

export interface PageItemProps {
  page: Page;
  bookId: number;
  onNavigate: (pageId: number) => void;
  onDelete?: (pageId: number) => void;
  isBookmarked?: boolean;
  sectionNumber?: number;
  /** For section rows: aggregate of the text pages that fall under this chapter. */
  sectionMeta?: { pages: number; words: number };
  /** Contiguous 1-based position among text pages only (chapters/sections don't consume a number). */
  displayNumber?: number;
  /** List view: render section headings flat (no chapter spacing) vs. the roomier Outline view. */
  flat?: boolean;
}

export const LOCALSTORAGE_BOOKMARKS_KEY = 'bookmarked_pages'; 
