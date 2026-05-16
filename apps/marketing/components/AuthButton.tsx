"use client";

import { useEffect, useState } from "react";
import { LogIn, LogOut } from "lucide-react";
import { IconButton, IconLink, iconButtonClass } from "@pensive/shared/ui/icon-button";
import { createClient } from "@/lib/supabase/client";

type Props = {
  appOrigin: string;
};

export function AuthButton({ appOrigin }: Props) {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    const supabase = createClient();

    supabase.auth.getSession().then(({ data: { session } }) => {
      setAuthenticated(!!session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthenticated(!!session);
    });

    return () => subscription.unsubscribe();
  }, []);

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  if (authenticated === null) {
    return <div className={iconButtonClass} aria-hidden />;
  }

  if (authenticated) {
    return (
      <IconButton aria-label="Sign out" onClick={handleSignOut}>
        <LogOut className="h-4 w-4" />
      </IconButton>
    );
  }

  return (
    <IconLink href={`${appOrigin}/auth`} aria-label="Sign in">
      <LogIn className="h-4 w-4" />
    </IconLink>
  );
}
