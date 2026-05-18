import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { Globe, Lock, MoreHorizontal, Settings, Share2 } from "lucide-react";

interface BookActionsBarProps {
  isPublic: boolean;
  onPublish: () => void;
  onUnpublish: () => void;
  publishing: boolean;
  onEditClick: () => void;
  url: string;
}

export const BookActionsBar = ({
  isPublic,
  onPublish,
  onUnpublish,
  publishing,
  onEditClick,
  url,
}: BookActionsBarProps) => {
  const { toast } = useToast();

  const handleShare = async () => {
    if (!isPublic) return;

    if (navigator.share) {
      try {
        await navigator.share({
          title: "Check out this book",
          url,
        });
        return;
      } catch (error) {
        if ((error as Error).name === "AbortError") {
          return;
        }
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      toast({
        title: "Link copied",
        description: "Book link has been copied to clipboard",
      });
    } catch {
      toast({
        variant: "destructive",
        title: "Failed to copy",
        description: "Could not copy the link to clipboard",
      });
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="pv-serif h-9 gap-1.5 rounded-full border-border bg-transparent px-3.5 text-[13px] italic text-[hsl(var(--pv-text-muted))] hover:text-foreground"
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
          <span>Actions</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {isPublic && (
          <>
            <DropdownMenuItem onClick={handleShare} className="flex items-center gap-2">
              <Share2 className="h-4 w-4" />
              <span>Share book</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem
          onClick={isPublic ? onUnpublish : onPublish}
          disabled={publishing}
          className="flex items-center gap-2"
        >
          {isPublic ? <Lock className="h-4 w-4" /> : <Globe className="h-4 w-4" />}
          <span>{isPublic ? "Unpublish book" : "Publish book"}</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onEditClick} className="flex items-center gap-2">
          <Settings className="h-4 w-4" />
          <span>Edit details</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
