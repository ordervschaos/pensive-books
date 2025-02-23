
import { useState } from "react";
import { Copy, Link } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

interface ShareBookSheetProps {
  bookId: number;
  viewToken: string;
  editToken: string;
}

export function ShareBookSheet({ bookId, viewToken, editToken }: ShareBookSheetProps) {
  const { toast } = useToast();
  const [accessType, setAccessType] = useState<"view" | "edit">("view");
  
  const getShareLink = (type: "view" | "edit") => {
    const token = type === "view" ? viewToken : editToken;
    return `${window.location.origin}/book/${bookId}/join?token=${token}&access=${type}`;
  };

  const handleCopyLink = async () => {
    const link = getShareLink(accessType);
    try {
      await navigator.clipboard.writeText(link);
      toast({
        title: "Link copied",
        description: "Share link has been copied to clipboard"
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Failed to copy",
        description: "Please try copying the link manually"
      });
    }
  };

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline">
          <Link className="mr-2 h-4 w-4" />
          Share
        </Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Share Book</SheetTitle>
        </SheetHeader>
        <div className="mt-6 space-y-6">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Access type</Label>
              <Select 
                value={accessType} 
                onValueChange={(value: "view" | "edit") => setAccessType(value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="view">Can view</SelectItem>
                  <SelectItem value="edit">Can edit</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Share link</Label>
              <div className="flex gap-2">
                <Input 
                  value={getShareLink(accessType)}
                  readOnly
                />
                <Button onClick={handleCopyLink}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
