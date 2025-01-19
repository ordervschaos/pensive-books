import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface Invitation {
  id: number;
  book_id: number;
  access_level: 'view' | 'edit';
  created_at: string;
  book: {
    name: string;
    owner: {
      email: string;
    };
  };
}

export default function Invitations() {
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    fetchInvitations();
  }, []);

  const fetchInvitations = async () => {
    try {
      const { data: invitationsData, error } = await supabase
        .from('book_access')
        .select(`
          id,
          book_id,
          access_level,
          created_at,
          book:books (
            name,
            owner:profiles (
              email
            )
          )
        `)
        .eq('status', 'pending');

      if (error) throw error;
      setInvitations(invitationsData as Invitation[] || []);
    } catch (error: any) {
      console.error('Error fetching invitations:', error);
      toast({
        variant: "destructive",
        title: "Error fetching invitations",
        description: error.message
      });
    } finally {
      setLoading(false);
    }
  };

  const handleAcceptInvitation = async (invitation: Invitation) => {
    try {
      const { error } = await supabase
        .from('book_access')
        .update({ status: 'accepted' })
        .eq('id', invitation.id);

      if (error) throw error;

      toast({
        title: "Invitation accepted",
        description: `You now have ${invitation.access_level} access to ${invitation.book.name}`
      });

      // Remove the invitation from the list
      setInvitations(invitations.filter(inv => inv.id !== invitation.id));

      // Navigate to the book
      navigate(`/book/${invitation.book_id}`);
    } catch (error: any) {
      console.error('Error accepting invitation:', error);
      toast({
        variant: "destructive",
        title: "Error accepting invitation",
        description: error.message
      });
    }
  };

  const handleDeclineInvitation = async (invitation: Invitation) => {
    try {
      const { error } = await supabase
        .from('book_access')
        .delete()
        .eq('id', invitation.id);

      if (error) throw error;

      toast({
        title: "Invitation declined",
        description: `You have declined access to ${invitation.book.name}`
      });

      // Remove the invitation from the list
      setInvitations(invitations.filter(inv => inv.id !== invitation.id));
    } catch (error: any) {
      console.error('Error declining invitation:', error);
      toast({
        variant: "destructive",
        title: "Error declining invitation",
        description: error.message
      });
    }
  };

  if (loading) {
    return <div className="container mx-auto p-6">Loading...</div>;
  }

  return (
    <div className="container mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">Book Invitations</h1>
      {invitations.length === 0 ? (
        <p className="text-muted-foreground">No pending invitations</p>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {invitations.map((invitation) => (
            <Card key={invitation.id}>
              <CardHeader>
                <CardTitle>{invitation.book.name}</CardTitle>
                <CardDescription>
                  Invited by {invitation.book.owner.email}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Access level: {invitation.access_level}
                </p>
              </CardContent>
              <CardFooter className="flex gap-2">
                <Button 
                  onClick={() => handleAcceptInvitation(invitation)}
                  className="flex-1"
                >
                  Accept
                </Button>
                <Button 
                  variant="outline"
                  onClick={() => handleDeclineInvitation(invitation)}
                  className="flex-1"
                >
                  Decline
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
