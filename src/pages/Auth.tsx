import { useEffect, useState } from "react";
import { useNavigate, useSearchParams, useLocation } from "react-router-dom";
import { Auth as SupabaseAuth } from "@supabase/auth-ui-react";
import { ThemeSupa } from "@supabase/auth-ui-shared";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { useToast } from "@/hooks/use-toast";

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
          navigate(returnTo, { replace: true });
        }
      } catch (error) {
        console.error("Error checking auth state:", error);
      }
    };

    handleAuthChange();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log("Auth state change:", event, session);
      if (event === 'SIGNED_IN' && session) {
        console.log("User signed in, redirecting to:", returnTo);
        navigate(returnTo, { replace: true });
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [navigate, returnTo]);

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}${returnTo}`,
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
        type: 'email',
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
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md p-6 space-y-6">
        <h1 className="text-2xl font-semibold text-center">Welcome</h1>
        
        <Tabs defaultValue="password" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="password">Google</TabsTrigger>
            <TabsTrigger value="otp">Email Code</TabsTrigger>
          </TabsList>

          <TabsContent value="password">
            <SupabaseAuth 
              supabaseClient={supabase} 
              appearance={{ theme: ThemeSupa }}
              theme="light"
              providers={["google"]}
              redirectTo={`${window.location.origin}${returnTo}`}
              onlyThirdPartyProviders
            />
          </TabsContent>

          <TabsContent value="otp" className="space-y-4">
            {!showOtpInput ? (
              <form onSubmit={handleEmailSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email address</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="Enter your email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <Button type="submit" className="w-full">
                  Send Code
                </Button>
              </form>
            ) : (
              <form onSubmit={handleOtpVerify} className="space-y-4">
                <div className="space-y-2">
                  <Label>Enter the code sent to your email</Label>
                  <InputOTP
                    value={otp}
                    onChange={setOtp}
                    maxLength={6}
                    render={({ slots }) => (
                      <InputOTPGroup className="gap-2">
                        {slots.map((slot, idx) => (
                          <InputOTPSlot key={idx} {...slot} index={idx} />
                        ))}
                      </InputOTPGroup>
                    )}
                  />
                </div>
                <div className="space-y-2">
                  <Button type="submit" className="w-full">
                    Verify Code
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full"
                    onClick={() => setShowOtpInput(false)}
                  >
                    Back to Email
                  </Button>
                </div>
              </form>
            )}
          </TabsContent>
        </Tabs>
      </Card>
    </div>
  );
}