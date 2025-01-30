import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { Toaster } from "@/components/ui/toaster";
import { TopNav } from "@/components/TopNav";
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

function App() {
  // Get the basename based on the environment
  const isProd = window.location.hostname === "www.pensive.me";
  const basename = isProd ? "" : "/";

  // Log the current environment configuration for debugging
  console.log("Current environment:", {
    hostname: window.location.hostname,
    isProd,
    basename,
    fullUrl: window.location.href
  });

  return (
    <ThemeProvider defaultTheme="light">
      <Router basename={basename}>
        <TopNav />
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/auth" element={<Auth />} />
          <Route path="/auth/callback" element={<Auth />} />
          <Route path="/library" element={<Library />} />
          <Route path="/accept-invitation" element={<AcceptInvitation />} />
          
          {/* Protected Routes */}
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
        </Routes>
        <Toaster />
      </Router>
    </ThemeProvider>
  );
}

export default App;