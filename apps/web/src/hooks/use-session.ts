
import { useEffect, useState } from 'react';
import { supabase } from "@/integrations/supabase/client";
import { Session } from '@supabase/supabase-js';

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Initial session check
    const getInitialSession = async () => {
      try {
        setIsLoading(true);
        const { data: { session } } = await supabase.auth.getSession();
        setSession(session);
      } catch (error) {
        console.error('Error getting session:', error);
      } finally {
        setIsLoading(false);
      }
    };

    getInitialSession();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
    });

    // Clean up subscription on unmount
    return () => {
      subscription.unsubscribe();
    };
  }, []);

  return { session, isLoading };
}
