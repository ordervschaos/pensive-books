import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useSession } from './use-session';

const LOCAL_KEY = 'mature_content_enabled';

export function useMatureContent() {
  const { session, isLoading: sessionLoading } = useSession();
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (sessionLoading) return;

    if (session) {
      supabase
        .from('user_data')
        .select('mature_content_enabled')
        .eq('user_id', session.user.id)
        .single()
        .then(({ data }) => {
          if (data?.mature_content_enabled !== null && data?.mature_content_enabled !== undefined) {
            // Account preference is explicitly set — use it
            setEnabled(Boolean(data.mature_content_enabled));
          } else {
            // Not set in account yet — fall back to local, and sync upward
            const local = localStorage.getItem(LOCAL_KEY) === 'true';
            setEnabled(local);
            if (local) {
              supabase
                .from('user_data')
                .update({ mature_content_enabled: true })
                .eq('user_id', session.user.id);
            }
          }
          setLoading(false);
        });
    } else {
      setEnabled(localStorage.getItem(LOCAL_KEY) === 'true');
      setLoading(false);
    }
  }, [session, sessionLoading]);

  const toggle = useCallback(async (value: boolean) => {
    setEnabled(value);
    localStorage.setItem(LOCAL_KEY, String(value));
    if (session) {
      await supabase
        .from('user_data')
        .update({ mature_content_enabled: value })
        .eq('user_id', session.user.id);
    }
  }, [session]);

  return { enabled, loading, toggle };
}
