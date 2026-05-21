import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useSession } from './use-session';

export function useAdmin() {
  const { session, isLoading: sessionLoading } = useSession();
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (sessionLoading) return;

    if (!session) {
      setIsAdmin(false);
      setLoading(false);
      return;
    }

    supabase
      .from('admin_users')
      .select('user_id')
      .eq('user_id', session.user.id)
      .maybeSingle()
      .then(({ data }) => {
        setIsAdmin(Boolean(data));
        setLoading(false);
      });
  }, [session, sessionLoading]);

  return { isAdmin, loading };
}
