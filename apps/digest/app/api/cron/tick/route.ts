import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { buildIssue } from "@/lib/digest/build";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// The scheduler tick. Called every ~15 minutes by pg_cron → pg_net (the same DB-drives-the-app pattern the
// publish/revalidate flow already uses), so scheduling lives next to the data rather than in a second
// control plane. Shared-secret auth: there is no user session at 6am.
//
// due_digests() does the timezone-local math; claim_digest_issue() does the locking. This route is just the
// loop between them.
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not set" }, { status: 500 });
  if (request.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = createServiceClient();
  const { data: due, error } = await db.rpc("due_digests");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (due ?? []) as Array<{ digest_id: number; issue_date: string }>;
  const results = await Promise.all(
    rows.map(async (row) => {
      // The claim IS the lock: two concurrent ticks race here and exactly one gets an id back.
      const { data: issueId } = await db.rpc("claim_digest_issue", {
        p_digest_id: row.digest_id,
        p_issue_date: row.issue_date,
      });
      if (!issueId) return { digest_id: row.digest_id, status: "already_claimed" };
      const out = await buildIssue(issueId as number);
      return { digest_id: row.digest_id, issue_id: issueId, ...out };
    }),
  );

  return NextResponse.json({ due: rows.length, results });
}
