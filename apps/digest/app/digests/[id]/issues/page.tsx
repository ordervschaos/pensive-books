import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface IssueRow {
  id: number;
  issue_date: string;
  status: string;
  item_count: number;
  error: string | null;
}

export default async function IssuesPage({ params }: { params: { id: string } }) {
  const digestId = Number(params.id);
  const supabase = createClient();
  const [{ data }, { data: versionRows }] = await Promise.all([
    supabase
      .from("digest_issues")
      .select("id, issue_date, status, item_count, error")
      .eq("digest_id", digestId)
      .order("issue_date", { ascending: false })
      .limit(30),
    // Archived-version counts per issue, for a "regenerated" badge — see digest_issue_versions.
    supabase.from("digest_issue_versions").select("issue_id").eq("digest_id", digestId),
  ]);

  const issues = (data ?? []) as IssueRow[];
  const versionCounts = new Map<number, number>();
  for (const v of (versionRows ?? []) as { issue_id: number }[]) {
    versionCounts.set(v.issue_id, (versionCounts.get(v.issue_id) ?? 0) + 1);
  }

  if (issues.length === 0) return <p className="text-sm text-muted">No issues yet.</p>;

  return (
    <ul className="divide-y divide-rule border-y border-rule">
      {issues.map((i) => (
        <li key={i.id} className="flex items-baseline justify-between py-2">
          <a href={`/issues/${i.id}`} className="hover:underline">
            {i.issue_date}
          </a>
          <span className="font-mono text-xs text-muted">
            {i.status}
            {i.item_count ? ` · ${i.item_count} items` : ""}
            {i.error ? ` · ${i.error}` : ""}
            {versionCounts.has(i.id) ? ` · regenerated (${versionCounts.get(i.id)} archived)` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}
