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
        const { data: { session } } = await supabase.auth.getSession();
        console.log("Auth session check:", !!session);
        setIsAuthenticated(!!session);

        if (bookId) {
          console.log("Checking if book is public:", bookId);
          const { data: book, error } = await supabase
            .from("books")
            .select("is_public")
            .eq("id", parseInt(bookId))
            .maybeSingle();

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

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log("Auth state change:", event, !!session);
      setIsAuthenticated(!!session);
    });

    return () => subscription.unsubscribe();
  }, [bookId]);

  if (loading) {
    return null;
  }

  if (bookId && isPublicBook) {
    return <>{children}</>;
  }

  if (!isAuthenticated) {
    if (bookId) {
      return <PageNotFound bookId={bookId} />;
    }
    return <Navigate to="/auth" replace state={{ returnTo: window.location.pathname }} />;
  }

  return <>{children}</>;
};