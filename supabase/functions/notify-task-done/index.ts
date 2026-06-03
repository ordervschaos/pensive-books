// notify-task-done — emails the author when a long AI task finishes.
//
// Called fire-and-forget by the notify_task_done() DB trigger (pg_net) the
// moment an opted-in task reaches a terminal state. The trigger sends only
// { table, id } plus a shared secret; this function reads the row under the
// service role, looks up the author's email, composes the right message, and
// sends it via Mailgun. It deliberately knows nothing about *how* the task ran
// (server background vs. client-driven) — it reacts purely to the DB write.
//
// AUTH: not a user-facing endpoint. verify_jwt is disabled (see config.toml);
// instead we require the x-notify-secret header to match NOTIFY_SECRET. Fails
// closed — a missing/mismatched secret returns 401 and sends nothing.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

// table → how to read it + how to phrase the email.
const TASKS: Record<
  string,
  {
    // Subject/body for a successful finish and (where applicable) a failure.
    label: string;
    done: (book: string) => { subject: string; line: string };
    failed?: (book: string) => { subject: string; line: string };
  }
> = {
  book_evaluations: {
    label: "the editor's read",
    done: (b) => ({
      subject: `The editor's read of "${b}" is ready`,
      line: `The developmental editor has finished reading "${b}". Your verdict, priorities, and section notes are waiting.`,
    }),
    failed: (b) => ({
      subject: `The editor's read of "${b}" didn't finish`,
      line: `The editor's read of "${b}" ran into a problem and didn't finish. You can try running it again.`,
    }),
  },
  book_revisions: {
    label: "the AI revision",
    done: (b) => ({
      subject: `Your AI revision of "${b}" is done`,
      line: `The AI revision of "${b}" has finished building. Review the changes under "View drafts".`,
    }),
    failed: (b) => ({
      subject: `Your AI revision of "${b}" didn't finish`,
      line: `The AI revision of "${b}" ran into a problem and stopped. Reopen the book to resume or cancel it.`,
    }),
  },
  book_thread_scans: {
    label: "the thread scan",
    done: (b) => ({
      subject: `Your thread scan of "${b}" is ready`,
      line: `The thread scan of "${b}" has finished. Review the promises, payoffs, and open loops it surfaced.`,
    }),
  },
};

Deno.serve(async (req: Request) => {
  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const expected = Deno.env.get("NOTIFY_SECRET");
    const got = req.headers.get("x-notify-secret");
    if (!expected || got !== expected) return json({ error: "Unauthorized" }, 401);

    const { table, id } = (await req.json()) as { table?: string; id?: number };
    const spec = table ? TASKS[table] : undefined;
    if (!spec || typeof id !== "number") return json({ error: "Bad request" }, 400);

    const service = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // Read the task row: who to mail, which book, did it succeed.
    const { data: row, error: rowError } = await service
      .from(table!)
      .select("book_id, created_by, status")
      .eq("id", id)
      .single();
    if (rowError || !row) return json({ error: "Task not found" }, 404);

    // book_thread_scans has no error state — treat anything non-done as success.
    const failed = row.status === "error";
    // A table that can't fail (no `failed` builder) but somehow reports error: skip.
    if (failed && !spec.failed) return json({ skipped: "no message for state" });

    const { data: book } = await service
      .from("books")
      .select("name")
      .eq("id", row.book_id)
      .single();
    const bookName = book?.name || "your book";

    const { data: userRes } = await service.auth.admin.getUserById(row.created_by);
    const email = userRes?.user?.email;
    if (!email) return json({ skipped: "no recipient" });

    const msg = failed ? spec.failed!(bookName) : spec.done(bookName);

    const MAILGUN_API_KEY = Deno.env.get("MAILGUN_API_KEY");
    const MAILGUN_DOMAIN = Deno.env.get("MAILGUN_DOMAIN");
    if (!MAILGUN_API_KEY || !MAILGUN_DOMAIN) {
      return json({ error: "Missing Mailgun configuration" }, 500);
    }

    const siteUrl = Deno.env.get("PUBLIC_SITE_URL") ?? "https://app.pensive.me";
    const bookUrl = `${siteUrl}/books/${row.book_id}`;

    const formData = new FormData();
    formData.append("from", `Pensive <mailgun@${MAILGUN_DOMAIN}>`);
    formData.append("to", email);
    formData.append("subject", msg.subject);
    formData.append(
      "html",
      `
      <p>${msg.line}</p>
      <p><a href="${bookUrl}">Open "${bookName}" →</a></p>
      <p style="color:#888;font-size:12px">You're getting this because you asked to be notified when ${spec.label} finished.</p>
    `,
    );

    const res = await fetch(`https://api.mailgun.net/v3/${MAILGUN_DOMAIN}/messages`, {
      method: "POST",
      headers: { Authorization: `Basic ${btoa(`api:${MAILGUN_API_KEY}`)}` },
      body: formData,
    });
    if (!res.ok) {
      const err = await res.text();
      console.error("notify-task-done mailgun error:", err);
      return json({ error: "Failed to send email" }, 502);
    }

    return json({ sent: true });
  } catch (e) {
    console.error("notify-task-done error:", e);
    return json({ error: "Internal server error" }, 500);
  }
});
