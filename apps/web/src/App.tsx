
import { BrowserRouter as Router, Routes, Route, useLocation, useParams, Navigate, Outlet } from "react-router-dom";
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

// Docs store (public documentation — /docs)
const DocsPage = lazy(() => import("@/pages/docs/DocsPage"));

// Auth pages
const Auth = lazy(() => import("@/pages/auth/Auth"));

// User pages
const SetUsername = lazy(() => import("@/pages/user/profile/SetUsername"));
const ProfileEdit = lazy(() => import("@/pages/user/profile/ProfileEdit"));

// Books resource (CRUD-compliant)
const MyBooks = lazy(() => import("@/pages/books/index/MyBooks"));
const NewBook = lazy(() => import("@/pages/books/new/NewBook"));
const BookDetails = lazy(() => import("@/pages/books/show/BookDetails"));
const StudioNewBookPage = lazy(() => import("@/features/dna/pages/StudioNewBookPage"));
const StudioJsonPage = lazy(() => import("@/features/dna/pages/StudioJsonPage"));
const StudioTreePage = lazy(() => import("@/features/dna/pages/StudioTreePage"));
const StudioDevPage = lazy(() => import("@/features/dna/pages/StudioDevPage"));
const StudioMetersPage = lazy(() => import("@/features/dna/pages/StudioMetersPage"));
const StudioLedgerPage = lazy(() => import("@/features/dna/pages/StudioLedgerPage"));
const StudioDashboardPage = lazy(() => import("@/pages/studio/StudioDashboardPage"));
const DnaArchitecturePage = lazy(() => import("@/features/dna/pages/DnaArchitecturePage"));
const ReaderMachinePage = lazy(() => import("@/features/reader/pages/ReaderMachinePage"));
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
const AdminLayout = lazy(() => import("@/pages/admin/AdminLayout"));
const AdminDashboard = lazy(() => import("@/pages/admin/AdminDashboard"));
const AdminAiCalls = lazy(() => import("@/pages/admin/AiCalls"));
const AdminSettings = lazy(() => import("@/pages/admin/AdminSettings"));
const AdminNodeTypeConfigs = lazy(() => import("@/pages/admin/NodeTypeConfigs"));

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
  const isJsonRoute = location.pathname.endsWith('/studio.json');
  const isTreeRoute = location.pathname.includes('/studio/tree');
  const isMetersRoute = location.pathname.includes('/studio/meters');
  const isLedgerRoute = location.pathname.includes('/studio/ledger');
  const isArchRoute = location.pathname.includes('/dna/docs');

  // Hide nav for page view routes (own fixed settings menu) and dev Studio routes.
  if (isPageViewRoute || isJsonRoute || isTreeRoute || isMetersRoute || isLedgerRoute || isArchRoute) {
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

// The vanilla studio was deprecated in favor of the tree (docs/plan-one-studio-consolidation.md) —
// /studio keeps working as the studio entry point from the book editor. It lands on the tree tab (not
// Overview): the tree + editor rail is more grounding to start from than the read-only Overview summary.
function StudioRedirect() {
  const { bookSlug } = useParams();
  return <Navigate to={`/books/${bookSlug}/studio/tree`} replace />;
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
                      <Route path="/docs" element={<DocsPage />} />
                      <Route path="/docs/:slug" element={<DocsPage />} />
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
                              <AdminLayout />
                            </AdminRoute>
                          </PrivateRoute>
                        }
                      >
                        <Route index element={<AdminDashboard />} />
                        <Route path="ai-calls" element={<AdminAiCalls />} />
                        <Route path="settings" element={<AdminSettings />} />
                        <Route path="node-types" element={<AdminNodeTypeConfigs />} />
                      </Route>

                      {/* DNA architecture atlas — admin only, book-agnostic */}
                      <Route
                        path="/dna/docs/architecture"
                        element={
                          <PrivateRoute>
                            <AdminRoute>
                              <DnaArchitecturePage />
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
                        <Route path="/studio" element={<StudioDashboardPage />} />
                        <Route path="/studio/new" element={<StudioNewBookPage />} />
                        {/* Reader Machine P0 — book-agnostic, runs entirely client-side */}
                        <Route path="/reader" element={<ReaderMachinePage />} />
                        <Route path="/books/:bookSlug/versions/:versionId/pages/:pageSlug" element={<VersionPageView />} />
                        <Route path="/books/:bookSlug/versions/:versionId" element={<VersionPreview />} />
                        <Route path="/books/:bookSlug/versions" element={<VersionHistoryPage />} />
                        <Route path="/books/:bookSlug/draft" element={<DraftChanges />} />
                        <Route path="/books/:bookSlug" element={<BookDetails />} />
                        <Route path="/books/:bookSlug/studio" element={<StudioRedirect />} />
                        <Route path="/books/:bookSlug/studio.json" element={<StudioJsonPage />} />
                        <Route path="/books/:bookSlug/studio/meters" element={<StudioMetersPage />} />
                        <Route path="/books/:bookSlug/studio/ledger" element={<StudioLedgerPage />} />
                        {/* Admin-only book flight recorder — static path outranks the tree splat below */}
                        <Route path="/books/:bookSlug/studio/tree/dev" element={<AdminRoute><StudioDevPage /></AdminRoute>} />
                        <Route path="/books/:bookSlug/studio/tree/*" element={<StudioTreePage />} />
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
