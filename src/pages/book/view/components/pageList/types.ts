export interface Page {
  id: number;
  page_index: number;
  updated_at: string;
  title: string;
  content?: any; // TipTap JSON content
  page_type: 'text' | 'section';
}

export interface PagesListProps {
  pages: Page[];
  bookId: number;
  isReorderMode?: boolean;
  isDeleteMode?: boolean;
  canEdit?: boolean;
  onDeleteModeChange?: (isDelete: boolean) => void;
  onChatToggle?: () => void;
  hasActiveChat?: boolean;
}

export interface PageItemProps {
  page: Page;
  bookId: number;
  onNavigate: (pageId: number) => void;
  onDelete?: (pageId: number) => void;
  isBookmarked?: boolean;
}

export const LOCALSTORAGE_BOOKMARKS_KEY = 'bookmarked_pages'; 