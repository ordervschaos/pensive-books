import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import BookDetails from "./pages/BookDetails";
import PageView from "./pages/PageView";

function App() {
  return (
    <ThemeProvider defaultTheme="light">
      <Router>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/auth" element={<Auth />} />
          <Route path="/book/:id" element={<BookDetails />} />
          <Route path="/book/:bookId/page/:pageId" element={<PageView />} />
        </Routes>
      </Router>
    </ThemeProvider>
  );
}

export default App;