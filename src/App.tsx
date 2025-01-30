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
  // Get the basename from the current URL
  const basename = window.location.hostname === "www.pensive.me" ? "/auth" : "/";

  return (
    <ThemeProvider defaultTheme="light">
      <Router basename={basename}>
        <TopNav />
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/auth" element={<Auth />} />
          <Route path="/callback" element={<Auth />} />
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