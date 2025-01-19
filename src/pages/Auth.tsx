import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Auth as SupabaseAuth } from "@supabase/auth-ui-react";
import { ThemeSupa } from "@supabase/auth-ui-shared";
import { supabase } from "@/integrations/supabase/client";

export default function Auth() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnTo = searchParams.get("returnTo");

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN") {
        // If there's a return URL, navigate to it, otherwise go to home
        navigate(returnTo || "/");
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate, returnTo]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-md p-8 space-y-4 bg-card rounded-lg shadow-lg">
        <h1 className="text-2xl font-semibold text-center">Welcome</h1>
        <SupabaseAuth 
          supabaseClient={supabase} 
          appearance={{ theme: ThemeSupa }}
          theme="light"
        />
      </div>
    </div>
  );
}