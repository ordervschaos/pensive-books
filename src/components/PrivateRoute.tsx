import { useEffect, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";

interface PrivateRouteProps {
  children: React.ReactNode;
}

export const PrivateRoute = ({ children }: PrivateRouteProps) => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [termsAccepted, setTermsAccepted] = useState<boolean>(false);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        // Check current auth status
        const { data: { session } } = await supabase.auth.getSession();
        console.log("Auth session check:", !!session);
        setIsAuthenticated(!!session);

        // Check terms acceptance from user metadata
        if (session?.user) {
          const { user_metadata } = session.user;
          setTermsAccepted(!!user_metadata?.terms_accepted);
        }

        setLoading(false);
      } catch (error) {
        console.error("Error in auth check:", error);
        setLoading(false);
      }
    };

    checkAuth();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log("Auth state change:", event, !!session);
      setIsAuthenticated(!!session);

      // Update terms acceptance state when auth changes
      if (session?.user) {
        const { user_metadata } = session.user;
        setTermsAccepted(!!user_metadata?.terms_accepted);
      } else {
        setTermsAccepted(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleAcceptTerms = async () => {
    try {
      const { data: { user }, error } = await supabase.auth.updateUser({
        data: { terms_accepted: true }
      });

      if (error) throw error;

      if (user) {
        setTermsAccepted(true);
      }
    } catch (error) {
      console.error("Error updating terms acceptance:", error);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  // Show nothing while checking auth status
  if (loading) {
    return null;
  }

  // If not authenticated, redirect to login
  if (!isAuthenticated) {
    console.log("Redirecting to auth for protected route");
    return <Navigate to="/auth" replace state={{ returnTo: window.location.pathname }} />;
  }

  // If authenticated but terms not accepted, show terms screen
  if (!termsAccepted) {
    return (
      <div className="container max-w-2xl mx-auto p-6">
        <Card>
          <CardHeader>
            <CardTitle>Accept Terms & Privacy Policy</CardTitle>
            <CardDescription>
              Please review and accept our terms to continue using Pensive
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="bg-muted p-4 rounded-lg">
              <p className="text-sm text-muted-foreground mb-3">
                By clicking Accept, you agree to our{" "}
                <Link to="/terms" className="text-primary hover:underline" target="_blank">
                  Terms of Service
                </Link>{" "}
                and{" "}
                <Link to="/privacy" className="text-primary hover:underline" target="_blank">
                  Privacy Policy
                </Link>
              </p>
              <ul className="text-sm list-disc pl-4 space-y-2">
                <li>Your content remains your own</li>
                <li>We protect your personal information</li>
                <li>You agree to use the service responsibly</li>
              </ul>
            </div>

            <div className="flex gap-4">
              <Button 
                className="flex-1" 
                onClick={handleAcceptTerms}
                variant="default"
              >
                Accept
              </Button>
              <Button 
                className="flex-1" 
                onClick={handleLogout}
                variant="outline"
              >
                Logout
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Render children if authenticated and terms accepted
  return <>{children}</>;
};