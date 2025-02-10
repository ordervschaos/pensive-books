import { useState, useEffect } from "react";
import { Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline">
          <Users className="mr-2 h-4 w-4" />
          Manage Access
        </Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Manage Collaborators</SheetTitle>
        </SheetHeader>
        <div className="mt-4">
          {loading ? (
            <div className="text-muted-foreground">Loading collaborators...</div>
          ) : collaborators.length === 0 ? (
            <div className="text-muted-foreground">No collaborators yet</div>
          ) : (
            <div className="space-y-4">
              {collaborators.map((collaborator) => (
                <div
                  key={collaborator.id}
                  className="flex items-center justify-between p-4 border rounded-lg"
                >
                  <div className="space-y-1">
                    <div>{collaborator.invited_email}</div>
                    <div className="flex items-center gap-2">
                      <Select
                        value={collaborator.access_level}
                        onValueChange={(value: "view" | "edit") => 
                          handleAccessLevelChange(collaborator.id, value)
                        }
                        disabled={updating === collaborator.id}
                      >
                        <SelectTrigger className="w-[100px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="view">View</SelectItem>
                          <SelectItem value="edit">Edit</SelectItem>
                        </SelectContent>
                      </Select>
                      <Badge variant="secondary">
                        {updating === collaborator.id ? "Updating..." : "access"}
                      </Badge>
                    </div>
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleRevokeAccess(collaborator.id)}
                    disabled={updating === collaborator.id}
                  >
                    Revoke
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
