import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LogOut, LogIn, User, Tablet, MessageSquare } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { useCrisp } from "@/hooks/useCrisp";

interface UserMenuProps {
  isAuthenticated: boolean;
  handleLogout: () => void;
  handleLogin: () => void;
}

interface UserProfile {
  name: string | null;
  username: string | null;
  profile_pic: string | null;
}

function getInitials(profile: UserProfile | null): string {
  if (profile?.name) {
    return profile.name
      .split(" ")
      .map((w) => w[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  }
  if (profile?.username) {
    return profile.username.slice(0, 2).toUpperCase();
  }
  return "?";
}

export function UserMenu({ isAuthenticated, handleLogout, handleLogin }: UserMenuProps) {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const { openFeedback } = useCrisp();

  useEffect(() => {
    if (!isAuthenticated) {
      setProfile(null);
      return;
    }

    let cancelled = false;

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user || cancelled) return;
      supabase
        .from("user_data")
        .select("name, username, profile_pic")
        .eq("user_id", user.id)
        .single()
        .then(({ data }) => {
          if (!cancelled && data) setProfile(data as UserProfile);
        });
    });

    return () => { cancelled = true; };
  }, [isAuthenticated]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex items-center justify-center rounded-full outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          aria-label="Account menu"
        >
          {isAuthenticated ? (
            <Avatar className="h-7 w-7 cursor-pointer">
              <AvatarImage src={profile?.profile_pic ?? undefined} alt={profile?.username ?? "User"} />
              <AvatarFallback className="text-[11px] font-medium">
                {getInitials(profile)}
              </AvatarFallback>
            </Avatar>
          ) : (
            <Avatar className="h-7 w-7 cursor-pointer">
              <AvatarFallback>
                <User className="h-3.5 w-3.5" />
              </AvatarFallback>
            </Avatar>
          )}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="min-w-[180px]">
        {isAuthenticated && profile && (
          <>
            <DropdownMenuLabel className="font-normal">
              <p className="text-sm font-medium leading-none">{profile.name || profile.username}</p>
              {profile.name && profile.username && (
                <p className="mt-1 font-mono text-[11px] text-muted-foreground tracking-wide">
                  @{profile.username}
                </p>
              )}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
          </>
        )}

        {isAuthenticated ? (
          <>
            <DropdownMenuItem onClick={() => navigate("/user/profile/edit")}>
              <User className="mr-2 h-4 w-4" />
              Edit Profile
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate("/settings/kindle")}>
              <Tablet className="mr-2 h-4 w-4" />
              Kindle Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={openFeedback}>
              <MessageSquare className="mr-2 h-4 w-4" />
              Send Feedback
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout} className="text-muted-foreground">
              <LogOut className="mr-2 h-4 w-4" />
              Sign Out
            </DropdownMenuItem>
          </>
        ) : (
          <DropdownMenuItem onClick={handleLogin}>
            <LogIn className="mr-2 h-4 w-4" />
            Sign In
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
