
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export default function JoinBook() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const {id:bookId} = useParams();

  useEffect(() => {
    const joinBook = async () => {
      try {
        const token = searchParams.get("token");
        const access = searchParams.get("access");
        const { data: { session } } = await supabase.auth.getSession();

        if (!session) {
          // Store the join URL in localStorage to redirect back after auth
          localStorage.setItem("returnTo", window.location.pathname + window.location.search);
          navigate("/auth");
          return;
        }

        if (!token || !access || !bookId) {
          throw new Error("Invalid invitation link");
        }

        // Check if user already has access
        const { data: existingAccess } = await supabase
          .from("book_access")
          .select("id")
          .eq("book_id", parseInt(bookId))
          .eq("invited_email", session.user.email)
          .single();

        if (!existingAccess) {
          // Create book access entry
          const { error: accessError } = await supabase
            .from("book_access")
            .insert({
              book_id: parseInt(bookId),
              invited_email: session.user.email,
              user_id: session.user.id,
              access_level: access as "view" | "edit",
              status: "accepted",
              invitation_token: token
            });

          if (accessError) {
            console.error("Error creating access:", accessError);
            throw new Error("Failed to accept invitation. Please try again.");
          }
        }

        toast({
          title: "Success",
          description: "You now have access to this book"
        });

        navigate(`/book/${bookId}`);
      } catch (error: any) {
        console.error("Error joining book:", error);
        toast({
          variant: "destructive",
          title: "Error joining book",
          description: error.message
        });
        navigate("/");
      } finally {
        setLoading(false);
      }
    };

    joinBook();
  }, [navigate, searchParams, toast, bookId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return null;
}
