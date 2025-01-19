import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { Toaster } from "@/components/ui/toaster";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import Index from "@/pages/Index";
import Auth from "@/pages/Auth";
import BookDetails from "@/pages/BookDetails";
import BookEdit from "@/pages/BookEdit";
import NewBook from "@/pages/NewBook";
import PageView from "@/pages/PageView";
import AcceptInvitation from "@/pages/AcceptInvitation";

// Protected Route wrapper component
const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

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

  // Show nothing while checking auth status
  if (isAuthenticated === null) {
    return null;
  }

  // Redirect to login if not authenticated
  if (!isAuthenticated) {
    return <Navigate to="/auth" replace state={{ returnTo: window.location.pathname }} />;
  }

  return <>{children}</>;
};

function App() {
  return (
    <ThemeProvider defaultTheme="light">
      <Router>
        <Routes>
          <Route path="/auth" element={<Auth />} />
          <Route path="/" element={
            <ProtectedRoute>
              <Index />
            </ProtectedRoute>
          } />
          <Route path="/book/new" element={
            <ProtectedRoute>
              <NewBook />
            </ProtectedRoute>
          } />
          <Route path="/book/:id" element={
            <ProtectedRoute>
              <BookDetails />
            </ProtectedRoute>
          } />
          <Route path="/book/:id/edit" element={
            <ProtectedRoute>
              <BookEdit />
            </ProtectedRoute>
          } />
          <Route path="/book/:bookId/page/:pageId" element={
            <ProtectedRoute>
              <PageView />
            </ProtectedRoute>
          } />
          <Route path="/accept-invitation" element={
            <ProtectedRoute>
              <AcceptInvitation />
            </ProtectedRoute>
          } />
        </Routes>
      </Router>
      <Toaster />
    </ThemeProvider>
  );
}

export default App;