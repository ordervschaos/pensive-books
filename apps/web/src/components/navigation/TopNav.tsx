import { useNavigate, useLocation } from "react-router-dom";
import { supabase, hasSessionCookie } from "@/integrations/supabase/client";
import { useToast } from "@/components/ui/use-toast";
import { useState, useEffect } from "react";
import { TopNavShell, type TopNavTab } from "@pensive/shared/ui/top-nav";
import { SearchDialog } from "@/components/search/SearchDialog";
import { NavActions } from "./NavActions";
import { buildPublicUrl } from "@/utils/publicOrigin";

type NavMode = "full" | "compact";

function pickMode(pathname: string): NavMode {
  // The /books index is the writer's "desk" — full nav with tabs + search bar.
  // Everything else is a focused view of a single book or page → compact nav.
  if (pathname === "/" || pathname === "/books") return "full";
  return "compact";
}

function deslug(slug: string) {
  return slug
    .replace(/^\d+-/, "")
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function TopNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const [bookName, setBookName] = useState<string>("");
  const [pageName, setPageName] = useState<string>("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => hasSessionCookie());

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setIsAuthenticated(!!session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
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

  // Fetch the book name for the compact-mode crumb.
  useEffect(() => {
    let isSubscribed = true;

    const fetchBookDetails = async () => {
      const match = location.pathname.match(/\/books\/(\d+)/);
      const isNewBook = location.pathname.endsWith('/books/new');

      if (isNewBook) {
        setBookName("New Book");
        return;
      }

      if (!match) {
        setBookName("");
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

  // Page name fetch + realtime subscription.
  useEffect(() => {
    let isSubscribed = true;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const fetchPageDetails = async () => {
      const isVersionPage = location.pathname.includes('/version/');
      if (isVersionPage) {
        setPageName("");
        return;
      }

      const match = location.pathname.match(/\/pages\/(\d+)/);
      if (!match) {
        setPageName("");
        return;
      }

      const pageId = match[1];

      try {
        const { data: pageData, error } = await supabase
          .from("pages")
          .select("title")
          .eq("id", parseInt(pageId))
          .single();

        if (error) throw error;

        if (isSubscribed) {
          setPageName(pageData?.title || "Untitled");
        }

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

  const mode = pickMode(location.pathname);
  const isBookRoute = location.pathname.includes('/books/');
  const onMyBooks = location.pathname === "/books" || location.pathname === "/";

  // Intercept same-origin links so navigation stays client-side.
  const intercept = (path: string) =>
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      e.preventDefault();
      navigate(path);
    };

  const actions = (
    <NavActions
      isAuthenticated={isAuthenticated}
      isBookRoute={isBookRoute}
      handleLogout={handleLogout}
      handleLogin={handleLogin}
      setSearchOpen={setSearchOpen}
    />
  );

  return (
    <>
      {mode === "full" ? (
        <TopNavShell
          mode="full"
          logoHref="/books"
          onLogoClick={intercept("/books")}
          tabs={[
            {
              label: "My Books",
              href: "/books",
              active: onMyBooks,
              onClick: intercept("/books"),
            } satisfies TopNavTab,
            {
              label: "Library",
              href: buildPublicUrl("/library"),
              active: false,
            } satisfies TopNavTab,
          ]}
          search={{
            placeholder: "Search your books, pages, drafts…",
            shortcut: "⌘K",
            onClick: () => setSearchOpen(true),
          }}
          actions={actions}
        />
      ) : (
        <TopNavShell
          mode="compact"
          logoHref="/books"
          onLogoClick={intercept("/books")}
          crumb={buildCrumb(location.pathname, bookName, pageName)}
          actions={actions}
        />
      )}

      <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
    </>
  );
}

function buildCrumb(pathname: string, bookName: string, pageName: string) {
  if (pathname.endsWith("/books/new")) {
    return "My Books  /  New Book";
  }
  if (pathname.endsWith("/edit")) {
    return `My Books  /  ${bookName || deslug(pathname.split("/")[2] ?? "")}  /  Edit`;
  }
  if (pageName) {
    return `${bookName || ""}  /  ${pageName}`;
  }
  if (bookName) {
    return `My Books  /  ${bookName}`;
  }
  return "My Books";
}
