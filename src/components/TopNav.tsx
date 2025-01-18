import { useNavigate, useLocation, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { LogOut, Moon, Sun, ArrowLeft, Search, Settings, Maximize2, Library } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { useTheme } from "@/components/theme/ThemeProvider";
import { useEffect, useState } from "react";
import { 
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

export function TopNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const { theme, toggleTheme } = useTheme();
  const [bookName, setBookName] = useState<string>("");
  const [pageName, setPageName] = useState<string>("");

  const handleLogout = async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      
      toast({
        title: "Logged out successfully",
        description: "You have been logged out of your account"
      });
      
      navigate("/auth");
    } catch (error) {
      console.error("Logout error:", error);
      toast({
        variant: "destructive",
        title: "Error logging out",
        description: error instanceof Error ? error.message : "An error occurred while logging out"
      });
    }
  };

  useEffect(() => {
    const fetchDetails = async () => {
      const match = location.pathname.match(/\/book\/(\d+)(?:\/page\/(\d+))?/);
      if (match) {
        const [, bookId, pageId] = match;
        
        try {
          const { data: bookData, error: bookError } = await supabase
            .from("books")
            .select("name")
            .eq("id", parseInt(bookId))
            .single();

          if (bookError) throw bookError;
          setBookName(bookData?.name || "Untitled");

          if (pageId) {
            const { data: pageData, error: pageError } = await supabase
              .from("pages")
              .select("title")
              .eq("id", parseInt(pageId))
              .single();

            if (pageError) throw pageError;
            setPageName(pageData?.title || "Untitled");
          }
        } catch (error) {
          console.error("Error fetching details:", error);
        }
      }
    };

    // Set up real-time subscription for page title updates
    const match = location.pathname.match(/\/book\/(\d+)(?:\/page\/(\d+))?/);
    if (match && match[2]) { // If we have a page ID
      const pageId = parseInt(match[2]);
      
      const subscription = supabase
        .channel('page_changes')
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'pages',
            filter: `id=eq.${pageId}`
          },
          (payload: any) => {
            if (payload.new.title) {
              setPageName(payload.new.title);
            }
          }
        )
        .subscribe();

      // Fetch initial data
      fetchDetails();

      // Cleanup subscription
      return () => {
        subscription.unsubscribe();
      };
    } else {
      fetchDetails();
    }
  }, [location.pathname]);

  const isBookRoute = location.pathname.includes('/book/');
  const isPageRoute = location.pathname.includes('/page/');
  const showBackButton = location.pathname !== '/';

  return (
    <nav className="bg-background border-b h-14">
      <div className="container max-w-7xl mx-auto px-4 h-full">
        <div className="flex items-center justify-between h-full">
          <div className="flex items-center gap-4">
        
            
            {isBookRoute ? (
              <Breadcrumb>
                <BreadcrumbList className="flex items-center space-x-1">
                {showBackButton && (
                  <BreadcrumbItem className="flex items-center">
              <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
              </BreadcrumbItem>
            )}
                  <BreadcrumbItem className="flex items-center">
                  <Link 
                          className="text-blue-500 hover:text-blue-600 transition-colors font-medium" 
                          to={`/`}
                        >
                    <Library className="h-5 w-5 mr-2" /> <span className="mx-2 text-muted-foreground">›</span>
                    </Link>
                    {isPageRoute ? (
                      <>
                        <Link 
                          className="text-blue-500 hover:text-blue-600 transition-colors font-medium" 
                          to={`/book/${location.pathname.split('/')[2]}`}
                        >
                          {bookName}
                        </Link>
                        <span className="mx-2 text-muted-foreground">›</span>
                        <span className="text-foreground font-medium">
                          {pageName}
                        </span>
                      </>
                    ) : (
                      <span className="text-foreground font-medium">{bookName}</span>
                    )}
                  </BreadcrumbItem>
                </BreadcrumbList>
              </Breadcrumb>
            ) : (
              <span className="text-lg font-semibold text-foreground">Pensive</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon">
              <Search className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon">
              <Maximize2 className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon">
              <Settings className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={toggleTheme}>
              {theme === "light" ? (
                <Moon className="h-4 w-4" />
              ) : (
                <Sun className="h-4 w-4" />
              )}
            </Button>
            <Button variant="ghost" size="icon" onClick={handleLogout}>
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </nav>
  );
}
