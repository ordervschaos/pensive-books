import { createClient } from "@/lib/supabase/server";
import { urlHash } from "@/lib/digest/canonical";
import { InboxAddress } from "../InboxAddress";
import { forgetMessage } from "../../actions";

export const dynamic = "force-dynamic";

// The mailbox view — what has actually arrived at this digest's address.
//
// The Posts tab answers "is this feed earning its place?" for everything the pipeline PULLED. Inbound mail
// never passes through that path at gather time (the sender already delivered it), so without this page the
// only way to know whether a newsletter landed was to run a script. A push source you cannot see is a push
// source you cannot trust.
//
// "Used" is not a column here. It lives on digest_posts, keyed by the synthetic permalink the inbox adapter
// mints for each message — so the join is done in code, by recomputing that url's hash. Slightly awkward,
// and the right trade: it keeps ONE definition of delivered for every source kind rather than giving mail
// its own parallel notion of it.

interface MessageRow {
  id: number;
  sender: string | null;
  sender_name: string | null;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  list_id: string | null;
  received_at: string;
}

// Must match the inbox adapter's identity exactly. If these two ever drift, the used/unused badge silently
// lies — which is why it is written once here and once there, and nowhere else.
const permalink = (id: number) => `https://digest.pensive.me/inbox/${id}`;

export default async function InboxPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const digestId = Number(params.id);

  const [{ data: digestRow }, { data }] = await Promise.all([
    supabase.from("digests").select("inbox_token").eq("id", digestId).maybeSingle(),
    supabase
      .from("digest_inbox_messages")
      .select("id, sender, sender_name, subject, body_text, body_html, list_id, received_at")
      .eq("digest_id", digestId)
      .order("received_at", { ascending: false })
      .limit(100),
  ]);

  const messages = (data ?? []) as MessageRow[];

  // One round-trip for the delivery state of every message on the page.
  const hashes = messages.map((m) => urlHash(permalink(m.id)));
  const { data: usedRows } = hashes.length
    ? await supabase
        .from("digest_posts")
        .select("url_hash, used_at, used_in_issue_id")
        .eq("digest_id", digestId)
        .in("url_hash", hashes)
    : { data: [] };

  const used = new Map(
    ((usedRows ?? []) as Array<{ url_hash: string; used_at: string | null; used_in_issue_id: number | null }>)
      .filter((r) => r.used_at)
      .map((r) => [r.url_hash, r.used_in_issue_id]),
  );

  return (
    <div className="space-y-6">
      <InboxAddress token={(digestRow as { inbox_token?: string } | null)?.inbox_token ?? null} />

      <section>
        <h2 className="mb-2 font-mono text-xs uppercase tracking-wider text-muted">
          {messages.length} message{messages.length === 1 ? "" : "s"}
        </h2>

        {messages.length === 0 ? (
          <div className="space-y-2 text-sm text-muted">
            <p>Nothing has arrived yet.</p>
            {/* The two failure modes worth naming, because both look identical from here — an empty list. */}
            <p>
              Mail can be accepted by Mailgun and still never reach this page: the webhook rejects anything
              whose signature doesn&apos;t verify, and a rejection is permanent (Mailgun does not retry a
              4xx). If you sent something and it isn&apos;t here, the route&apos;s <strong>Logs</strong> tab
              in Mailgun will say whether it was <code>delivered</code> or <code>failed</code>.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-rule border-y border-rule">
            {messages.map((m) => {
              const hash = urlHash(permalink(m.id));
              const issueId = used.get(hash);
              const body = m.body_text ?? m.body_html ?? "";
              return (
                <li key={m.id} className="py-3">
                  <div className="flex items-baseline justify-between gap-4">
                    <a href={`/digests/${digestId}/inbox/${m.id}`} className="hover:underline">
                      {m.subject || "(no subject)"}
                    </a>
                    <span className="shrink-0 font-mono text-xs text-muted">
                      {used.has(hash) ? (
                        issueId ? (
                          <a href={`/issues/${issueId}`} className="hover:underline">
                            used
                          </a>
                        ) : (
                          "used"
                        )
                      ) : (
                        "unused"
                      )}
                    </span>
                  </div>
                  <p className="font-mono text-xs text-muted">
                    {[
                      m.sender_name || m.sender || "unknown sender",
                      new Date(m.received_at).toLocaleString(),
                      `${body.length} chars`,
                      // Below this floor the inbox adapter drops it as a subscription stub rather than a
                      // newsletter — worth showing, since it explains an otherwise invisible omission.
                      body.length <= 120 ? "too short — will be skipped" : null,
                      m.list_id ? "newsletter" : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {body.trim() && (
                    <p className="mt-1 line-clamp-2 text-sm text-muted">
                      {body.replace(/\s+/g, " ").slice(0, 240)}…
                    </p>
                  )}
                  <form action={forgetMessage} className="mt-1">
                    <input type="hidden" name="id" value={digestId} />
                    <input type="hidden" name="message_id" value={m.id} />
                    <button type="submit" className="font-mono text-xs text-muted hover:text-ink">
                      delete
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
