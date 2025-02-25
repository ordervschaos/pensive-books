
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { PageLoading } from '@/components/page/PageLoading';
import { useToast } from '@/hooks/use-toast';

export default function JoinBook() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const joinBook = async () => {
      if (!token) {
        navigate('/');
        return;
      }

      try {
        // Get the invitation details
        const { data: invitation, error: inviteError } = await supabase
          .from('book_access')
          .select('*')
          .eq('invitation_token', token)
          .single();

        if (inviteError || !invitation) {
          throw new Error('Invalid or expired invitation');
        }

        // Get the book details
        const { data: book } = await supabase
          .from('books')
          .select('id, name')
          .eq('id', invitation.book_id)
          .single();

        if (!book) {
          throw new Error('Book not found');
        }

        // Get current user
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          // Store the token to use after authentication
          localStorage.setItem('pendingInvitation', token);
          navigate('/auth');
          return;
        }

        // Update the invitation with the user's ID
        const { error: updateError } = await supabase
          .from('book_access')
          .update({ 
            user_id: session.user.id,
            status: 'accepted'
          })
          .eq('invitation_token', token);

        if (updateError) {
          throw updateError;
        }

        toast({
          title: "Success!",
          description: `You have been added to "${book.name}"`
        });

        // Redirect to the book
        navigate(`/book/${book.id}`);
      } catch (error: any) {
        console.error('Error joining book:', error);
        toast({
          variant: "destructive",
          title: "Error",
          description: error.message || "Failed to join book"
        });
        navigate('/');
      } finally {
        setLoading(false);
      }
    };

    joinBook();
  }, [token, navigate, toast]);

  if (loading) {
    return <PageLoading />;
  }

  return null;
}
