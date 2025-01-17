import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { AuthError, AuthApiError } from "@supabase/supabase-js";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";

const Auth = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showOTPInput, setShowOTPInput] = useState(false);
  const [otpValue, setOTPValue] = useState("");

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log("Auth event:", event);
      if (event === "SIGNED_IN" && session) {
        console.log("User signed in:", session.user);
        navigate("/");
      }
      if (event === "SIGNED_OUT") {
        console.log("User signed out");
      }
      if (event === "USER_UPDATED" || event === "PASSWORD_RECOVERY") {
        console.log("Auth state updated:", event);
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  const handleSendOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`
        }
      });

      if (error) throw error;

      setShowOTPInput(true);
      toast({
        title: "OTP Sent",
        description: "Check your email for the login code.",
      });
    } catch (error) {
      console.error("OTP error:", error);
      let errorMessage = "Failed to send OTP";
      
      if (error instanceof AuthApiError) {
        switch (error.status) {
          case 400:
            errorMessage = "Invalid email format. Please check your email address.";
            break;
          case 422:
            errorMessage = "Invalid email format. Please enter a valid email address.";
            break;
          default:
            errorMessage = error.message;
        }
      }
      
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOTP = async () => {
    if (otpValue.length !== 6) {
      toast({
        title: "Error",
        description: "Please enter a valid 6-digit code",
        variant: "destructive"
      });
      return;
    }

    setIsLoading(true);
    try {
      const { error } = await supabase.auth.verifyOtp({
        email,
        token: otpValue,
        type: 'email'
      });

      if (error) throw error;

      toast({
        title: "Success",
        description: "Successfully verified. Redirecting...",
      });
    } catch (error) {
      console.error("Verification error:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to verify code",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md p-8 space-y-4 bg-white rounded-lg shadow-lg">
        <h1 className="text-2xl font-bold text-center text-gray-900">Welcome Back</h1>
        <p className="text-center text-gray-600">Sign in with One-Time Password</p>
        
        {!showOTPInput ? (
          <form onSubmit={handleSendOTP} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                Email address
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-black focus:border-black"
                placeholder="Enter your email"
                required
              />
            </div>
            <button
              type="submit"
              disabled={isLoading}
              className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-black hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-black disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? "Sending..." : "Send Login Code"}
            </button>
          </form>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Enter verification code
              </label>
              <InputOTP
                value={otpValue}
                onChange={setOTPValue}
                maxLength={6}
                render={({ slots }) => (
                  <InputOTPGroup className="gap-2 flex justify-center">
                    {slots.map((slot, idx) => (
                      <InputOTPSlot key={idx} {...slot} index={idx} />
                    ))}
                  </InputOTPGroup>
                )}
              />
            </div>
            <button
              onClick={handleVerifyOTP}
              disabled={isLoading || otpValue.length !== 6}
              className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-black hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-black disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? "Verifying..." : "Verify Code"}
            </button>
            <button
              onClick={() => {
                setShowOTPInput(false);
                setOTPValue("");
              }}
              className="w-full flex justify-center py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-black"
            >
              Back to Email
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default Auth;