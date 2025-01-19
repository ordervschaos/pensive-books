import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

export default function AcceptInvitation() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const acceptInvitation = async () => {
      try {
        const bookId = searchParams.get("bookId");
        if (!bookId) {
          throw new Error("No book ID provided in the invitation link");
        }

        // Get current user
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (userError) throw userError;
        if (!user) {
          // Store the return URL and redirect to login
          navigate("/auth", { 
            state: { 
              returnTo: `/accept-invitation?${searchParams.toString()}`
            } 
          });
          return;
        }

        // Check if invitation exists
        const { data: accessData, error: accessError } = await supabase
          .from("book_access")
          .select("*")
          .eq("book_id", bookId)
          .is("user_id", null)
          .maybeSingle();

        if (accessError) throw accessError;
        
        if (!accessData) {
          toast({
            variant: "destructive",
            title: "Invalid invitation",
            description: "This invitation link is invalid or has already been used"
          });
          navigate("/");
          return;
        }

        // Update the book access record with the user's ID
        const { error: updateError } = await supabase
          .from("book_access")
          .update({ user_id: user.id })
          .eq("id", accessData.id);

        if (updateError) throw updateError;

        // Get book details for the success message
        const { data: bookData, error: bookError } = await supabase
          .from("books")
          .select("name")
          .eq("id", bookId)
          .single();

        if (bookError) throw bookError;

        toast({
          title: "Invitation accepted",
          description: `You now have access to "${bookData.name}"`
        });

        // Redirect to the book
        navigate(`/book/${bookId}`);
      } catch (error: any) {
        console.error("Error accepting invitation:", error);
        toast({
          variant: "destructive",
          title: "Error accepting invitation",
          description: error.message
        });
        navigate("/");
      } finally {
        setLoading(false);
      }
    };

    acceptInvitation();
  }, [searchParams, navigate, toast]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return null;
}