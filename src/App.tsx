import { useEffect } from "react";
import { Route, Routes } from "react-router-dom";
import { ThemeProvider } from "@/components/ui/theme-provider";
import { PrivateRoute } from "@/components/PrivateRoute";
import Landing from "@/pages/Landing";
import MyBooks from "@/pages/MyBooks";
import BookDetails from "@/pages/BookDetails";
import BookEdit from "@/pages/BookEdit";
import PageView from "@/pages/PageView";
import PageHistoryView from "@/pages/PageHistoryView";
import UserProfile from "@/pages/UserProfile";
import NewBook from "@/pages/NewBook";
import GenerateBook from "@/pages/GenerateBook";
import BookCreationFlow from "./pages/BookCreationFlow";
import KindleSettings from "@/pages/KindleSettings";

function App() {
  return (
    <ThemeProvider>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route element={<PrivateRoute />}>
          <Route path="/my-books" element={<MyBooks />} />
          <Route path="/book/:bookId" element={<BookDetails />} />
          <Route path="/book/:bookId/edit" element={<BookEdit />} />
          <Route path="/book/:bookId/page/:pageId" element={<PageView />} />
          <Route path="/book/:bookId/page/:pageId/history" element={<PageHistoryView />} />
          <Route path="/profile" element={<UserProfile />} />
          <Route path="/new-book" element={<NewBook />} />
          <Route path="/generate-book" element={<GenerateBook />} />
          <Route path="/create-book" element={<BookCreationFlow />} />
          <Route path="/kindle-settings" element={<KindleSettings />} />
        </Route>
      </Routes>
    </ThemeProvider>
  );
}

export default App;
