import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { stripHtml } from "@/lib/digest/fetch";
import { urlHash } from "@/lib/digest/canonical";

export const dynamic = "force-dynamic";

// Read a single inbox message in full.
//
// The list page truncates to 240 chars so 100 messages fit on one screen — this is where you actually
// read one. Rendered as the same plain text the inbox adapter hands the pipeline (body_text, falling back
// to a stripped body_html), not the raw HTML: mail comes from arbitrary senders, so treating it as trusted
// markup here would be a stored-XSS hole. Matches PostPage's rule of "what you read here is what the
// writer was handed."

const permalink = (id: number) => `https://digest.pensive.me/inbox/${id}`;

export default async function InboxMessagePage({ params }: { params: { id: string; messageId: string } }) {
  const supabase = createClient();
  const digestId = Number(params.id);
  const messageId = Number(params.messageId);

  const { data } = await supabase
    .from("digest_inbox_messages")
    .select("id, sender, sender_name, subject, body_text, body_html, list_id, received_at")
    .eq("id", messageId)
    .eq("digest_id", digestId)
    .maybeSingle();
  if (!data) notFound();

  const text = (data.body_text as string | null) || stripHtml((data.body_html as string | null) ?? "");

  const hash = urlHash(permalink(messageId));
  const { data: usedRow } = await supabase
    .from("digest_posts")
    .select("used_at, used_in_issue_id")
    .eq("digest_id", digestId)
    .eq("url_hash", hash)
    .maybeSingle();
  const issueId = usedRow?.used_at ? (usedRow.used_in_issue_id as number | null) : null;

  const meta = [
    (data.sender_name as string | null) || (data.sender as string | null) || "unknown sender",
    new Date(data.received_at as string).toLocaleString(),
    data.list_id ? "newsletter" : null,
  ].filter(Boolean);

  return (
    <article className="space-y-6">
      <header className="space-y-2 border-b border-rule pb-4">
        <h1 className="text-2xl">{(data.subject as string | null) || "(no subject)"}</h1>
        <p className="font-mono text-xs text-muted">{meta.join(" · ")}</p>
        <p className="flex gap-4 font-mono text-xs">
          <a href={`/digests/${params.id}/inbox`} className="underline">
            ← inbox
          </a>
          {usedRow?.used_at ? (
            issueId ? (
              <a href={`/issues/${issueId}`} className="underline">
                used in an issue →
              </a>
            ) : (
              <span className="text-muted">used in an issue</span>
            )
          ) : (
            <span className="text-muted">unused</span>
          )}
        </p>
      </header>

      {text.trim() ? (
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{text}</p>
      ) : (
        <p className="text-sm text-muted">No body was stored for this message.</p>
      )}
    </article>
  );
}
