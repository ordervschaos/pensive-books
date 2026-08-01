import { createClient } from "@/lib/supabase/server";
import { appOrigin } from "@/lib/pensive";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { disconnectReadwise, saveReadwise } from "./actions";

export const dynamic = "force-dynamic";

const FIELD = "w-full rounded border border-rule bg-white px-3 py-2 text-sm";
const LABEL = "font-mono text-xs uppercase tracking-wider text-muted";

// ACCOUNT settings, not digest settings — the distinction is the whole reason this page exists. A Readwise
// token belongs to the person; every digest they own draws on the same vault. `/digests/:id/settings` stays
// the place for things that differ per digest (delivery time, voice, the web-search toggle).
export default async function AccountSettingsPage({
  searchParams,
}: {
  searchParams: { error?: string; ok?: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <p className="text-muted">
        Your session expired.{" "}
        <a className="underline" href={`${appOrigin()}/auth`}>
          Sign in again
        </a>
        .
      </p>
    );
  }

  const { data } = await supabase
    .from("digest_user_settings")
    .select("readwise_enabled, readwise_token, readwise_verified_at")
    .eq("user_id", user.id)
    .maybeSingle();

  const settings = data as {
    readwise_enabled: boolean;
    readwise_token: string | null;
    readwise_verified_at: string | null;
  } | null;

  // The stored secret never reaches the browser — only the fact that one exists, and its last four
  // characters so you can tell which key is in there.
  const connected = Boolean(settings?.readwise_token);
  const hint = settings?.readwise_token?.slice(-4);

  return (
    <main className="space-y-8">
      <Breadcrumbs items={[{ label: "Digests", href: "/" }, { label: "Settings" }]} />

      <section>
        <h1 className="mb-1 text-2xl">Account settings</h1>
        <p className="text-sm text-muted">
          Connections that belong to you rather than to one digest. Delivery time, voice and the web-search
          toggle live on each digest&apos;s own Settings tab.
        </p>
      </section>

      {searchParams.error && (
        <p className="rounded border border-rule bg-white p-3 text-sm">⚠ {searchParams.error}</p>
      )}
      {searchParams.ok && (
        <p className="rounded border border-rule bg-white p-3 text-sm">
          {searchParams.ok === "connected"
            ? "✓ Token verified against Readwise and saved."
            : searchParams.ok === "disconnected"
              ? "Readwise disconnected. Any readwise sections will now be skipped."
              : "✓ Saved."}
        </p>
      )}

      <section className="space-y-4 rounded border border-rule bg-white/50 p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg">Readwise</h2>
          <span className="font-mono text-xs text-muted">
            {connected
              ? settings?.readwise_enabled
                ? `connected · ••••${hint}`
                : `paused · ••••${hint}`
              : "not connected"}
          </span>
        </div>

        <p className="text-sm text-muted">
          Pulls quotes from your own highlight vault — the things you underlined on a Kindle or saved in
          Reader — into any digest, alongside the news. Quotes are printed verbatim with their source: no
          model reads them, so nothing can paraphrase or misquote what you kept.
        </p>

        <div className="rounded border border-rule bg-paper p-4 text-sm">
          <p className={LABEL}>How to connect</p>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5">
            <li>
              You need a <strong>paid Readwise plan</strong>. The API is a paid-plan feature — on a free or
              expired account the token page still shows a key, but every call comes back rejected.
            </li>
            <li>
              Open{" "}
              <a
                className="underline"
                href="https://readwise.io/access_token"
                target="_blank"
                rel="noreferrer"
              >
                readwise.io/access_token
              </a>{" "}
              and copy the token shown there.
            </li>
            <li>Paste it below and save. We check it against Readwise before storing it.</li>
            <li>
              Then add a <code>readwise</code> section to a digest and pick how it should draw — Readwise&apos;s
              own daily review, or a random resurface from your library.
            </li>
          </ol>
          <p className="mt-3 text-muted">
            The token is read-only in practice: this app never creates, edits or deletes highlights, and it
            never marks your daily review complete — your Readwise app stays exactly as you left it. Revoke it
            any time on the same page you copied it from.
          </p>
        </div>

        <form action={saveReadwise} className="space-y-4">
          <label className="block space-y-1">
            <span className={LABEL}>Access token</span>
            <input
              name="readwise_token"
              type="password"
              autoComplete="off"
              className={FIELD}
              placeholder={connected ? `stored — leave blank to keep ••••${hint}` : "paste your token"}
            />
          </label>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name="readwise_enabled"
              defaultChecked={settings?.readwise_enabled ?? false}
              className="mt-1"
            />
            <span>
              Use Readwise in my digests
              <span className="block text-xs text-muted">
                Off pauses every <code>readwise</code> section without deleting them or your token.
              </span>
            </span>
          </label>

          {settings?.readwise_verified_at && (
            <p className="font-mono text-xs text-muted">
              last verified {new Date(settings.readwise_verified_at).toLocaleString()}
            </p>
          )}

          <button type="submit" className="rounded bg-ink px-4 py-2 font-mono text-sm text-paper">
            Save
          </button>
        </form>

        {connected && (
          <form action={disconnectReadwise} className="border-t border-rule pt-3">
            <button type="submit" className="font-mono text-xs text-muted hover:text-ink">
              disconnect and forget token
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
