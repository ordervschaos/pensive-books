import { useState, useEffect } from "react";
import { LogOut, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";

interface PageViewSettingsProps {
  onSearchOpen?: () => void;
}

export function PageViewSettings({ onSearchOpen }: PageViewSettingsProps) {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const navigate = useNavigate();

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

  return (
    <div className="fixed top-2 right-12 z-50 flex items-center gap-1">
      {isAuthenticated ? (
        <Button variant="ghost" size="icon" onClick={handleLogout} className="h-8 w-8 hover:bg-accent/50">
          <LogOut className="h-4 w-4 opacity-60 hover:opacity-100 transition-opacity" />
        </Button>
      ) : (
        <Button variant="ghost" size="icon" onClick={handleLogin} className="h-8 w-8 hover:bg-accent/50">
          <LogIn className="h-4 w-4 opacity-60 hover:opacity-100 transition-opacity" />
        </Button>
      )}
    </div>
  );
}
