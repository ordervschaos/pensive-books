import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { previewIssue } from "@/lib/digest/build";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Compile today's issue and return it as a web page — no mail, no `digest_issues` row, no seen-items
// written. Open it in a browser tab and you are looking at exactly the HTML the Kindle would get, because
// it goes through the same compile and the same renderer as the 6am job.
//
// GET on purpose, despite doing real work: you want to be able to paste this in the URL bar and hit reload
// after editing a prompt. It costs real tokens per load — that is the trade, and it is worth it against the
// alternative of mailing yourself a Kindle document to find out you had a typo.
//
// `?ignoreSeen=1` compiles as if nothing had ever been delivered, for when the dedupe memory would
// correctly return an empty issue and you need to see output anyway.
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const digestId = Number(params.id);
  if (!Number.isFinite(digestId)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  // Owner check against RLS first — the preview then runs with the service role, so this is the gate.
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: digest } = await supabase.from("digests").select("id").eq("id", digestId).maybeSingle();
  if (!digest) return NextResponse.json({ error: "not found" }, { status: 404 });

  const ignoreSeen = new URL(request.url).searchParams.get("ignoreSeen") === "1";
  const result = await previewIssue(digestId, { ignoreSeen });

  if ("error" in result) {
    // Render the empty case as a page too — "nothing today" is a real outcome worth seeing, not an error.
    return new NextResponse(
      `<!DOCTYPE html><html><body style="font-family:Georgia,serif;max-width:40em;margin:4em auto">
       <h1>Nothing to send</h1><p>${result.error}</p>
       <p><a href="?ignoreSeen=1">Retry ignoring the seen-items memory →</a></p></body></html>`,
      { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }

  return new NextResponse(result.html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      // Surfaced as headers so a curl-based check can assert on them without parsing the page.
      "x-digest-sections": String(result.sections),
      "x-digest-items": String(result.items),
    },
  });
}
