import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { IssueContentView } from "@/components/IssueContentView";
import type { IssueContent } from "@/lib/digest/types";

export const dynamic = "force-dynamic";

interface VersionRow {
  id: number;
  archived_at: string;
  item_count: number;
}

// Read an issue in the app, not just on the Kindle. The structured `content` (not the delivered HTML) is what
// renders here — same reason it's stored structured: a 👍/👎 on a block can later map back to the source item
// that produced it.
export default async function IssuePage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const issueId = Number(params.id);
  const [{ data }, { data: versionData }] = await Promise.all([
    supabase
      .from("digest_issues")
      .select("id, digest_id, issue_date, status, content, error, delivered_at")
      .eq("id", issueId)
      .maybeSingle(),
    supabase
      .from("digest_issue_versions")
      .select("id, archived_at, item_count")
      .eq("issue_id", issueId)
      .order("archived_at", { ascending: false }),
  ]);
  if (!data) notFound();

  // This route sits outside the digest layout (an issue is a published artifact, not a config tab), so it
  // rebuilds the trail back up to its parent digest itself.
  const { data: digest } = await supabase
    .from("digests")
    .select("id, name")
    .eq("id", data.digest_id as number)
    .maybeSingle();

  const content = (data.content ?? { sections: [] }) as IssueContent;
  const versions = (versionData ?? []) as VersionRow[];

  return (
    <main className="space-y-8">
      <Breadcrumbs
        items={[
          { label: "Digests", href: "/" },
          ...(digest
            ? [
                { label: digest.name as string, href: `/digests/${digest.id}` },
                { label: "Issues", href: `/digests/${digest.id}/issues` },
              ]
            : []),
          { label: data.issue_date as string },
        ]}
      />
      <header className="border-b border-rule pb-4">
        <h1 className="text-2xl">{data.issue_date as string}</h1>
        <p className="font-mono text-xs text-muted">
          {data.status as string}
          {data.delivered_at ? ` · delivered ${new Date(data.delivered_at as string).toLocaleString()}` : ""}
          {versions.length ? ` · regenerated, ${versions.length} archived version${versions.length > 1 ? "s" : ""} below` : ""}
        </p>
        {data.error && <p className="mt-2 text-sm text-muted">{data.error as string}</p>}
      </header>

      {/* The web reader loads images remotely; only the Kindle attachment inlines them as data URIs. */}
      <IssueContentView content={content} />

      {versions.length > 0 && (
        <section className="space-y-2 border-t border-rule pt-4">
          <h2 className="font-mono text-xs uppercase tracking-wider text-muted">Archived versions</h2>
          <p className="text-sm text-muted">
            Superseded by a regenerate. Kept, not deleted — this is what was actually sent before.
          </p>
          <ul className="divide-y divide-rule border-y border-rule">
            {versions.map((v) => (
              <li key={v.id} className="flex items-baseline justify-between py-2">
                <a href={`/issues/${issueId}/versions/${v.id}`} className="hover:underline">
                  archived {new Date(v.archived_at).toLocaleString()}
                </a>
                <span className="font-mono text-xs text-muted">{v.item_count} items</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
