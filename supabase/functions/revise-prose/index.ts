// revise-prose — rework a page's EXISTING prose to address editorial notes, preserving its strengths
// and the author's voice. Signal-driven (the notes), page-level, never creates from scratch (that's
// beat-to-prose). A distinct transform so its context (current prose + notes + preserve-intent) can
// evolve independently of the create path.
//
//   client → POST { bookId, pageId, objective?, issues[] } → verify edit access → { text }
//
// Logic lives in _shared/generate-unit-core.ts (revisePage), reused by build-revision. Needs
// the ANTHROPIC_API_KEY secret.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { hasEditAccess } from "../_shared/access.ts";
import { revisePage, type ReviseIssue } from "../_shared/generate-unit-core.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

interface ReviseRequest {
  bookId: number;
  pageId: number;
  objective?: string;
  issues: ReviseIssue[];
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: "Unauthorized" }, 401);

    const body = (await req.json().catch(() => ({}))) as Partial<ReviseRequest>;
    const { bookId, pageId } = body;
    if (!bookId || !pageId) return json({ error: "bookId and pageId are required" }, 400);
    if (!Array.isArray(body.issues) || body.issues.length === 0) return json({ error: "issues are required" }, 400);

    const { data: book, error: bookError } = await userClient
      .from("books").select("id, owner_id").eq("id", bookId).single();
    if (bookError || !book) return json({ error: "Book not found" }, 404);

    if (!(await hasEditAccess(userClient, bookId, user.id, book.owner_id)))
      return json({ error: "Access denied" }, 403);

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);

    const text = await revisePage(userClient, apiKey, {
      bookId,
      pageId,
      objective: body.objective,
      issues: body.issues,
      userId: user.id,
    });

    return json({ text });
  } catch (e) {
    console.error("revise-prose error:", e);
    return json({ error: String((e as Error)?.message ?? e).slice(0, 500) }, 500);
  }
});
