import { RealtimePostgresChangesPayload } from "@supabase/supabase-js";

export interface PageChangePayload {
  new: {
    title: string | null;
    [key: string]: any;
  };
  old: {
    title: string | null;
    [key: string]: any;
  };
  [key: string]: any;
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