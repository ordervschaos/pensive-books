
import { BrowserRouter as Router, Routes, Route, useLocation, Outlet } from "react-router-dom";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { PageDisplaySettingsProvider } from "@/contexts/PageDisplaySettingsContext";
import { Toaster } from "@/components/ui/toaster";
import { TopNav } from "@/components/TopNav";
import { PrivateRoute } from "@/components/PrivateRoute";
import { IndexRoute } from "@/components/IndexRoute";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Suspense, lazy, useEffect } from "react";
import { useGoogleAnalytics } from "@/hooks/useGoogleAnalytics";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LegacyRedirects } from "@/components/LegacyRedirects";
import { PublicSiteRedirect } from "@/components/PublicSiteRedirect";
import { CookieBanner } from "@/components/CookieBanner";
import { AdminRoute } from "@/components/AdminRoute";
import { VercelAnalytics } from "@/components/VercelAnalytics";

const PrivacyPolicy = lazy(() => import("@/pages/public/legal/PrivacyPolicy"));
const Terms = lazy(() => import("@/pages/public/legal/Terms"));
const Contact = lazy(() => import("@/pages/public/legal/Contact"));
const CookiesPage = lazy(() => import("@/pages/public/legal/Cookies"));

// Auth pages
const Auth = lazy(() => import("@/pages/auth/Auth"));

// User pages
const SetUsername = lazy(() => import("@/pages/user/profile/SetUsername"));
const ProfileEdit = lazy(() => import("@/pages/user/profile/ProfileEdit"));

// Books resource (CRUD-compliant)
const MyBooks = lazy(() => import("@/pages/books/index/MyBooks"));
const NewBook = lazy(() => import("@/pages/books/new/NewBook"));
const BookDetails = lazy(() => import("@/pages/books/show/BookDetails"));
const StudioPage = lazy(() => import("@/pages/books/studio/StudioPage"));
const DnaStudioPage = lazy(() => import("@/pages/books/dna/DnaStudioPage"));
const DraftChanges = lazy(() => import("@/pages/books/show/DraftChanges"));
const VersionHistoryPage = lazy(() => import("@/pages/books/show/VersionHistoryPage"));
const BookEdit = lazy(() => import("@/pages/books/edit/BookEdit"));

// Nested resources under books
const PageView = lazy(() => import("@/pages/books/pages/view/PageView"));
const VersionPreview = lazy(() => import("@/pages/books/versions/VersionPreview"));
const VersionPageView = lazy(() => import("@/pages/books/versions/VersionPageView"));

// Invitation pages
const AcceptInvitation = lazy(() => import("@/pages/invitation/AcceptInvitation"));
const JoinBook = lazy(() => import("@/pages/invitation/JoinBook"));

// Settings pages
const KindleSettings = lazy(() => import("@/pages/settings/KindleSettings"));

// Admin pages
const AdminDashboard = lazy(() => import("@/pages/admin/AdminDashboard"));
const AdminAiCalls = lazy(() => import("@/pages/admin/AiCalls"));
const AdminSettings = lazy(() => import("@/pages/admin/AdminSettings"));

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
  const isPageViewRoute = location.pathname.includes('/pages/');

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

function ProtectedLayout() {
  return (
    <PrivateRoute>
      <Outlet />
    </PrivateRoute>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="paper" defaultMode="light">
        <PageDisplaySettingsProvider>
          <Router>
            <div className="min-h-screen flex flex-col">
              <ScrollToTop />
              <LegacyRedirects />
              <ConditionalNav />
              <main className="flex-1">
                <ErrorBoundary>
                  <Suspense fallback={<RouteFallback />}>
                    <Routes>
                      {/* Public routes */}
                      <Route path="/u/:username" element={<PublicSiteRedirect />} />
                      <Route path="/" element={<IndexRoute />} />
                      <Route path="/auth" element={<Auth />} />
                      <Route path="/auth/callback" element={<Auth />} />
                      <Route path="/library/*" element={<PublicSiteRedirect />} />
                      <Route path="/accept-invitation" element={<AcceptInvitation />} />
                      <Route path="/privacy" element={<PrivacyPolicy />} />
                      <Route path="/terms" element={<Terms />} />
                      <Route path="/cookies" element={<CookiesPage />} />
                      <Route path="/contact" element={<Contact />} />
                      <Route path="/books/:bookSlug/join/:token" element={<JoinBook />} />

                      {/* Public published content routes */}
                      <Route path="/library/books/:bookSlug" element={<PublicSiteRedirect />} />
                      <Route path="/library/books/:bookSlug/pages/:pageSlug" element={<PublicSiteRedirect />} />

                      {/* Admin routes */}
                      <Route
                        path="/admin"
                        element={
                          <PrivateRoute>
                            <AdminRoute>
                              <AdminDashboard />
                            </AdminRoute>
                          </PrivateRoute>
                        }
                      />
                      <Route
                        path="/admin/ai-calls"
                        element={
                          <PrivateRoute>
                            <AdminRoute>
                              <AdminAiCalls />
                            </AdminRoute>
                          </PrivateRoute>
                        }
                      />
                      <Route
                        path="/admin/settings"
                        element={
                          <PrivateRoute>
                            <AdminRoute>
                              <AdminSettings />
                            </AdminRoute>
                          </PrivateRoute>
                        }
                      />

                      {/* Protected routes */}
                      <Route element={<ProtectedLayout />}>
                        <Route path="/settings/kindle" element={<KindleSettings />} />
                        <Route path="/user/profile/set-username" element={<SetUsername />} />
                        <Route path="/user/profile/edit" element={<ProfileEdit />} />
                        <Route path="/books" element={<MyBooks />} />
                        <Route path="/books/new" element={<NewBook />} />
                        <Route path="/books/:bookSlug/versions/:versionId/pages/:pageSlug" element={<VersionPageView />} />
                        <Route path="/books/:bookSlug/versions/:versionId" element={<VersionPreview />} />
                        <Route path="/books/:bookSlug/versions" element={<VersionHistoryPage />} />
                        <Route path="/books/:bookSlug/draft" element={<DraftChanges />} />
                        <Route path="/books/:bookSlug" element={<BookDetails />} />
                        <Route path="/books/:bookSlug/studio" element={<StudioPage />} />
                        <Route path="/books/:bookSlug/dna" element={<DnaStudioPage />} />
                        <Route path="/books/:bookSlug/studio/page/:pageId" element={<StudioPage />} />
                        <Route path="/books/:bookSlug/studio/:step" element={<StudioPage />} />
                        <Route path="/books/:bookSlug/edit" element={<BookEdit />} />
                        <Route path="/books/:bookSlug/pages/:pageSlug" element={<PageView />} />
                      </Route>
                    </Routes>
                  </Suspense>
                </ErrorBoundary>
              </main>
            </div>
            <CookieBanner />
            <VercelAnalytics />
            <Toaster />
          </Router>
        </PageDisplaySettingsProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
