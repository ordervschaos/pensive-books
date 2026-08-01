import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { createServiceClient } from "@/lib/supabase/server";

// Mailgun inbound webhook — the pipeline's only PUSH entry point.
//
// Mailgun holds a catch-all route for the inbound domain and POSTs each parsed message here. We verify the
// signature, resolve `read+<token>@…` to a digest, and store the message. The 6am build reads it later:
// nothing about this request touches the digest pipeline, which is what keeps a burst of mail from being
// able to trigger work.
//
// STATUS CODE CONTRACT (Mailgun-specific, and load-bearing): 2xx = accepted and never retried; 4xx = dropped
// permanently; 5xx = retried for 8 hours. So an unknown recipient must return 200 (there is nothing to fix
// by retrying a nonexistent address) while a database failure must return 5xx (the mail is real and the
// retry will probably work). Returning 200 on a DB error would silently lose a newsletter forever.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Mailgun signs (timestamp + token) with the account's HTTP webhook signing key. Without this check, the
// endpoint is an open door into someone's morning reading — anyone who learns an address could inject text
// that the writer stage would then treat as sourced material.
function verify(timestamp: string, token: string, signature: string): boolean {
  const key = process.env.MAILGUN_SIGNING_KEY;
  if (!key) return false; // fail closed: no key configured means no inbound mail, not "trust everything"
  const expected = createHmac("sha256", key).update(timestamp + token).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature ?? "", "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

// Replay window. Mailgun's own guidance: reject signatures older than a few minutes so a captured POST
// can't be replayed later. The per-message unique constraint is the second line of defence.
const MAX_SIGNATURE_AGE_S = 15 * 60;

function field(form: FormData, ...names: string[]): string {
  for (const n of names) {
    const v = form.get(n);
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

/** `read+<token>@domain` → token. Also accepts `<token>@domain` for a route that maps the whole localpart. */
function tokenFromRecipient(recipient: string): string | null {
  const local = recipient.split("@")[0]?.toLowerCase() ?? "";
  const plus = local.includes("+") ? local.split("+").pop()! : local;
  return /^[a-f0-9]{8,}$/.test(plus) ? plus : null;
}

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "expected multipart form data" }, { status: 400 });
  }

  const timestamp = field(form, "timestamp");
  const token = field(form, "token");
  const signature = field(form, "signature");
  if (!verify(timestamp, token, signature)) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > MAX_SIGNATURE_AGE_S) {
    return NextResponse.json({ error: "stale signature" }, { status: 401 });
  }

  const recipient = field(form, "recipient", "To");
  const inboxToken = tokenFromRecipient(recipient);
  if (!inboxToken) {
    // 200, not 4xx: an address that doesn't parse is not going to parse on the retry either, and Mailgun
    // treats 4xx as "drop" anyway. Log it and move on.
    console.warn(`inbound: unroutable recipient ${recipient}`);
    return NextResponse.json({ ok: true, ignored: "unroutable recipient" });
  }

  const db = createServiceClient();
  const { data: digest } = await db
    .from("digests")
    .select("id")
    .eq("inbox_token", inboxToken)
    .maybeSingle();
  if (!digest) {
    console.warn(`inbound: no digest for token ${inboxToken}`);
    return NextResponse.json({ ok: true, ignored: "unknown digest" });
  }

  // stripped-text is Mailgun's body with quoted replies and signatures removed — the right default for a
  // forwarded newsletter, where the forward's own quoting is noise. body-plain is the fallback.
  const bodyText = field(form, "stripped-text", "body-plain");
  const bodyHtml = field(form, "stripped-html", "body-html");
  if (!bodyText && !bodyHtml) {
    return NextResponse.json({ ok: true, ignored: "empty body" });
  }

  const { error } = await db.from("digest_inbox_messages").upsert(
    {
      digest_id: digest.id,
      sender: field(form, "sender", "from"),
      sender_name: field(form, "From").replace(/\s*<[^>]+>\s*$/, "") || null,
      subject: field(form, "subject", "Subject") || "(no subject)",
      body_text: bodyText || null,
      body_html: bodyHtml || null,
      list_id: field(form, "List-Id") || null,
      // A message with no Message-Id gets a synthetic one: the unique constraint spans (digest, message_id),
      // and a null there would let every unidentified message insert forever.
      message_id: field(form, "Message-Id", "message-id") || `synthetic-${timestamp}-${token.slice(0, 12)}`,
    },
    { onConflict: "digest_id,message_id", ignoreDuplicates: true },
  );

  if (error) {
    // 5xx on purpose — see the status-code contract above. Mailgun will retry, and the unique constraint
    // makes that retry safe.
    console.error("inbound: insert failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 503 });
  }

  return NextResponse.json({ ok: true, digest_id: digest.id });
}
