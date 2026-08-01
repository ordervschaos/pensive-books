// Delivery: Mailgun → the reader's Kindle address.
//
// Two things make this work at all, both inherited from the main app rather than rebuilt:
//   1. user_data.kindle_email — already collected and OTP-verified by send-kindle-verification.
//   2. The Mailgun sending domain — already on the reader's Amazon approved-sender list.
//
// THE SILENT-FAILURE TRAP: Send-to-Kindle drops mail from any address not on that approved list, with no
// bounce and no error. The approved address is `hello@$MAILGUN_DOMAIN` — that is what BOTH the OTP mail
// (send-kindle-verification) and the existing book send (BookInfo.tsx) put in From, so it is what readers
// added to Amazon. Do NOT copy `mailgun@$MAILGUN_DOMAIN` from notify-task-done: that address is for ordinary
// notification mail to a human inbox and has never been approved for any Kindle. Changing this line breaks
// every digest at once, and the only symptom is that nothing arrives.

export interface DeliveryResult {
  ok: boolean;
  error?: string;
}

export async function sendToKindle(opts: {
  to: string;
  title: string;
  html: string;
}): Promise<DeliveryResult> {
  const key = process.env.MAILGUN_API_KEY;
  const domain = process.env.MAILGUN_DOMAIN;
  if (!key || !domain) return { ok: false, error: "Mailgun is not configured" };

  const form = new FormData();
  form.append("from", `Pensive <hello@${domain}>`);
  form.append("to", opts.to);
  // Send-to-Kindle ignores the subject for document delivery, but a readable one helps in the sent log.
  form.append("subject", opts.title);
  form.append("text", "Your Pensive digest is attached.");
  form.append(
    "attachment",
    new Blob([opts.html], { type: "text/html" }),
    `${safeFilename(opts.title)}.html`,
  );

  const res = await fetch(`https://api.mailgun.net/v3/${domain}/messages`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`api:${key}`).toString("base64")}` },
    body: form,
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) return { ok: false, error: `Mailgun ${res.status}: ${await res.text()}` };
  return { ok: true };
}

// Kindle shows the filename as the document title in the library, so it's user-visible, not incidental.
function safeFilename(s: string): string {
  return s.replace(/[^\w\s.-]/g, "").replace(/\s+/g, "-").slice(0, 80) || "digest";
}
