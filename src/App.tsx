
import { BrowserRouter as Router, Routes, Route, useLocation } from "react-router-dom";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { PageDisplaySettingsProvider } from "@/contexts/PageDisplaySettingsContext";
import { Toaster } from "@/components/ui/toaster";
import { TopNav } from "@/components/TopNav";
import { LibraryNav } from "@/components/navigation/LibraryNav";
import { PrivateRoute } from "@/components/PrivateRoute";
// Public pages
import Landing from "@/pages/public/landing/Landing";
import Library from "@/pages/public/library/Library";
import PrivacyPolicy from "@/pages/public/legal/PrivacyPolicy";
import Terms from "@/pages/public/legal/Terms";
import Contact from "@/pages/public/legal/Contact";

// Auth pages
import Auth from "@/pages/auth/Auth";

// User pages
import MyBooks from "@/pages/user/library/MyBooks";
import UserProfile from "@/pages/user/profile/UserProfile";
import SetUsername from "@/pages/user/profile/SetUsername";
import ProfileEdit from "@/pages/user/profile/ProfileEdit";

// Book pages
import NewBook from "@/pages/book/new/NewBook";
import BookDetails from "@/pages/book/view/BookDetails";
import BookEdit from "@/pages/book/edit/BookEdit";
import BookFlashcards from "@/pages/book/flashcards/BookFlashcards";
import GenerateBook from "@/pages/book/generate/GenerateBook";
import PublishedBookDetails from "@/pages/book/view/PublishedBookDetails";

// Page pages
import PageView from "@/pages/page/view/PageView";
import VersionPreview from "@/pages/page/version/VersionPreview";
import VersionPageView from "@/pages/page/version/VersionPageView";
import PublishedPageView from "@/pages/page/view/PublishedPageView";

// Invitation pages
import AcceptInvitation from "@/pages/invitation/AcceptInvitation";
import JoinBook from "@/pages/invitation/JoinBook";

// Settings pages
import KindleSettings from "@/pages/settings/KindleSettings";
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

function ConditionalNav() {
  const location = useLocation();
  const isLibraryRoute = location.pathname.startsWith('/library');

  if (isLibraryRoute) {
    return <LibraryNav />;
  }

  return <TopNav />;
}

export default function App() {
  const isProd = window.location.hostname === "www.pensive.me";
  const basename = isProd ? "" : "/";

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="light">
        <PageDisplaySettingsProvider>
          <Router basename={basename}>
          <div className="min-h-screen flex flex-col">
            <ScrollToTop />
            <ConditionalNav />
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
                <Route path="/book/:bookSlug/join/:token" element={<JoinBook />} />

                {/* Public published content routes */}
                <Route path="/library/book/:bookSlug" element={<PublishedBookDetails />} />
                <Route path="/library/book/:bookSlug/page/:pageSlug" element={<PublishedPageView />} />
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
                  path="/profile/edit"
                  element={
                    <PrivateRoute>
                      <ProfileEdit />
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
                  path="/book/:bookSlug/version/:versionId/page/:pageSlug"
                  element={
                    <PrivateRoute>
                      <VersionPageView />
                    </PrivateRoute>
                  }
                />
                <Route
                  path="/book/:bookSlug/version/:versionId"
                  element={
                    <PrivateRoute>
                      <VersionPreview />
                    </PrivateRoute>
                  }
                />
                <Route
                  path="/book/:bookSlug"
                  element={
                    <PrivateRoute>
                      <BookDetails />
                    </PrivateRoute>
                  }
                />
                <Route
                  path="/book/:bookSlug/edit"
                  element={
                    <PrivateRoute>
                      <BookEdit />
                    </PrivateRoute>
                  }
                />
                <Route
                  path="/book/:bookSlug/flashcards"
                  element={
                    <PrivateRoute>
                      <BookFlashcards />
                    </PrivateRoute>
                  }
                />
                <Route
                  path="/book/:bookSlug/page/:pageSlug"
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
          </div>
          <Toaster />
        </Router>
        </PageDisplaySettingsProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
