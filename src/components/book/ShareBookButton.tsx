
import { Button } from "@/components/ui/button";
import { Copy } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ShareBookButtonProps {
  isPublic: boolean;
  url: string;
}

export const ShareBookButton = ({ isPublic, url }: ShareBookButtonProps) => {
  const { toast } = useToast();

  const handleCopyLink = async () => {
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

  if (!isPublic) return null;

  return (
    <div className="mt-4 space-y-2">
      <p className="text-sm font-medium">Share this book</p>
      <div className="flex items-center gap-2 p-2 rounded-md bg-muted text-sm">
        <span className="truncate flex-1">
          {url}
        </span>
        <Button
          onClick={handleCopyLink}
          variant="ghost"
          size="sm"
          className="shrink-0"
        >
          <Copy className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};
