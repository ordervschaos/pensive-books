import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Auth as SupabaseAuth } from "@supabase/auth-ui-react";
import { ThemeSupa } from "@supabase/auth-ui-shared";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/use-toast";
import { AuthError, AuthApiError } from "@supabase/supabase-js";

const Auth = () => {
  const navigate = useNavigate();

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

  const handleError = (error: AuthError) => {
    console.error("Auth error:", error);
    let errorMessage = "An error occurred during authentication";
    
    if (error instanceof AuthApiError) {
      switch (error.status) {
        case 400:
          if (error.message.includes("invalid_credentials")) {
            errorMessage = "Invalid email or password. Please check your credentials and try again.";
          }
          break;
        case 422:
          errorMessage = "Invalid email format. Please enter a valid email address.";
          break;
        default:
          errorMessage = error.message;
      }
    }
    
    toast({
      title: "Authentication Error",
      description: errorMessage,
      variant: "destructive"
    });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md p-8 space-y-4 bg-white rounded-lg shadow-lg">
        <h1 className="text-2xl font-bold text-center text-gray-900">Welcome Back</h1>
        <p className="text-center text-gray-600">Sign in with One-Time Password</p>
        <SupabaseAuth 
          supabaseClient={supabase}
          appearance={{ 
            theme: ThemeSupa,
            variables: {
              default: {
                colors: {
                  brand: '#000000',
                  brandAccent: '#333333',
                }
              }
            }
          }}
          providers={[]}
          view="sign_in"
          showLinks={false}
          otpType="email"
          redirectTo={`${window.location.origin}/auth/callback`}
        />
      </div>
    </div>
  );
};

export default Auth;