import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BookOpen } from "lucide-react";

interface Page {
  id: number;
  page_index: number;
  updated_at: string;
}

interface PagesListProps {
  pages: Page[];
  bookId: number;
}

export const PagesList = ({ pages, bookId }: PagesListProps) => {
  const navigate = useNavigate();

  if (pages.length === 0) {
    return (
      <Card>
        <CardContent className="text-center py-6">
          <BookOpen className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
          <p className="text-muted-foreground">No pages yet</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4">
      {pages.map((page) => (
        <Card 
          key={page.id} 
          className="hover:shadow-md transition-shadow cursor-pointer"
          onClick={() => navigate(`/book/${bookId}/page/${page.id}`)}
        >
          <CardHeader>
            <CardTitle className="text-lg">
              Page {page.page_index + 1}
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Last modified {new Date(page.updated_at).toLocaleDateString()}
            </p>
          </CardHeader>
        </Card>
      ))}
    </div>
  );
};