import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { buildIssue } from "@/lib/digest/build";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// "Run it now" — the same pipeline the 6am tick runs, triggered by the owner. This is the loop you actually
// develop against: waiting for tomorrow morning to test a section change is not a workflow.
//
// It deliberately reuses claim_digest_issue rather than building unconditionally, so a manual run and the
// scheduled run for the same local date can never both fire. If today is already claimed, this rebuilds that
// issue (unless it was already sent) instead of minting a second one.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const digestId = Number(params.id);
  if (!Number.isFinite(digestId)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  // Ownership is checked with the USER's client (RLS), before anything touches the service role.
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: digest } = await supabase
    .from("digests")
    .select("id, timezone")
    .eq("id", digestId)
    .maybeSingle();
  if (!digest) return NextResponse.json({ error: "not found" }, { status: 404 });

  // ?force=1 — regenerate a day that was already delivered. Explicitly opt-in, because it re-sends: the
  // default no-op on an already-sent issue is what protects against double delivery.
  const force = new URL(request.url).searchParams.get("force") === "1";
  const issueDate = localDate(digest.timezone as string);
  const db = createServiceClient();

  const { data: claimed } = await db.rpc("claim_digest_issue", {
    p_digest_id: digestId,
    p_issue_date: issueDate,
  });

  let issueId = claimed as number | null;
  if (!issueId) {
    const { data: existing } = await db
      .from("digest_issues")
      .select("id, status")
      .eq("digest_id", digestId)
      .eq("issue_date", issueDate)
      .maybeSingle();
    if (!existing) return NextResponse.json({ error: "could not claim today's issue" }, { status: 409 });
    issueId = existing.id as number;
  }

  const result = await buildIssue(issueId, { force });
  return NextResponse.json({ issue_id: issueId, issue_date: issueDate, forced: force, ...result });
}

// Today's date in the digest's own timezone — the same wall-clock notion due_digests() uses, so a manual run
// and a scheduled run agree on which day "today" is.
function localDate(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
