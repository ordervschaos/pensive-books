import { useNavigate, useLocation, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { LogOut, LogIn, Moon, Sun, ArrowLeft, Search, Store, Library, MoreVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { useTheme } from "@/components/theme/ThemeProvider";
import { useEffect, useState } from "react";
import { SearchDialog } from "@/components/search/SearchDialog";
import { 
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
} from "@/components/ui/breadcrumb";
import { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface PageChangePayload {
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

export function TopNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const { theme, toggleTheme } = useTheme();
  const [bookName, setBookName] = useState<string>("");
  const [pageName, setPageName] = useState<string>("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);

  useEffect(() => {
    // Check current auth status
    supabase.auth.getSession().then(({ data: { session } }) => {
      setIsAuthenticated(!!session);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setIsAuthenticated(!!session);
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleLogout = async () => {
    try {
      setIsAuthenticated(false);

      // Try local signout
      try {
        await supabase.auth.signOut();
      } catch (e) {
        console.warn("Signout failed:", e);
      }

      // Clear any remaining auth state immediately
      const key = Object.keys(localStorage).find(key => key.startsWith('sb-') && key.endsWith('-auth-token'));
      if (key) {
        localStorage.removeItem(key);
      }
      
      // Use the correct URL based on environment
      const isProd = window.location.hostname === "pensive.me";
      const baseUrl = isProd ? "https://pensive.me" : "";
      window.location.href = `${baseUrl}/auth`;

    } catch (error) {
      console.error("Logout error:", error);
      
      // Force clear local storage and reload on error
      const key = Object.keys(localStorage).find(key => key.startsWith('sb-') && key.endsWith('-auth-token'));
      if (key) {
        localStorage.removeItem(key);
      }
      
      // Use the correct URL based on environment
      const isProd = window.location.hostname === "pensive.me";
      const baseUrl = isProd ? "https://pensive.me" : "";
      window.location.href = `${baseUrl}/auth`;
    }
  };

  const handleLogin = () => {
    navigate("/auth");
  };

  // Effect for fetching book details
  useEffect(() => {
    let isSubscribed = true;

    const fetchBookDetails = async () => {
      const match = location.pathname.match(/\/book\/(\d+)/);
      const isNewBook = location.pathname.endsWith('/book/new');

      if (isNewBook) {
        setBookName("New Book");
        return;
      }
      
      if (!match) {
        setBookName(""); // Only reset if not on a book route
        return;
      }

      const bookId = match[1];

      try {
        const { data: bookData, error } = await supabase
          .from("books")
          .select("name")
          .eq("id", parseInt(bookId))
          .single();

        if (error) throw error;
        
        if (isSubscribed) {
          setBookName(bookData?.name || "Untitled");
        }
      } catch (error) {
        console.error("Error fetching book:", error);
        if (isSubscribed) {
          toast({
            variant: "destructive",
            title: "Error",
            description: "Failed to load book details"
          });
        }
      }
    };

    fetchBookDetails();
    return () => { isSubscribed = false; };
  }, [location.pathname, toast]);

  // Separate effect for fetching and subscribing to page details
  useEffect(() => {
    let isSubscribed = true;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const fetchPageDetails = async () => {
      const match = location.pathname.match(/\/page\/(\d+)/);
      
      if (!match) {
        setPageName(""); // Only reset if not on a page route
        return;
      }

      const pageId = match[1];

      try {
        // Fetch initial page data
        const { data: pageData, error } = await supabase
          .from("pages")
          .select("title")
          .eq("id", parseInt(pageId))
          .single();

        if (error) throw error;

        if (isSubscribed) {
          setPageName(pageData?.title || "Untitled");
        }

        // Set up real-time subscription
        channel = supabase
          .channel(`page_changes_${pageId}`)
          .on(
            'postgres_changes',
            {
              event: 'UPDATE',
              schema: 'public',
              table: 'pages',
              filter: `id=eq.${pageId}`
            },
            (payload: RealtimePostgresChangesPayload<PageChangePayload>) => {
              if (isSubscribed && payload.new && 'title' in payload.new) {
                setPageName(payload.new.title || "Untitled");
              }
            }
          )
          .subscribe();

      } catch (error) {
        console.error("Error fetching page:", error);
        if (isSubscribed) {
          toast({
            variant: "destructive",
            title: "Error",
            description: "Failed to load page details"
          });
        }
      }
    };

    fetchPageDetails();

    return () => {
      isSubscribed = false;
      if (channel) {
        channel.unsubscribe();
      }
    };
  }, [location.pathname, toast]);

  const isBookRoute = location.pathname.includes('/book/');
  const isPageRoute = location.pathname.includes('/page/');
  const isBookEditRoute = location.pathname.endsWith('/edit');
  const isNewBookRoute = location.pathname.endsWith('/book/new');
  const showBackButton = location.pathname !== '/';
  const showLibraryLink = !isBookRoute && !isPageRoute;

  return (
    <nav className="bg-background border-b h-14">
      <div className="container max-w-7xl mx-auto px-4 h-full">
        <div className="flex flex-row items-center justify-between h-full gap-4">
          <div className="flex flex-row items-center gap-2 min-w-0 flex-1">
            {isBookRoute ? (
              <Breadcrumb>
                <BreadcrumbList className="flex flex-row items-center space-x-1 min-w-0">
                  {showBackButton && (
                    <BreadcrumbItem className="shrink-0">
                      <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
                        <ArrowLeft className="h-4 w-4" />
                      </Button>
                    </BreadcrumbItem>
                  )}
                  <BreadcrumbItem className="flex items-center min-w-0">
                    <Link 
                      className="text-blue-500 hover:text-blue-600  transition-colors font-medium shrink-0" 
                      to={`/my-books`}
                    >
                      <Library className="h-5 w-5" />
                    </Link>
                    <span className="mx-2 text-muted-foreground shrink-0">›</span>
                    {isPageRoute ? (
                      <>
                        <Link 
                          className="text-blue-500 hover:text-blue-600 transition-colors font-medium truncate max-w-[120px] md:max-w-[200px]"
                          to={`/book/${location.pathname.split('/')[2]}`}
                        >
                          {bookName}
                        </Link>
                        <span className="mx-2 text-muted-foreground shrink-0">›</span>
                        <span className="text-foreground font-medium truncate max-w-[120px] md:max-w-[200px]">
                          {pageName}
                        </span>
                      </>
                    ) : (
                      <>
                        {isBookEditRoute ? (
                          <>
                            <Link 
                              className="text-blue-500 hover:text-blue-600 transition-colors font-medium truncate max-w-[300px]"
                              to={`/book/${location.pathname.split('/')[2]}`}
                            >
                              {bookName}
                            </Link>
                            <span className="mx-2 text-muted-foreground shrink-0">›</span>
                            <span className="text-foreground font-medium">Edit Book</span>
                          </>
                        ) : isNewBookRoute ? (
                          <span className="text-foreground font-medium">New Book</span>
                        ) : (
                          <span className="text-foreground font-medium truncate max-w-[300px]">{bookName}</span>
                        )}
                      </>
                    )}
                  </BreadcrumbItem>
                </BreadcrumbList>
              </Breadcrumb>
            ) : (
              <Link to={`/`}>
                <span className="text-lg font-semibold text-foreground">Pensive</span>
              </Link>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {showLibraryLink && (
              <Link 
                to="/library" 
                className="hidden sm:flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
              >
                <Store className="h-4 w-4" />
                <span>Library</span>
              </Link>
            )}

            {/* Desktop buttons */}
            <div className="hidden sm:flex items-center gap-2">
              {isBookRoute && (
                <Button variant="ghost" size="icon" onClick={() => setSearchOpen(true)}>
                  <Search className="h-4 w-4" />
                </Button>
              )}
              <Button variant="ghost" size="icon" onClick={toggleTheme}>
                {theme === "light" ? (
                  <Moon className="h-4 w-4" />
                ) : (
                  <Sun className="h-4 w-4" />
                )}
              </Button> 
              {isAuthenticated ? (
                <Button variant="ghost" size="icon" onClick={handleLogout}>
                  <LogOut className="h-4 w-4" />
                </Button>
              ) : (
                <Button variant="ghost" size="icon" onClick={handleLogin}>
                  <LogIn className="h-4 w-4" />
                </Button>
              )}
            </div>

            {/* Mobile menu */}
            <div className="sm:hidden">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {showLibraryLink && (
                    <DropdownMenuItem asChild>
                      <Link to="/library" className="flex items-center gap-2 w-full">
                        <Store className="h-4 w-4" />
                        <span>Library</span>
                      </Link>
                    </DropdownMenuItem>
                  )}
                  {isBookRoute && (
                    <DropdownMenuItem onClick={() => setSearchOpen(true)}>
                      <Search className="h-4 w-4 mr-2" />
                      <span>Search</span>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={toggleTheme}>
                    {theme === "light" ? (
                      <>
                        <Moon className="h-4 w-4 mr-2" />
                        <span>Dark mode</span>
                      </>
                    ) : (
                      <>
                        <Sun className="h-4 w-4 mr-2" />
                        <span>Light mode</span>
                      </>
                    )}
                  </DropdownMenuItem>
                  {isAuthenticated ? (
                    <DropdownMenuItem onClick={handleLogout}>
                      <LogOut className="h-4 w-4 mr-2" />
                      <span>Logout</span>
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem onClick={handleLogin}>
                      <LogIn className="h-4 w-4 mr-2" />
                      <span>Login</span>
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </div>

      <SearchDialog 
        open={searchOpen} 
        onOpenChange={setSearchOpen}
      />
    </nav>
  );
}
