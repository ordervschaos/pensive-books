"use client";

import { useEffect, useRef, useState } from "react";
import { LogIn, LogOut, User, BookOpen, UserCircle, MessageSquare } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useCrisp } from "@/lib/useCrisp";

type Props = {
  appOrigin: string;
};

interface UserProfile {
  name: string | null;
  username: string | null;
  profile_pic: string | null;
}

function getInitials(profile: UserProfile | null): string {
  if (profile?.name) {
    return profile.name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
  }
  if (profile?.username) return profile.username.slice(0, 2).toUpperCase();
  return "?";
}

export function PublicUserMenu({ appOrigin }: Props) {
  const [open, setOpen] = useState(false);
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const { openFeedback } = useCrisp();

  useEffect(() => {
    const supabase = createClient();

    supabase.auth.getSession().then(({ data: { session } }) => {
      setAuthenticated(!!session);
      if (session?.user) {
        supabase
          .from("user_data")
          .select("name, username, profile_pic")
          .eq("user_id", session.user.id)
          .single()
          .then(({ data }) => { if (data) setProfile(data as UserProfile); });
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthenticated(!!session);
      if (!session) setProfile(null);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onEscape);
    };
  }, []);

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    setOpen(false);
    window.location.href = "/";
  }

  // Avatar circle
  const avatarEl = authenticated && profile ? (
    <div
      className="relative h-7 w-7 flex-none overflow-hidden rounded-full ring-1 ring-border"
      aria-hidden
    >
      {profile.profile_pic ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={profile.profile_pic} alt={profile.username ?? "avatar"} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-muted text-[11px] font-medium text-muted-foreground">
          {getInitials(profile)}
        </div>
      )}
    </div>
  ) : (
    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-muted" aria-hidden>
      <User className="h-3.5 w-3.5 text-muted-foreground" />
    </div>
  );

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Account menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        {avatarEl}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-48 rounded-md border bg-popover text-popover-foreground shadow-md">
          {authenticated && profile ? (
            <>
              <div className="px-3 py-2.5">
                <p className="text-sm font-medium leading-none">{profile.name || profile.username}</p>
                {profile.name && profile.username && (
                  <p className="mt-1 font-mono text-[11px] tracking-wide text-muted-foreground">
                    @{profile.username}
                  </p>
                )}
              </div>
              <div className="h-px bg-border" />
              <div className="p-1">
                <a
                  href={`${appOrigin}/books`}
                  className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  <BookOpen className="mr-2 h-4 w-4" />
                  My Books
                </a>
                <a
                  href={`${appOrigin}/user/profile/edit`}
                  className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  <UserCircle className="mr-2 h-4 w-4" />
                  Edit Profile
                </a>
              </div>
              <div className="h-px bg-border" />
              <div className="p-1">
                <button
                  type="button"
                  onClick={() => { openFeedback(); setOpen(false); }}
                  className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  <MessageSquare className="mr-2 h-4 w-4" />
                  Send Feedback
                </button>
              </div>
              <div className="h-px bg-border" />
              <div className="p-1">
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  Sign Out
                </button>
              </div>
            </>
          ) : (
            <div className="p-1">
              <a
                href={`${appOrigin}/auth`}
                className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                <LogIn className="mr-2 h-4 w-4" />
                Sign In
              </a>
              <button
                type="button"
                onClick={() => { openFeedback(); setOpen(false); }}
                className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                <MessageSquare className="mr-2 h-4 w-4" />
                Send Feedback
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
