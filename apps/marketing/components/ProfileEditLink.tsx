"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Edit } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Props = {
  profileUserId: string;
  appOrigin: string;
};

export function ProfileEditLink({ profileUserId, appOrigin }: Props) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function checkOwnership() {
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!cancelled) {
          setShow(user?.id === profileUserId);
        }
      } catch (error) {
        console.error("Failed to resolve public profile ownership:", error);
      }
    }

    checkOwnership();

    return () => {
      cancelled = true;
    };
  }, [profileUserId]);

  if (!show) {
    return null;
  }

  return (
    <Link
      href={`${appOrigin}/user/profile/edit`}
      className="inline-flex items-center gap-2 rounded-md border border-input px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
    >
      <Edit className="h-4 w-4" />
      Edit Profile
    </Link>
  );
}
