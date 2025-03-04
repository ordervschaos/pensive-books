import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft } from "lucide-react";

export default function KindleSettings() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [loading, setLoading] = useState(false);

  const handleVerification = async () => {
    if (!email) {
      toast({
        title: "Missing email",
        description: "Please provide your email address",
        variant: "destructive",
      });
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast({
        title: "Invalid email",
        description: "Please enter a valid email address",
        variant: "destructive",
      });
      return;
    }

    try {
      setLoading(true);
      const { error } = await supabase.functions.invoke("send-verification-email", {
        body: { email },
      });

      if (error) {
        throw new Error(error.message);
      }

      toast({
        title: "Verification email sent",
        description: "Please check your email inbox for the verification code",
        variant: "default",
      });

      // Store the email in local storage
      localStorage.setItem("kindle_email", email);
    } catch (error: any) {
      toast({
        title: "Error sending verification email",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleKindleEmail = async () => {
    if (!verificationCode) {
      toast({
        title: "Missing verification code",
        description: "Please provide the verification code",
        variant: "destructive",
      });
      return;
    }

    const storedEmail = localStorage.getItem("kindle_email");
    if (!storedEmail) {
      toast({
        title: "Missing email",
        description: "Please provide your email address",
        variant: "destructive",
      });
      return;
    }

    try {
      setLoading(true);
      const { data, error } = await supabase.functions.invoke("verify-email", {
        body: { email: storedEmail, code: verificationCode },
      });

      if (error) {
        throw new Error(error.message);
      }

      toast({
        title: "Email verified",
        description: "Your email has been successfully verified",
      });
    } catch (error: any) {
      toast({
        title: "Error verifying email",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto p-6">
        <div className="flex items-center gap-4 mb-8">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/settings")}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-2xl font-semibold">Kindle Settings</h1>
        </div>

        <Card className="max-w-md mx-auto">
          <CardContent className="p-6">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email Address</Label>
                <Input
                  id="email"
                  placeholder="Enter your email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <Button
                className="w-full"
                onClick={handleVerification}
                disabled={loading}
              >
                {loading ? "Sending..." : "Send Verification Code"}
              </Button>
              <div className="space-y-2">
                <Label htmlFor="verificationCode">Verification Code</Label>
                <Input
                  id="verificationCode"
                  placeholder="Enter verification code"
                  type="text"
                  value={verificationCode}
                  onChange={(e) => setVerificationCode(e.target.value)}
                />
              </div>
              <Button
                className="w-full"
                onClick={handleKindleEmail}
                disabled={loading}
              >
                {loading ? "Verifying..." : "Verify Email"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
