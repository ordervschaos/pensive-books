import { RealtimePostgresChangesPayload } from "@supabase/supabase-js";

export interface PageChangePayload {
  new: {
    title: string | null;
    [key: string]: unknown;
  };
  old: {
    title: string | null;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface NavBreadcrumbProps {
  bookName: string;
  pageName: string;
  location: {
    pathname: string;
  };
  navigate: (to: number) => void;
}

export interface NavActionsProps {
  isAuthenticated: boolean;
  isBookRoute: boolean;
  theme: string;
  toggleTheme: () => void;
  handleLogout: () => void;
  handleLogin: () => void;
  setSearchOpen: (open: boolean) => void;
}

export interface NavTabsProps {
  isLibraryActive: boolean;
  isMyBooksActive: boolean;
} 