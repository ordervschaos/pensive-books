import { useState, useEffect } from "react";
import { Users, UserPlus, Mail, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface ManageCollaboratorsSheetProps {
  bookId: number;
}

interface Collaborator {
  id: number;
  invited_email: string;
  access_level: "view" | "edit";
  status: string;
}

export function ManageCollaboratorsSheet({ bookId }: ManageCollaboratorsSheetProps) {
  const { toast } = useToast();
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<number | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteAccessLevel, setInviteAccessLevel] = useState<"view" | "edit">("view");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    fetchCollaborators();
  }, [bookId]);

  const fetchCollaborators = async () => {
    try {
      const { data, error } = await supabase
        .from("book_access")
        .select("*")
        .eq("book_id", bookId);

      if (error) throw error;
      setCollaborators(data || []);
    } catch (error: any) {
      console.error("Error fetching collaborators:", error);
      toast({
        variant: "destructive",
        title: "Error fetching collaborators",
        description: error.message
      });
    } finally {
      setLoading(false);
    }
  };

  const handleRevokeAccess = async (collaboratorId: number) => {
    try {
      const { error } = await supabase
        .from("book_access")
        .delete()
        .eq("id", collaboratorId);

      if (error) throw error;

      setCollaborators(collaborators.filter(c => c.id !== collaboratorId));
      toast({
        title: "Access revoked",
        description: "Collaborator access has been revoked"
      });
    } catch (error: any) {
      console.error("Error revoking access:", error);
      toast({
        variant: "destructive",
        title: "Error revoking access",
        description: error.message
      });
    }
  };

  const handleAccessLevelChange = async (collaboratorId: number, newAccessLevel: "view" | "edit") => {
    try {
      setUpdating(collaboratorId);
      const { error } = await supabase
        .from("book_access")
        .update({ access_level: newAccessLevel })
        .eq("id", collaboratorId);

      if (error) throw error;

      setCollaborators(collaborators.map(c => 
        c.id === collaboratorId ? { ...c, access_level: newAccessLevel } : c
      ));

      toast({
        title: "Access level updated",
        description: `Collaborator access level changed to ${newAccessLevel}`
      });
    } catch (error: any) {
      console.error("Error updating access level:", error);
      toast({
        variant: "destructive",
        title: "Error updating access level",
        description: error.message
      });
    } finally {
      setUpdating(null);
    }
  };

  const handleInvite = async () => {
    if (!inviteEmail || !bookId) return;

    try {
      setSending(true);
      console.log("Sending invitation to:", inviteEmail, "for book:", bookId);

      const { error: inviteError } = await supabase.functions.invoke('send-book-invitation', {
        body: {
          email: inviteEmail,
          bookId: bookId,
          accessLevel: inviteAccessLevel
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
      await fetchCollaborators(); // Refresh the collaborators list
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
          <Users className="mr-2 h-4 w-4" />
          Manage Access
        </Button>
      </SheetTrigger>
      <SheetContent className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Manage Collaborators</SheetTitle>
        </SheetHeader>
        <div className="mt-6 space-y-6">
          {/* Invite Section */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <UserPlus className="h-4 w-4 text-muted-foreground" />
              <h3 className="font-medium">Invite New Collaborator</h3>
            </div>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email address</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="collaborator@example.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="access">Access level</Label>
                <Select
                  value={inviteAccessLevel}
                  onValueChange={(value: "view" | "edit") => setInviteAccessLevel(value)}
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
          </div>

          <Separator />

          {/* Existing Collaborators Section */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <h3 className="font-medium">Current Collaborators</h3>
            </div>
            
            {loading ? (
              <div className="text-muted-foreground text-sm">Loading collaborators...</div>
            ) : collaborators.length === 0 ? (
              <div className="text-muted-foreground text-sm">No collaborators yet</div>
            ) : (
              <div className="space-y-3">
                {collaborators.map((collaborator) => (
                  <div
                    key={collaborator.id}
                    className="flex items-center justify-between p-3 bg-muted/50 rounded-lg hover:bg-muted/80 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="font-medium truncate">{collaborator.invited_email}</span>
                        {/* <Badge variant="secondary" className="shrink-0">
                          {collaborator.status === 'pending' ? 'Pending' : 'Joined'}
                        </Badge> */}
                      </div>
                      <div className="flex items-center gap-3">
                        <Select
                          value={collaborator.access_level}
                          onValueChange={(value: "view" | "edit") => 
                            handleAccessLevelChange(collaborator.id, value)
                          }
                          disabled={updating === collaborator.id}
                        >
                          <SelectTrigger className="h-8">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="view">View only</SelectItem>
                            <SelectItem value="edit">Can edit</SelectItem>
                          </SelectContent>
                        </Select>
                        {updating === collaborator.id && (
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Clock className="h-3 w-3 animate-spin" />
                            <span>Updating...</span>
                          </div>
                        )}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRevokeAccess(collaborator.id)}
                      disabled={updating === collaborator.id}
                      className="text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
                    >
                      Revoke
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
