import { Shield } from "lucide-react";

interface AdminViewBannerProps {
  /** Owner's username/email, when known. */
  ownerLabel?: string | null;
}

/**
 * Shown when an admin is viewing/editing a book they don't own (access granted
 * via the admin override). Makes it unmistakable that edits land on someone
 * else's book.
 */
export function AdminViewBanner({ ownerLabel }: AdminViewBannerProps) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
      <Shield className="h-4 w-4 shrink-0" />
      <span>
        <span className="font-medium">Admin view.</span> You're editing a book
        owned by{" "}
        <span className="font-medium">{ownerLabel || "another user"}</span>.
        Changes are saved to their book.
      </span>
    </div>
  );
}
