import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Globe, Lock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface BookHeaderProps {
  isPublic: boolean;
  onTogglePublish: () => void;
  publishing: boolean;
  bookId: number;
}

export const BookHeader = ({ isPublic, onTogglePublish, publishing, bookId }: BookHeaderProps) => {
  const navigate = useNavigate();

  const handleTogglePublish = async () => {
    try {
      // First migrate the images
      const { error: migrationError } = await supabase.functions.invoke('migrate_book_images', {
        body: { bookId, isPublic: !isPublic }
      });

      if (migrationError) {
        throw migrationError;
      }

      // Then toggle the book visibility
      await onTogglePublish();
    } catch (error) {
      console.error('Error migrating images:', error);
    }
  };

  return (
    <div className="flex items-center justify-between">
      <Button variant="ghost" onClick={() => navigate("/")}>
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back to Notebooks
      </Button>
      <Button
        onClick={handleTogglePublish}
        disabled={publishing}
        variant={isPublic ? "destructive" : "default"}
      >
        {isPublic ? (
          <>
            <Lock className="mr-2 h-4 w-4" />
            Make Private
          </>
        ) : (
          <>
            <Globe className="mr-2 h-4 w-4" />
            Publish
          </>
        )}
      </Button>
    </div>
  );
};