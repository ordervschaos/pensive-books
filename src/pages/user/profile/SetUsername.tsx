
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";

export default function SetUsername() {
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        navigate("/auth");
        return;
      }

      const { error } = await supabase
        .from('user_data')
        .upsert({ 
          user_id: session.user.id,
          username: username.toLowerCase(),
        });

      if (error) throw error;

      toast({
        title: "Username set successfully",
        description: "Redirecting to your public profile...",
      });

      // Redirect to their public profile
      window.open(`/@${username}`, '_blank');
      navigate("/my-books");
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error setting username",
        description: error.message,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container max-w-lg mx-auto p-6">
      <Card className="p-6">
        <h1 className="text-2xl font-bold mb-6">Set Your Username</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="username">Username</Label>
            <Input
              id="username"
              type="text"
              placeholder="Enter your username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              pattern="^[a-zA-Z0-9_\.]+$"
              title="Username can only contain letters, numbers, dots, and underscores"
              className="w-full"
            />
            <p className="text-sm text-muted-foreground">
              This will be your public profile URL: @{username || "username"}
            </p>
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Setting username..." : "Set Username"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
