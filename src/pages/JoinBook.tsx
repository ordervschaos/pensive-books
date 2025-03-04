
import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useEffect } from "react";
import { useSession } from "@/hooks/use-session";
import { Loader2 } from "lucide-react";

export default function JoinBook() {
  const { bookId, token } = useParams<{ bookId: string; token: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { session, isLoading: isSessionLoading } = useSession();
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    if (!isSessionLoading && !session) {
      // Redirect to login if not authenticated
      navigate('/login');
    }
  }, [session, isSessionLoading, navigate]);

  if (isSessionLoading) {
    return <div>Loading...</div>;
  }

  const handleAcceptInvitation = async () => {
    if (!bookId || !token) {
      toast({
        title: "Missing information",
        description: "Book ID or invitation token is missing.",
        variant: "destructive",
      });
      return;
    }

    try {
      setProcessing(true);
      const bookIdNumber = parseInt(bookId, 10); // Convert string to number
    
      if (isNaN(bookIdNumber)) {
        throw new Error("Invalid book ID");
      }

      const { data: bookData, error: bookError } = await supabase
        .from("books")
        .select("*")
        .eq("id", bookIdNumber)
        .single();

      if (bookError) {
        throw new Error(bookError.message);
      }

      if (!bookData) {
        throw new Error("Book not found");
      }

      const { data: accessData, error: accessError } = await supabase
        .from("book_access")
        .update({ status: "accepted" })
        .eq("book_id", bookIdNumber) // Use the parsed number
        .eq("invitation_token", token)
        .select()
        .single();

      if (accessError) {
        throw new Error(accessError.message);
      }

      if (!accessData) {
        throw new Error("Invitation not found or already used.");
      }

      toast({
        title: "Invitation accepted",
        description: `You have successfully joined the book: ${bookData.name}`,
      });
      navigate(`/book/${bookId}`);
    } catch (error: any) {
      toast({
        title: "Error accepting invitation",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="flex items-center justify-center h-screen bg-background">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Join Book</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="space-y-2">
            <Label htmlFor="bookId">Book ID</Label>
            <Input id="bookId" value={bookId} readOnly />
          </div>
          <div className="space-y-2">
            <Label htmlFor="token">Invitation Token</Label>
            <Input id="token" value={token} readOnly />
          </div>
          <Button onClick={handleAcceptInvitation} disabled={processing}>
            {processing ? (
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Accepting...</span>
              </div>
            ) : (
              "Accept Invitation"
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
