
import { Button } from "@/components/ui/button";
import { Share2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ShareBookButtonProps {
  isPublic: boolean;
  url: string;
}

export const ShareBookButton = ({ isPublic, url }: ShareBookButtonProps) => {
  const { toast } = useToast();

  const handleShare = async () => {
    // Try native share API first (mobile/some browsers)
    if (navigator.share) {
      try {
        await navigator.share({
          title: "Check out this book",
          url: url,
        });
        return;
      } catch (err) {
        // User cancelled or error - fall through to copy
        if ((err as Error).name === 'AbortError') return;
      }
    }

    // Fallback to copying link
    try {
      await navigator.clipboard.writeText(url);
      toast({
        title: "Link copied",
        description: "Book link has been copied to clipboard",
      });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Failed to copy",
        description: "Could not copy the link to clipboard",
      });
    }
  };

  // Hide button if book is not public
  if (!isPublic) return null;

  return (
    <Button
      type="button"
      onClick={handleShare}
      variant="ghost"
      size="sm"
      className="h-8 w-8 p-0"
    >
      <Share2 className="h-4 w-4" />
    </Button>
  );
};
