import { BrowserRouter as Router, Routes, Route, Outlet } from "react-router-dom";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { TopNav } from "@/components/TopNav";
import { Toaster } from "@/components/ui/toaster";
import { PrivateRoute } from "@/components/PrivateRoute";
import Auth from "@/pages/Auth";
import Index from "@/pages/Index";
import NewBook from "@/pages/NewBook";
import BookDetails from "@/pages/BookDetails";
import BookEdit from "@/pages/BookEdit";
import PageView from "@/pages/PageView";
import Invitations from "@/pages/Invitations";

function App() {
  return (
    <Router>
      <ThemeProvider>
        <div className="min-h-screen bg-background">
          <Routes>
            <Route path="/auth" element={<Auth />} />
            <Route path="/accept-invitation" element={<AcceptInvitation />} />
            <Route
              path="/"
              element={
                <PrivateRoute>
                  <TopNav />
                  <Outlet />
                </PrivateRoute>
              }
            >
              <Route index element={<Index />} />
              <Route path="invitations" element={<Invitations />} />
              <Route path="book/new" element={<NewBook />} />
              <Route path="book/:id" element={<BookDetails />} />
              <Route path="book/:id/edit" element={<BookEdit />} />
              <Route path="book/:id/page/:pageId" element={<PageView />} />
            </Route>
          </Routes>
          <Toaster />
        </div>
      </ThemeProvider>
    </Router>
  );
}

export default App;
