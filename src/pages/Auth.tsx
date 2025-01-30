import { useEffect, useState } from "react";
import { useNavigate, useLocation, useSearchParams } from "react-router-dom";
import { Auth as SupabaseAuth } from "@supabase/auth-ui-react";
import { ThemeSupa } from "@supabase/auth-ui-shared";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function Auth() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const returnTo = location.state?.returnTo || searchParams.get("returnTo") || "/my-books";
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [showOtpInput, setShowOtpInput] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const handleAuthChange = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        console.log("Current session:", session);
        
        if (session) {
          console.log("User is authenticated, redirecting to:", returnTo);
          const redirectPath = window.location.hostname === "www.pensive.me" 
            ? returnTo.replace("/auth", "") 
            : returnTo;
          navigate(redirectPath, { replace: true });
        }
      } catch (error) {
        console.error("Error checking auth state:", error);
      }
    };

    handleAuthChange();

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log("Auth state change event:", event, "Session:", session);
      
      if (event === 'SIGNED_IN' && session) {
        console.log("User signed in, redirecting to:", returnTo);
        const redirectPath = window.location.hostname === "www.pensive.me" 
          ? returnTo.replace("/auth", "") 
          : returnTo;
        navigate(redirectPath, { replace: true });
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [navigate, returnTo]);

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const redirectTo = window.location.hostname === "www.pensive.me"
        ? `${window.location.origin}/auth/callback`
        : `${window.location.origin}/auth/callback`;

      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: redirectTo,
          data: {
            returnTo: returnTo,
          }
        },
      });

      if (error) throw error;

      setShowOtpInput(true);
      toast({
        title: "Check your email",
        description: "We've sent you a login code.",
      });
    } catch (error: any) {
      console.error("Error sending OTP:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to send login code. Please try again.",
      });
    }
  };

  const handleOtpVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const { error } = await supabase.auth.verifyOtp({
        email,
        token: otp,
        type: "email",
      });

      if (error) throw error;

      toast({
        title: "Success",
        description: "You've been successfully logged in.",
      });
    } catch (error: any) {
      console.error("Error verifying OTP:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Invalid code. Please try again.",
      });
    }
  };

  return (
    <div className="container max-w-lg mx-auto p-6">
      <Card>
        <CardHeader>
          <CardTitle>Welcome back</CardTitle>
          <CardDescription>Sign in to your account to continue</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="oauth">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="oauth">Social Login</TabsTrigger>
              <TabsTrigger value="email">Email Login</TabsTrigger>
            </TabsList>
            <TabsContent value="oauth">
              <SupabaseAuth
                supabaseClient={supabase}
                appearance={{ theme: ThemeSupa }}
                theme="light"
                providers={["google"]}
                redirectTo={`${window.location.origin}/auth/callback`}
                onlyThirdPartyProviders
              />
            </TabsContent>
            <TabsContent value="email">
              {!showOtpInput ? (
                <form onSubmit={handleEmailSubmit} className="space-y-4">
                  <div>
                    <Input
                      type="email"
                      placeholder="Enter your email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>
                  <Button type="submit" className="w-full">
                    Send Login Code
                  </Button>
                </form>
              ) : (
                <form onSubmit={handleOtpVerify} className="space-y-4">
                  <div>
                    <Input
                      type="text"
                      placeholder="Enter the code sent to your email"
                      value={otp}
                      onChange={(e) => setOtp(e.target.value)}
                      required
                    />
                  </div>
                  <Button type="submit" className="w-full">
                    Verify Code
                  </Button>
                </form>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}