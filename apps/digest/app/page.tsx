import { createClient } from "@/lib/supabase/server";
import { appOrigin } from "@/lib/pensive";
import type { Digest } from "@/lib/digest/types";

export const dynamic = "force-dynamic";

interface IssueRow {
  id: number;
  digest_id: number;
  issue_date: string;
  status: string;
  item_count: number;
  delivered_at: string | null;
}

export default async function HomePage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // The middleware only checks that a session cookie EXISTS; this is where it is actually validated.
  // A stale/expired cookie lands here, and the SPA (which owns refresh) is the right place to send it.
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

  const { data: digests } = await supabase
    .from("digests")
    .select("id, name, timezone, deliver_at, active, sections")
    .order("created_at", { ascending: true });

  const { data: issues } = await supabase
    .from("digest_issues")
    .select("id, digest_id, issue_date, status, item_count, delivered_at")
    .order("issue_date", { ascending: false })
    .limit(14);

  const list = (digests ?? []) as Pick<Digest, "id" | "name" | "timezone" | "deliver_at" | "active" | "sections">[];

  return (
    <main className="space-y-10">
      <section>
        <h1 className="mb-1 text-2xl">Your digests</h1>
        <p className="text-sm text-muted">
          Compiled each morning from sources you choose, delivered to your Kindle.
        </p>
      </section>

      {list.length === 0 ? (
        <section className="rounded border border-rule bg-white/50 p-6">
          <p className="mb-3">You don&apos;t have a digest yet.</p>
          <a href="/digests/new" className="font-mono text-sm underline">
            Create one →
          </a>
        </section>
      ) : (
        <ul className="space-y-3">
          {list.map((d) => (
            <li key={d.id} className="rounded border border-rule bg-white/50 p-4">
              <a href={`/digests/${d.id}`} className="flex items-baseline justify-between">
                <span className="text-lg">{d.name}</span>
                <span className="font-mono text-xs text-muted">
                  {d.deliver_at.slice(0, 5)} {d.timezone}
                  {d.active ? "" : " · paused"}
                </span>
              </a>
              <p className="mt-1 font-mono text-xs text-muted">
                {(d.sections ?? []).length} section{(d.sections ?? []).length === 1 ? "" : "s"}
              </p>
            </li>
          ))}
        </ul>
      )}

      {(issues ?? []).length > 0 && (
        <section>
          <h2 className="mb-3 font-mono text-xs uppercase tracking-wider text-muted">Recent issues</h2>
          <ul className="divide-y divide-rule border-y border-rule">
            {((issues ?? []) as IssueRow[]).map((i) => (
              <li key={i.id} className="flex items-baseline justify-between py-2">
                <a href={`/issues/${i.id}`} className="hover:underline">
                  {i.issue_date}
                </a>
                <span className="font-mono text-xs text-muted">
                  {i.status}
                  {i.item_count ? ` · ${i.item_count} items` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
