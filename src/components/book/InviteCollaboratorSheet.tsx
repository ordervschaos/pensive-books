import { useState } from "react";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface InviteCollaboratorSheetProps {
  bookId: number;
}

export function InviteCollaboratorSheet({ bookId }: InviteCollaboratorSheetProps) {
  const { toast } = useToast();
  const [inviteEmail, setInviteEmail] = useState("");
  const [accessLevel, setAccessLevel] = useState<"view" | "edit">("view");
  const [sending, setSending] = useState(false);

  const handleInvite = async () => {
    if (!inviteEmail || !bookId) return;

    try {
      setSending(true);
      console.log("Sending invitation to:", inviteEmail, "for book:", bookId);

      // Send the invitation through the edge function which will handle both
      // creating the book access record and sending the email
      const { error: inviteError } = await supabase.functions.invoke('send-book-invitation', {
        body: {
          email: inviteEmail,
          bookId: bookId,
          accessLevel: accessLevel
        }
      });

      if (inviteError) {
        console.error("Error sending invitation:", inviteError);
        throw inviteError;
      }

      toast({
        title: "Invitation sent",
        description: `Invitation sent to ${inviteEmail}`
      });

      setInviteEmail("");
    } catch (error: any) {
      console.error("Error sending invitation:", error);
      toast({
        variant: "destructive",
        title: "Error sending invitation",
        description: error.message
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline">
          <UserPlus className="mr-2 h-4 w-4" />
          Invite
        </Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Invite Collaborator</SheetTitle>
        </SheetHeader>
        <div className="space-y-4 mt-4">
          <div>
            <Label htmlFor="email">Email address</Label>
            <Input
              id="email"
              type="email"
              placeholder="collaborator@example.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="access">Access level</Label>
            <Select
              value={accessLevel}
              onValueChange={(value: "view" | "edit") => setAccessLevel(value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select access level" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="view">View only</SelectItem>
                <SelectItem value="edit">Can edit</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button 
            className="w-full" 
            onClick={handleInvite}
            disabled={!inviteEmail || sending}
          >
            {sending ? "Sending..." : "Send Invitation"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}