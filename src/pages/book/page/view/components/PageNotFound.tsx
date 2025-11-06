import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface PageNotFoundProps {
  bookId: string;
}

export const PageNotFound = ({ bookId }: PageNotFoundProps) => {
  const navigate = useNavigate();
  
  return (
    <div className="text-center">
      <h1 className="text-2xl font-bold mb-4">Page not found</h1>
      <Button onClick={() => navigate(`/book/${bookId}`)}>
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back to Book
      </Button>
    </div>
  );
};