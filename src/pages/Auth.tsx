import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Auth as SupabaseAuth } from "@supabase/auth-ui-react";
import { ThemeSupa } from "@supabase/auth-ui-shared";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/use-toast";

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
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md p-8 space-y-4 bg-white rounded-lg shadow-lg">
        <h1 className="text-2xl font-bold text-center text-gray-900">Welcome Back</h1>
        <p className="text-center text-gray-600">Sign in to access your notebooks</p>
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
          providers={["google"]}
          redirectTo={`${window.location.origin}/auth/callback`}
          onError={(error) => {
            console.error("Auth error:", error);
            toast({
              title: "Authentication Error",
              description: error.message,
              variant: "destructive"
            });
          }}
        />
      </div>
    </div>
  );
};

export default Auth;