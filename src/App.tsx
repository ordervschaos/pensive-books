import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { Toaster } from "@/components/ui/toaster";
import Index from "@/pages/Index";
import Auth from "@/pages/Auth";
import BookDetails from "@/pages/BookDetails";
import BookEdit from "@/pages/BookEdit";
import NewBook from "@/pages/NewBook";
import PageView from "@/pages/PageView";
import AcceptInvitation from "@/pages/AcceptInvitation";

function App() {
  return (
    <ThemeProvider defaultTheme="light" storageKey="vite-ui-theme">
      <Router>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/auth" element={<Auth />} />
          <Route path="/book/new" element={<NewBook />} />
          <Route path="/book/:id" element={<BookDetails />} />
          <Route path="/book/:id/edit" element={<BookEdit />} />
          <Route path="/book/:bookId/page/:pageId" element={<PageView />} />
          <Route path="/accept-invitation" element={<AcceptInvitation />} />
        </Routes>
      </Router>
      <Toaster />
    </ThemeProvider>
  );
}

export default App;