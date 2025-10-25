import { Link, useNavigate, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft, BookOpen, Library, Moon, Sun } from "lucide-react";
import { useTheme } from "@/components/theme/ThemeProvider";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { SlugService } from "@/utils/slugService";

/**
 * LibraryNav - Navigation bar for public library pages (/library namespace)
 * Simpler than the main app nav, designed for public content consumption
 */
export function LibraryNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const { theme, toggleTheme } = useTheme();
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [userEmail, setUserEmail] = useState<string>("");
  const [bookName, setBookName] = useState<string>("");
  const [pageName, setPageName] = useState<string>("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setIsAuthenticated(!!session);
      setUserEmail(session?.user?.email || "");
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setIsAuthenticated(!!session);
      setUserEmail(session?.user?.email || "");
    });

    return () => subscription.unsubscribe();
  }, []);

  // Fetch book and page names for breadcrumbs
  useEffect(() => {
    const bookMatch = location.pathname.match(/\/library\/book\/([^/]+)/);
    const pageMatch = location.pathname.match(/\/library\/book\/[^/]+\/page\/([^/]+)/);

    if (bookMatch) {
      const bookIdSlug = bookMatch[1];
      const bookId = SlugService.extractId(bookIdSlug);

      supabase
        .from("books")
        .select("name")
        .eq("id", bookId)
        .single()
        .then(({ data, error }) => {
          if (!error && data) {
            setBookName(data.name || "Untitled Book");
          }
        });
    } else {
      setBookName("");
    }

    if (pageMatch) {
      const pageIdSlug = pageMatch[1];
      const pageId = SlugService.extractId(pageIdSlug);

      supabase
        .from("pages")
        .select("title")
        .eq("id", pageId)
        .single()
        .then(({ data, error }) => {
          if (!error && data) {
            setPageName(data.title || "Untitled Page");
          }
        });
    } else {
      setPageName("");
    }
  }, [location.pathname]);

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
      const key = Object.keys(localStorage).find(key => key.startsWith('sb-') && key.endsWith('-auth-token'));
      if (key) {
        localStorage.removeItem(key);
      }
      navigate("/auth");
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  // Determine breadcrumb based on current route
  const isLibraryHome = location.pathname === '/library';
  const isBookDetails = location.pathname.match(/^\/library\/book\/[^/]+$/);
  const isPageView = location.pathname.match(/^\/library\/book\/[^/]+\/page\/[^/]+$/);

  // Extract bookId from URL for book link
  const bookMatch = location.pathname.match(/\/library\/book\/([^/]+)/);
  const bookIdSlug = bookMatch ? bookMatch[1] : "";

  return (
    <nav className="bg-background border-b h-14 sticky top-0 z-50">
      <div className="container max-w-7xl mx-auto px-4 h-full">
        <div className="flex items-center justify-between h-full">
          {/* Left: Pensive logo + Breadcrumbs */}
          <div className="flex items-center gap-2 min-w-0">
            {/* Pensive Logo */}
            <Link
              to="/"
              className="text-lg font-semibold text-foreground hover:opacity-80 transition-opacity flex-shrink-0"
            >
              Pensive
            </Link>

            {/* Separator */}
            <span className="text-muted-foreground">›</span>

            {/* Library Link */}
            <Link
              to="/library"
              className="flex items-center gap-1.5 hover:text-blue-500 transition-colors flex-shrink-0"
            >
              <Library className="h-4 w-4" />
              <span className="text-sm font-medium hidden sm:inline">
                Library
              </span>
            </Link>

            {/* Book Name (if on book or page) */}
            {(isBookDetails || isPageView) && bookName && (
              <>
                <span className="text-muted-foreground hidden sm:inline">›</span>
                {isPageView ? (
                  <Link
                    to={`/library/book/${bookIdSlug}`}
                    className="text-sm font-medium text-blue-500 hover:text-blue-600 transition-colors truncate max-w-[150px] md:max-w-[250px] hidden sm:inline"
                    title={bookName}
                  >
                    {bookName}
                  </Link>
                ) : (
                  <span className="text-sm font-medium text-foreground truncate max-w-[150px] md:max-w-[300px] hidden sm:inline" title={bookName}>
                    {bookName}
                  </span>
                )}
              </>
            )}

            {/* Page Name (if on page) */}
            {isPageView && pageName && (
              <>
                <span className="text-muted-foreground hidden sm:inline">›</span>
                <span className="text-sm font-medium text-foreground truncate max-w-[120px] md:max-w-[200px] hidden sm:inline" title={pageName}>
                  {pageName}
                </span>
              </>
            )}
          </div>

          {/* Right: Theme toggle + Auth actions */}
          <div className="flex items-center gap-2">
            {/* Theme Toggle */}
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleTheme}
            >
              {theme === "dark" ? (
                <Sun className="h-4 w-4" />
              ) : (
                <Moon className="h-4 w-4" />
              )}
            </Button>

            {/* Auth Section */}
            {isAuthenticated ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="rounded-full">
                    <Avatar className="h-8 w-8">
                      <AvatarFallback className="text-xs">
                        {userEmail.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">
                    {userEmail}
                  </div>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => navigate("/my-books")}>
                    <BookOpen className="h-4 w-4 mr-2" />
                    My Books
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleLogout}>
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Button
                variant="default"
                size="sm"
                onClick={() => navigate("/auth")}
              >
                Sign in
              </Button>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
