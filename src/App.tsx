import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { Toaster } from "@/components/ui/toaster";
import { PrivateRoute } from "@/components/PrivateRoute";
import Auth from "@/pages/Auth";
import Index from "@/pages/Index";
import NewBook from "@/pages/NewBook";
import BookDetails from "@/pages/BookDetails";
import BookEdit from "@/pages/BookEdit";
import PageView from "@/pages/PageView";
import AcceptInvitation from "@/pages/AcceptInvitation";

function App() {
  return (
    <ThemeProvider defaultTheme="light">
      <Router>
        <div className="min-h-screen bg-background">
          <Routes>
            <Route path="/auth" element={<Auth />} />
            <Route path="/accept-invitation" element={<AcceptInvitation />} />
            <Route element={<PrivateRoute />}>
              <Route index element={<Index />} />
              <Route path="book/new" element={<NewBook />} />
              <Route path="book/:id" element={<BookDetails />} />
              <Route path="book/:id/edit" element={<BookEdit />} />
              <Route path="book/:bookId/page/:pageId" element={<PageView />} />
            </Route>
          </Routes>
          <Toaster />
        </div>
      </Router>
    </ThemeProvider>
  );
}

export default App;