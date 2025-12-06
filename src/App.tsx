
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
import PublicProfile from "@/pages/user/profile/PublicProfile";
import SetUsername from "@/pages/user/profile/SetUsername";
import ProfileEdit from "@/pages/user/profile/ProfileEdit";

// Books resource (CRUD-compliant)
import MyBooks from "@/pages/books/index/MyBooks";
import NewBook from "@/pages/books/new/NewBook";
import BookDetails from "@/pages/books/show/BookDetails";
import DraftChanges from "@/pages/books/show/DraftChanges";
import VersionHistoryPage from "@/pages/books/show/VersionHistoryPage";
import BookEdit from "@/pages/books/edit/BookEdit";
import BookFlashcards from "@/pages/books/flashcards/BookFlashcards";
import GenerateBook from "@/pages/books/generate/GenerateBook";
import PublishedBookDetails from "@/pages/public/library/PublishedBookDetails";

// Nested resources under books
import PageView from "@/pages/books/pages/view/PageView";
import BookChatPage from "@/pages/books/chat/BookChatPage";
import VersionPreview from "@/pages/books/versions/VersionPreview";
import VersionPageView from "@/pages/books/versions/VersionPageView";
import PublishedPageView from "@/pages/books/pages/view/PublishedPageView";

// Invitation pages
import AcceptInvitation from "@/pages/invitation/AcceptInvitation";
import JoinBook from "@/pages/invitation/JoinBook";

// Settings pages
import KindleSettings from "@/pages/settings/KindleSettings";
import { useEffect } from "react";
import { useGoogleAnalytics } from "@/hooks/useGoogleAnalytics";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LegacyRedirects } from "@/components/LegacyRedirects";

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
  const isPageViewRoute = location.pathname.includes('/pages/');

  if (isLibraryRoute) {
    return <LibraryNav />;
  }

  // Hide nav for page view routes (they have their own fixed settings menu)
  if (isPageViewRoute) {
    return null;
  }

  return <TopNav />;
}

export default function App() {
  const isProd = window.location.hostname === "www.pensive.me";
  const basename = isProd ? "" : "/";

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="coffee" defaultMode="dark">
        <PageDisplaySettingsProvider>
          <Router basename={basename}>
          <div className="min-h-screen flex flex-col">
            <ScrollToTop />
            <LegacyRedirects />
            <ConditionalNav />
            <main className="flex-1">
              <Routes>
                <Route path="/u/:username" element={<PublicProfile />} />
                
                <Route path="/" element={<Landing />} />
                <Route path="/auth" element={<Auth />} />
                <Route path="/auth/callback" element={<Auth />} />
                <Route path="/library" element={<Library />} />
                <Route path="/accept-invitation" element={<AcceptInvitation />} />
                <Route path="/privacy" element={<PrivacyPolicy />} />
                <Route path="/terms" element={<Terms />} />
                <Route path="/contact" element={<Contact />} />
                <Route path="/books/:bookSlug/join/:token" element={<JoinBook />} />

                {/* Public published content routes */}
                <Route path="/library/books/:bookSlug" element={<PublishedBookDetails />} />
                <Route path="/library/books/:bookSlug/pages/:pageSlug" element={<PublishedPageView />} />
                <Route
                  path="/settings/kindle"
                  element={
                    <PrivateRoute>
                      <KindleSettings />
                    </PrivateRoute>
                  }
                />
                <Route
                  path="/user/profile/set-username"
                  element={
                    <PrivateRoute>
                      <SetUsername />
                    </PrivateRoute>
                  }
                />
                <Route
                  path="/user/profile/edit"
                  element={
                    <PrivateRoute>
                      <ProfileEdit />
                    </PrivateRoute>
                  }
                />
                
                <Route
                  path="/books"
                  element={
                    <PrivateRoute>
                      <MyBooks />
                    </PrivateRoute>
                  }
                />
                <Route
                  path="/books/new"
                  element={
                    <PrivateRoute>
                      <NewBook />
                    </PrivateRoute>
                  }
                />
                <Route
                  path="/books/:bookSlug/versions/:versionId/pages/:pageSlug"
                  element={
                    <PrivateRoute>
                      <VersionPageView />
                    </PrivateRoute>
                  }
                />
                <Route
                  path="/books/:bookSlug/versions/:versionId"
                  element={
                    <PrivateRoute>
                      <VersionPreview />
                    </PrivateRoute>
                  }
                />
                <Route
                  path="/books/:bookSlug/versions"
                  element={
                    <PrivateRoute>
                      <VersionHistoryPage />
                    </PrivateRoute>
                  }
                />
                <Route
                  path="/books/:bookSlug/draft"
                  element={
                    <PrivateRoute>
                      <DraftChanges />
                    </PrivateRoute>
                  }
                />
                <Route
                  path="/books/:bookSlug/chat"
                  element={
                    <PrivateRoute>
                      <BookChatPage />
                    </PrivateRoute>
                  }
                />
                <Route
                  path="/books/:bookSlug"
                  element={
                    <PrivateRoute>
                      <BookDetails />
                    </PrivateRoute>
                  }
                />
                <Route
                  path="/books/:bookSlug/edit"
                  element={
                    <PrivateRoute>
                      <BookEdit />
                    </PrivateRoute>
                  }
                />
                <Route
                  path="/books/:bookSlug/flashcards"
                  element={
                    <PrivateRoute>
                      <BookFlashcards />
                    </PrivateRoute>
                  }
                />
                <Route
                  path="/books/:bookSlug/pages/:pageSlug"
                  element={
                    <PrivateRoute>
                      <PageView />
                    </PrivateRoute>
                  }
                />
                <Route
                  path="/books/generate"
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
