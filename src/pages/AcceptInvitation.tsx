import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export default function AcceptInvitation() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const acceptInvitation = async () => {
      try {
        const bookId = searchParams.get("bookId");
        const email = searchParams.get("email");

        if (!bookId || !email) {
          throw new Error("Invalid invitation link");
        }

        // Get current user
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (userError) throw userError;
        if (!user) {
          // If user is not logged in, redirect to auth page with return URL
          const currentUrl = window.location.href;
          navigate(`/auth?returnTo=${encodeURIComponent(currentUrl)}`);
          return;
        }

        // Verify user email matches invitation email
        if (user.email !== email) {
          throw new Error("Please log in with the email address that received the invitation.");
        }

        console.log("Accepting invitation for book:", bookId, "user:", user.id);

        // Update the book_access record with the user's ID
        const { error: updateError } = await supabase
          .from("book_access")
          .update({ user_id: user.id })
          .eq("book_id", bookId)
          .is("user_id", null);

        if (updateError) throw updateError;

        toast({
          title: "Invitation accepted",
          description: "You now have access to the book"
        });

        // Redirect to the book page
        navigate(`/book/${bookId}`);
      } catch (err: any) {
        console.error("Error accepting invitation:", err);
        setError(err.message);
        toast({
          variant: "destructive",
          title: "Error accepting invitation",
          description: err.message
        });
      } finally {
        setLoading(false);
      }
    };

    acceptInvitation();
  }, [searchParams, navigate, toast]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-semibold text-red-600 mb-2">Error</h1>
          <p className="text-gray-600">{error}</p>
        </div>
      </div>
    );
  }

  return null;
}