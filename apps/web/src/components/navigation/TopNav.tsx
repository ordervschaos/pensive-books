import { useNavigate, useLocation } from "react-router-dom";
import { supabase, hasSessionCookie } from "@/integrations/supabase/client";
import { useToast } from "@/components/ui/use-toast";
import { useTheme } from "@/components/theme/ThemeProvider";
import { useState, useEffect } from "react";
import { SearchDialog } from "@/components/search/SearchDialog";
import { NavBreadcrumb } from "./NavBreadcrumb";
import { NavActions } from "./NavActions";
import { NavTabs } from "./NavTabs";
import { PageChangePayload } from "./types";

export function TopNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const [bookName, setBookName] = useState<string>("");
  const [pageName, setPageName] = useState<string>("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => hasSessionCookie());

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
      await supabase.auth.signOut();
    } catch (error) {
      console.error("Logout error:", error);
    } finally {
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
      // Extract numeric ID from slug (e.g., "884-digest-nov" -> "884")
      const match = location.pathname.match(/\/books\/(\d+)/);
      const isNewBook = location.pathname.endsWith('/books/new');

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
      // Skip fetching page details for version pages (they use page_index, not page ID)
      const isVersionPage = location.pathname.includes('/version/');
      if (isVersionPage) {
        setPageName(""); // Clear page name for version pages
        return;
      }

      // Extract numeric page ID from slug (e.g., "123-page-title" -> "123")
      const match = location.pathname.match(/\/pages\/(\d+)/);
      
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
            (payload) => {
              const typedPayload = payload as unknown as { new: { title: string | null } };
              if (isSubscribed && typedPayload.new && 'title' in typedPayload.new) {
                setPageName(typedPayload.new.title || "Untitled");
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

  const isBookRoute = location.pathname.includes('/books/');

  return (
    <>
      <nav className="bg-background border-b h-14">
        <div className="container max-w-7xl mx-auto px-4 h-full">
          <div className="flex flex-row items-center h-full justify-between">
            <div className="flex-1 flex min-w-0">
              <NavBreadcrumb
                bookName={bookName}
                pageName={pageName}
                location={location}
                navigate={navigate}
              />
            </div>

            <NavActions
              isAuthenticated={isAuthenticated}
              isBookRoute={isBookRoute}
              handleLogout={handleLogout}
              handleLogin={handleLogin}
              setSearchOpen={setSearchOpen}
            />
          </div>
        </div>

        <SearchDialog
          open={searchOpen}
          onOpenChange={setSearchOpen}
        />
      </nav>
      <NavTabs />
    </>
  );
}