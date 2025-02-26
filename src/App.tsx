import { BrowserRouter as Router, Routes, Route, useLocation } from "react-router-dom";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { Toaster } from "@/components/ui/toaster";
import { TopNav } from "@/components/TopNav";
import { Footer } from "@/components/Footer";
import { PrivateRoute } from "@/components/PrivateRoute";
import Landing from "@/pages/Landing";
import Auth from "@/pages/Auth";
import Library from "@/pages/Library";
import MyBooks from "@/pages/MyBooks";
import NewBook from "@/pages/NewBook";
import BookDetails from "@/pages/BookDetails";
import BookEdit from "@/pages/BookEdit";
import PageView from "@/pages/PageView";
import AcceptInvitation from "@/pages/AcceptInvitation";
import PrivacyPolicy from "@/pages/PrivacyPolicy";
import Terms from "@/pages/Terms";
import Contact from "@/pages/Contact";
import UserProfile from "@/pages/UserProfile";
import SetUsername from "@/pages/SetUsername";
import JoinBook from "@/pages/JoinBook";
import GenerateBook from "./pages/GenerateBook";
import KindleSettings from "@/pages/KindleSettings";
import { useEffect } from "react";
import { useGoogleAnalytics } from "@/hooks/useGoogleAnalytics";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const queryClient = new QueryClient();

function ScrollToTop() {
  const { pathname } = useLocation();
  useGoogleAnalytics();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}

export default function App() {
  const isProd = window.location.hostname === "www.pensive.me";
  const basename = isProd ? "" : "/";

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="light">
        <Router basename={basename}>
          <div className="min-h-screen flex flex-col">
            <ScrollToTop />
            <TopNav />
            <main className="flex-1">
              <Routes>
                <Route path="/:username" element={<UserProfile />} />
                
                <Route path="/" element={<Landing />} />
                <Route path="/auth" element={<Auth />} />
                <Route path="/auth/callback" element={<Auth />} />
                <Route path="/library" element={<Library />} />
                <Route path="/accept-invitation" element={<AcceptInvitation />} />
                <Route path="/privacy" element={<PrivacyPolicy />} />
                <Route path="/terms" element={<Terms />} />
                <Route path="/contact" element={<Contact />} />
                <Route path="/book/:id/join" element={<JoinBook />} />
                <Route
                  path="/settings/kindle"
                  element={
                    <PrivateRoute>
                      <KindleSettings />
                    </PrivateRoute>
                  }
                />
                <Route
                  path="/set-username"
                  element={
                    <PrivateRoute>
                      <SetUsername />
                    </PrivateRoute>
                  }
                />
                
                <Route
                  path="/my-books"
                  element={
                    <PrivateRoute>
                      <MyBooks />
                    </PrivateRoute>
                  }
                />
                <Route
                  path="/book/new"
                  element={
                    <PrivateRoute>
                      <NewBook />
                    </PrivateRoute>
                  }
                />
                <Route
                  path="/book/:id"
                  element={
                    <PrivateRoute>
                      <BookDetails />
                    </PrivateRoute>
                  }
                />
                <Route
                  path="/book/:id/edit"
                  element={
                    <PrivateRoute>
                      <BookEdit />
                    </PrivateRoute>
                  }
                />
                <Route
                  path="/book/:bookId/page/:pageId"
                  element={
                    <PrivateRoute>
                      <PageView />
                    </PrivateRoute>
                  }
                />
                <Route
                  path="/generate-book"
                  element={
                    <PrivateRoute>
                      <GenerateBook />
                    </PrivateRoute>
                  }
                />
              </Routes>
            </main>
            <Footer />
          </div>
          <Toaster />
        </Router>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
