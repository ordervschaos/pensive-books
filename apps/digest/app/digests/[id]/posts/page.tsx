import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// The corpus view. Its job is to answer "is this feed earning its place?" — which needs the posts that were
// pulled and NOT used just as much as the ones that shipped. A list of only-what-shipped would hide exactly
// the evidence you're looking for.
interface PostRow {
  id: number;
  url: string | null;
  title: string | null;
  source: string | null;
  section_id: string | null;
  published_at: string | null;
  fetched_at: string;
  used_at: string | null;
  used_in_issue_id: number | null;
  body: string | null;
}

export default async function PostsPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { source?: string };
}) {
  const supabase = createClient();
  const digestId = Number(params.id);

  let query = supabase
    .from("digest_posts")
    .select("id, url, title, source, section_id, published_at, fetched_at, used_at, used_in_issue_id, body")
    .eq("digest_id", digestId)
    .order("fetched_at", { ascending: false })
    .limit(200);
  if (searchParams.source) query = query.eq("source", searchParams.source);

  const { data } = await query;
  const posts = (data ?? []) as PostRow[];

  // Per-source hit rate: pulled vs actually used. This is the number that tells you to drop a feed.
  const bySource = new Map<string, { pulled: number; used: number }>();
  for (const p of posts) {
    const key = p.source ?? "—";
    const row = bySource.get(key) ?? { pulled: 0, used: 0 };
    row.pulled += 1;
    if (p.used_at) row.used += 1;
    bySource.set(key, row);
  }
  const sources = [...bySource.entries()].sort((a, b) => b[1].pulled - a[1].pulled);

  return (
    <div className="space-y-8">
      <p className="text-sm text-muted">
        Everything this digest has pulled — including what it decided not to use.
      </p>

      {sources.length > 0 && (
        <section>
          <h2 className="mb-2 font-mono text-xs uppercase tracking-wider text-muted">By source</h2>
          <ul className="divide-y divide-rule border-y border-rule">
            {sources.map(([source, { pulled, used }]) => (
              <li key={source} className="flex items-baseline justify-between py-2 text-sm">
                <a href={`?source=${encodeURIComponent(source)}`} className="hover:underline">
                  {source}
                </a>
                <span className="font-mono text-xs text-muted">
                  {used}/{pulled} used
                </span>
              </li>
            ))}
          </ul>
          {searchParams.source && (
            <p className="mt-2 font-mono text-xs">
              <a href="?" className="underline">
                clear filter
              </a>
            </p>
          )}
        </section>
      )}

      <section>
        <h2 className="mb-2 font-mono text-xs uppercase tracking-wider text-muted">
          {posts.length} post{posts.length === 1 ? "" : "s"}
        </h2>
        {posts.length === 0 ? (
          <p className="text-sm text-muted">Nothing pulled yet — run or preview the digest.</p>
        ) : (
          <ul className="divide-y divide-rule border-y border-rule">
            {posts.map((p) => (
              <li key={p.id} className="py-3">
                <div className="flex items-baseline justify-between gap-4">
                  {/* The title opens the copy we already extracted — the original is a secondary link, since
                      re-fetching a page we've already paid to read is the thing worth avoiding. */}
                  <a href={`/digests/${digestId}/posts/${p.id}`} className="hover:underline">
                    {p.title ?? p.url ?? "(untitled)"}
                  </a>
                  <span className="shrink-0 font-mono text-xs text-muted">
                    {p.used_at ? (
                      <a href={`/issues/${p.used_in_issue_id}`} className="hover:underline">
                        used
                      </a>
                    ) : (
                      "unused"
                    )}
                  </span>
                </div>
                <p className="font-mono text-xs text-muted">
                  {[
                    p.source,
                    p.section_id,
                    // Age, not just a date: a "daily" digest quietly serving a 6-year-old archive post is
                    // exactly the failure this view exists to make visible.
                    ageLabel(p.published_at),
                    p.body ? "readable" : "no body",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  {p.url && (
                    <>
                      {" · "}
                      <a href={p.url} target="_blank" rel="noreferrer" className="underline">
                        original ↗
                      </a>
                    </>
                  )}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// Age is shown as neutral context, not as a warning: an old piece that is good is good. It stays only
// because "when was this written" is genuinely useful when inspecting why a section chose something.
function ageDays(published: string | null): number {
  if (!published) return 0;
  const d = new Date(published);
  return Number.isNaN(d.getTime()) ? 0 : (Date.now() - d.getTime()) / 86_400_000;
}

function ageLabel(published: string | null): string | null {
  if (!published) return null;
  const days = Math.floor(ageDays(published));
  if (days < 1) return "today";
  if (days < 30) return `${days}d old`;
  if (days < 365) return `${Math.floor(days / 30)}mo old`;
  const years = (days / 365).toFixed(1).replace(/\.0$/, "");
  return `${years}y old`;
}
