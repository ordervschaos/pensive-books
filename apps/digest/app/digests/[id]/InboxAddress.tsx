import { inboxAddress } from "@/lib/pensive";

// The digest's own mail address, shown only when an `inbox` section exists — an address with nothing
// listening is just a confusing string. Rendered on the server: the token is not a secret from its owner,
// but it is the one thing that lets a stranger post into someone's morning, so it never travels further
// than the page that needs it.
export function InboxAddress({ token }: { token: string | null }) {
  const address = inboxAddress(token);

  return (
    <div className="rounded border border-rule bg-white/50 p-4 text-sm">
      <p className="font-mono text-xs uppercase tracking-wider text-muted">This digest&apos;s address</p>
      {address ? (
        <>
          <p className="mt-1 select-all font-mono text-base">{address}</p>
          <p className="mt-2 text-muted">
            Subscribe to newsletters with it, or forward mail here. Anything that arrives is eligible for the
            next issue — nothing is polled, and there is no source-quality problem to solve, because you
            already chose these writers.
          </p>
        </>
      ) : (
        <p className="mt-1 text-muted">
          No address yet — this digest predates inbound mail. Re-save it on the Settings tab, or run the
          <code> digest_inbox</code> migration.
        </p>
      )}
    </div>
  );
}
