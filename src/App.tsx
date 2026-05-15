
import { BrowserRouter as Router, Routes, Route, useLocation } from "react-router-dom";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { PageDisplaySettingsProvider } from "@/contexts/PageDisplaySettingsContext";
import { Toaster } from "@/components/ui/toaster";
import { TopNav } from "@/components/TopNav";
import { LibraryNav } from "@/components/navigation/LibraryNav";
import { PrivateRoute } from "@/components/PrivateRoute";
import { Suspense, lazy, useEffect } from "react";
import { useGoogleAnalytics } from "@/hooks/useGoogleAnalytics";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LegacyRedirects } from "@/components/LegacyRedirects";

// Public pages
const Landing = lazy(() => import("@/pages/public/landing/Landing"));
const Library = lazy(() => import("@/pages/public/library/Library"));
const PrivacyPolicy = lazy(() => import("@/pages/public/legal/PrivacyPolicy"));
const Terms = lazy(() => import("@/pages/public/legal/Terms"));
const Contact = lazy(() => import("@/pages/public/legal/Contact"));

// Auth pages
const Auth = lazy(() => import("@/pages/auth/Auth"));

// User pages
const PublicProfile = lazy(() => import("@/pages/user/profile/PublicProfile"));
const SetUsername = lazy(() => import("@/pages/user/profile/SetUsername"));
const ProfileEdit = lazy(() => import("@/pages/user/profile/ProfileEdit"));

// Books resource (CRUD-compliant)
const MyBooks = lazy(() => import("@/pages/books/index/MyBooks"));
const NewBook = lazy(() => import("@/pages/books/new/NewBook"));
const BookDetails = lazy(() => import("@/pages/books/show/BookDetails"));
const DraftChanges = lazy(() => import("@/pages/books/show/DraftChanges"));
const VersionHistoryPage = lazy(() => import("@/pages/books/show/VersionHistoryPage"));
const BookEdit = lazy(() => import("@/pages/books/edit/BookEdit"));
const BookFlashcards = lazy(() => import("@/pages/books/flashcards/BookFlashcards"));
const GenerateBook = lazy(() => import("@/pages/books/generate/GenerateBook"));
const PublishedBookDetails = lazy(() => import("@/pages/public/library/PublishedBookDetails"));

// Nested resources under books
const PageView = lazy(() => import("@/pages/books/pages/view/PageView"));
const BookChatPage = lazy(() => import("@/pages/books/chat/BookChatPage"));
const VersionPreview = lazy(() => import("@/pages/books/versions/VersionPreview"));
const VersionPageView = lazy(() => import("@/pages/books/versions/VersionPageView"));
const PublishedPageView = lazy(() => import("@/pages/books/pages/view/PublishedPageView"));

// Invitation pages
const AcceptInvitation = lazy(() => import("@/pages/invitation/AcceptInvitation"));
const JoinBook = lazy(() => import("@/pages/invitation/JoinBook"));

// Settings pages
const KindleSettings = lazy(() => import("@/pages/settings/KindleSettings"));

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

function RouteFallback() {
  return (
    <div className="flex items-center justify-center min-h-[50vh] text-muted-foreground">
      Loading…
    </div>
  );
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
              <Suspense fallback={<RouteFallback />}>
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
              </Suspense>
            </main>
          </div>
          <Toaster />
        </Router>
        </PageDisplaySettingsProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
