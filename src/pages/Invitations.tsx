import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { TopNav } from "@/components/TopNav";

interface Invitation {
  id: number;
  book_id: number;
  access_level: "view" | "edit";
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
  const { toast } = useToast();

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
            owner:user_data (
              email
            )
          )
        `)
        .eq('status', 'pending');

      if (error) throw error;
      
      // Ensure the data matches the Invitation type
      const typedInvitations = (invitationsData || []).map(inv => ({
        ...inv,
        book: {
          ...inv.book,
          owner: inv.book?.owner || { email: 'Unknown' }
        }
      })) as Invitation[];
      
      setInvitations(typedInvitations);
    } catch (error: any) {
      console.error('Error fetching invitations:', error);
      toast({
        variant: "destructive",
        title: "Error fetching invitations",
        description: error.message
      });
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <TopNav />
      <div className="container mx-auto p-6">
        <h1 className="text-2xl font-bold mb-4">Pending Invitations</h1>
        {invitations.length === 0 ? (
          <p>No pending invitations.</p>
        ) : (
          <ul>
            {invitations.map(invitation => (
              <li key={invitation.id} className="mb-4">
                <div className="p-4 border rounded">
                  <h2 className="text-lg font-semibold">{invitation.book.name}</h2>
                  <p>Access Level: {invitation.access_level}</p>
                  <p>Invited on: {new Date(invitation.created_at).toLocaleDateString()}</p>
                  <p>Owner Email: {invitation.book.owner.email}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
