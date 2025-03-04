
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Loader2, Users, X, Check, MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface CollaboratorData {
  id: string;
  email?: string;
  status: string;
  invitation_sent_at: string;
  invitation_token: string;
  user_id?: string;
  name?: string;
  username?: string;
}

interface ManageCollaboratorsSheetProps {
  bookId: number;
  onCollaboratorAdded?: () => void;
}

export function ManageCollaboratorsSheet({ bookId, onCollaboratorAdded }: ManageCollaboratorsSheetProps) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [collaborators, setCollaborators] = useState<CollaboratorData[]>([]);
  const [loadingCollaborators, setLoadingCollaborators] = useState(false);
  const { toast } = useToast();

  const fetchCollaborators = async () => {
    if (!bookId) return;
    
    try {
      setLoadingCollaborators(true);
      
      const { data, error } = await supabase
        .from("book_access")
        .select(`
          id,
          email,
          status,
          invitation_sent_at,
          invitation_token,
          user_id,
          profiles:user_id (
            username,
            name
          )
        `)
        .eq("book_id", bookId);
        
      if (error) throw error;
      
      if (data) {
        const formattedData = data.map(item => ({
          id: item.id,
          email: item.email,
          status: item.status,
          invitation_sent_at: item.invitation_sent_at,
          invitation_token: item.invitation_token,
          user_id: item.user_id,
          name: item.profiles?.name,
          username: item.profiles?.username,
        }));
        
        setCollaborators(formattedData);
      }
    } catch (error) {
      console.error("Error fetching collaborators:", error);
      toast({
        title: "Error",
        description: "Failed to load collaborators.",
        variant: "destructive",
      });
    } finally {
      setLoadingCollaborators(false);
    }
  };

  useEffect(() => {
    if (open) {
      fetchCollaborators();
    }
  }, [open, bookId]);

  const handleInvite = async () => {
    if (!email || !bookId) return;
    
    try {
      setLoading(true);
      
      // Check if the email is already invited
      const { data: existingInvite } = await supabase
        .from("book_access")
        .select("*")
        .eq("book_id", bookId)
        .eq("email", email.toLowerCase().trim());
        
      if (existingInvite && existingInvite.length > 0) {
        toast({
          title: "Already invited",
          description: "This email has already been invited to this book.",
          variant: "destructive",
        });
        return;
      }
      
      // Call the Supabase Edge Function to send invitation
      const { data, error } = await supabase.functions.invoke("send-book-invitation", {
        body: { 
          email: email.toLowerCase().trim(),
          bookId 
        },
      });
      
      if (error) throw error;
      
      if (data.error) throw new Error(data.error);
      
      toast({
        title: "Invitation sent",
        description: `An invitation has been sent to ${email}.`,
      });
      
      setEmail("");
      fetchCollaborators();
      
      if (onCollaboratorAdded) {
        onCollaboratorAdded();
      }
    } catch (error: any) {
      console.error("Error inviting collaborator:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to send invitation.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveCollaborator = async (accessId: string) => {
    if (!accessId) return;
    
    try {
      const { error } = await supabase
        .from("book_access")
        .delete()
        .eq("id", accessId);
        
      if (error) throw error;
      
      toast({
        title: "Collaborator removed",
        description: "The collaborator has been removed from this book.",
      });
      
      fetchCollaborators();
      
      if (onCollaboratorAdded) {
        onCollaboratorAdded();
      }
    } catch (error: any) {
      console.error("Error removing collaborator:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to remove collaborator.",
        variant: "destructive",
      });
    }
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" className="flex items-center gap-2">
          <Users className="h-4 w-4" />
          <span>Manage Collaborators</span>
        </Button>
      </SheetTrigger>
      <SheetContent className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Manage Collaborators</SheetTitle>
          <SheetDescription>
            Invite people to collaborate on this book.
          </SheetDescription>
        </SheetHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="email">Email address</Label>
            <div className="flex gap-2">
              <Input
                id="email"
                type="email"
                placeholder="Enter email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <Button onClick={handleInvite} disabled={loading || !email}>
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Invite"
                )}
              </Button>
            </div>
          </div>
          <div className="mt-4">
            <h3 className="text-sm font-medium mb-2">Collaborators</h3>
            {loadingCollaborators ? (
              <div className="flex justify-center p-4">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : collaborators.length === 0 ? (
              <p className="text-sm text-muted-foreground">No collaborators yet.</p>
            ) : (
              <div className="space-y-2">
                {collaborators.map((collaborator) => (
                  <div key={collaborator.id} className="flex items-center justify-between p-2 border rounded-md">
                    <div>
                      <p className="text-sm font-medium">
                        {collaborator.name || collaborator.username || collaborator.email}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {collaborator.status === "pending" ? "Invitation pending" : "Active"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {collaborator.status === "pending" ? (
                        <span className="text-xs text-yellow-500 flex items-center gap-1">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Pending
                        </span>
                      ) : (
                        <span className="text-xs text-green-500 flex items-center gap-1">
                          <Check className="h-3 w-3" />
                          Accepted
                        </span>
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem 
                            className="text-red-500"
                            onClick={() => handleRemoveCollaborator(collaborator.id)}
                          >
                            <X className="h-4 w-4 mr-2" />
                            Remove
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
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
