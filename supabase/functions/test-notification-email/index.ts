// test-notification-email — a diagnostic: send a notification email straight to
// the logged-in user via Mailgun, bypassing the trigger → pg_net → notify-task-done
// chain. If THIS works but real tasks don't, the problem is the chain (secret /
// trigger / pg_net). If THIS fails, it's Mailgun config/deliverability — and we
// return the actual Mailgun error + the from-domain so the cause is visible
// (the usual culprit: a Mailgun *sandbox* domain only delivers to authorized
// recipients).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user?.email) return json({ error: "Unauthorized" }, 401);

    const MAILGUN_API_KEY = Deno.env.get("MAILGUN_API_KEY");
    const MAILGUN_DOMAIN = Deno.env.get("MAILGUN_DOMAIN");
    if (!MAILGUN_API_KEY || !MAILGUN_DOMAIN) {
      return json({ error: "Missing Mailgun configuration", hasKey: !!MAILGUN_API_KEY, hasDomain: !!MAILGUN_DOMAIN }, 500);
    }
    const isSandbox = MAILGUN_DOMAIN.includes("sandbox");

    const form = new FormData();
    form.append("from", `Pensive <mailgun@${MAILGUN_DOMAIN}>`);
    form.append("to", user.email);
    form.append("subject", "Pensive — test notification");
    form.append(
      "html",
      `<p>This is a test of Pensive's email notifications.</p>
       <p>If you're reading this, email delivery works. Sent to <b>${user.email}</b> via <code>${MAILGUN_DOMAIN}</code>.</p>`,
    );

    const res = await fetch(`https://api.mailgun.net/v3/${MAILGUN_DOMAIN}/messages`, {
      method: "POST",
      headers: { Authorization: `Basic ${btoa(`api:${MAILGUN_API_KEY}`)}` },
      body: form,
    });
    const bodyText = await res.text();
    if (!res.ok) {
      return json(
        {
          error: "Mailgun rejected the send",
          status: res.status,
          mailgun: bodyText.slice(0, 500),
          domain: MAILGUN_DOMAIN,
          isSandbox,
          to: user.email,
        },
        502,
      );
    }
    return json({ sent: true, to: user.email, domain: MAILGUN_DOMAIN, isSandbox });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
