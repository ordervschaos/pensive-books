import { useEffect, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageNotFound } from "@/components/page/PageNotFound";

interface PrivateRouteProps {
  children: React.ReactNode;
}

export const PrivateRoute = ({ children }: PrivateRouteProps) => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [isPublicBook, setIsPublicBook] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const { id: bookId } = useParams();

  useEffect(() => {
    const checkAuth = async () => {
      try {
        // Check current auth status
        const { data: { session } } = await supabase.auth.getSession();
        console.log("Auth session check:", !!session);
        setIsAuthenticated(!!session);

        // If we're on a book route, check if it's public
        if (bookId) {
          console.log("Checking if book is public:", bookId);
          const { data: book, error } = await supabase
            .from("books")
            .select("is_public")
            .eq("id", bookId)
            .single();

          if (error) {
            console.error("Error checking book visibility:", error);
            setIsPublicBook(false);
          } else {
            console.log("Book public status:", book?.is_public);
            setIsPublicBook(book?.is_public || false);
          }
        }

        setLoading(false);
      } catch (error) {
        console.error("Error in auth check:", error);
        setLoading(false);
      }
    };

    checkAuth();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log("Auth state change:", event, !!session);
      setIsAuthenticated(!!session);
    });

    return () => subscription.unsubscribe();
  }, [bookId]);

  // Show nothing while checking auth status
  if (loading) {
    return null;
  }

  // If it's a book route and the book is public, allow access
  if (bookId && isPublicBook) {
    return <>{children}</>;
  }

  // If not authenticated and not a public book, redirect to login or show not found
  if (!isAuthenticated) {
    if (bookId) {
      // If it's a book route but not public, show not found
      return <PageNotFound bookId={bookId} />;
    }
    // For non-book routes, redirect to auth
    return <Navigate to="/auth" replace state={{ returnTo: window.location.pathname }} />;
  }

  // Render children if authenticated
  return <>{children}</>;
};