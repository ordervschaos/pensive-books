"use client";

import { useEffect, useState } from "react";
import { LogIn, LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const iconButtonClass =
  "inline-flex h-11 w-11 items-center justify-center rounded-md border border-input bg-background text-foreground transition-colors hover:bg-accent hover:text-accent-foreground";

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
    return <div className="h-11 w-11 rounded-md border border-input bg-background" />;
  }

  if (authenticated) {
    return (
      <button
        type="button"
        aria-label="Sign out"
        onClick={handleSignOut}
        className={iconButtonClass}
      >
        <LogOut className="h-5 w-5" />
      </button>
    );
  }

  return (
    <a href={`${appOrigin}/auth`} aria-label="Sign in" className={iconButtonClass}>
      <LogIn className="h-5 w-5" />
    </a>
  );
}
