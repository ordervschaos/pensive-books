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

// returnTo may be a same-app path ("/books") OR an absolute URL on a sibling Pensive origin
// (digest.pensive.me bounces here for sign-in because the SPA owns session refresh for the shared
// .pensive.me cookie). Absolute URLs are allow-listed by host — an unguarded returnTo is a textbook
// open-redirect (attacker mails ?returnTo=https://evil.example and borrows our login page's trust).
function isAllowedExternalReturn(value: string): boolean {
  try {
    const url = new URL(value, window.location.origin);
    if (url.origin === window.location.origin) return false; // same-origin → let the router handle it
    if (url.protocol !== "https:") return false;
    return url.hostname === "pensive.me" || url.hostname.endsWith(".pensive.me");
  } catch {
    return false;
  }
}

export default function Auth() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const returnTo = location.state?.returnTo || searchParams.get("returnTo") || "/books";

  // One exit for all three redirect sites below: cross-origin needs a full navigation (the router
  // cannot leave this origin), same-origin stays a client-side navigate.
  const goReturnTo = (to: string) => {
    if (isAllowedExternalReturn(to)) {
      window.location.replace(to);
      return;
    }
    navigate(to, { replace: true });
  };
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
          goReturnTo(returnTo);
        }
      } catch (error) {
        console.error("Error checking auth state:", error);
      }
    };

    // Handle the OAuth callback. PKCE requires exchanging the `code` URL
    // param for a session. `@supabase/ssr`'s auto-detect is unreliable when
    // the code_verifier cookie chunking/domain combo gets out of sync, so we
    // call exchangeCodeForSession explicitly and treat "already exchanged"
    // (code reused, session already present) as success.
    const handleCallback = async () => {
      if (location.pathname !== "/auth/callback") return;

      const code = searchParams.get("code");
      const errorParam = searchParams.get("error_description") || searchParams.get("error");

      if (errorParam) {
        toast({
          variant: "destructive",
          title: "Authentication Error",
          description: errorParam,
        });
        return;
      }

      try {
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) {
            const { data: { session: existing } } = await supabase.auth.getSession();
            if (!existing) throw error;
          }
        }

        const storedReturnTo = localStorage.getItem("returnTo");
        const redirectTo = storedReturnTo || returnTo;
        localStorage.removeItem("returnTo");

        goReturnTo(redirectTo);
      } catch (error) {
        console.error("Error handling callback:", error);
        toast({
          variant: "destructive",
          title: "Authentication Error",
          description: "There was a problem signing you in. Please try again.",
        });
      }
    };

    handleAuthChange();
    handleCallback();

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log("Auth state change event:", event, "Session:", session);
      
      if (event === 'SIGNED_IN' && session) {
        console.log("User signed in, redirecting to:", returnTo);
        goReturnTo(returnTo);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [navigate, returnTo, location.pathname, searchParams, toast]);

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      // Store the return URL before initiating the auth flow
      localStorage.setItem("returnTo", returnTo);
      
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
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