import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { IssueContentView } from "@/components/IssueContentView";
import type { IssueContent } from "@/lib/digest/types";

export const dynamic = "force-dynamic";

// A read-only snapshot of what an issue looked like BEFORE a regenerate overwrote it — see
// digest_issue_versions. Same renderer as the live issue page, so "what did we actually send that
// morning" is answerable exactly, not approximately.
export default async function IssueVersionPage({ params }: { params: { id: string; versionId: string } }) {
  const supabase = createClient();
  const issueId = Number(params.id);

  const { data } = await supabase
    .from("digest_issue_versions")
    .select("id, issue_id, issue_date, digest_id, content, item_count, delivered_at, archived_at")
    .eq("id", Number(params.versionId))
    .eq("issue_id", issueId)
    .maybeSingle();
  if (!data) notFound();

  const { data: digest } = await supabase
    .from("digests")
    .select("id, name")
    .eq("id", data.digest_id as number)
    .maybeSingle();

  const content = (data.content ?? { sections: [] }) as IssueContent;

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
          { label: data.issue_date as string, href: `/issues/${issueId}` },
          { label: "archived" },
        ]}
      />
      <header className="border-b border-rule pb-4">
        <h1 className="text-2xl">{data.issue_date as string}</h1>
        <p className="font-mono text-xs text-muted">
          archived version · superseded by a later regenerate
          {data.delivered_at ? ` · originally delivered ${new Date(data.delivered_at as string).toLocaleString()}` : ""}
        </p>
        <p className="mt-2 text-sm text-muted">
          This is what was sent before someone regenerated this day.{" "}
          <a href={`/issues/${issueId}`} className="underline hover:text-ink">
            View the current version →
          </a>
        </p>
      </header>

      <IssueContentView content={content} />
    </main>
  );
}
