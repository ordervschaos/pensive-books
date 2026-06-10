// evaluate-book — "The editor's read".
//
// Runs a developmental fiction edit against the embedded rubric using Claude, and
// stores the result in book_evaluations. Long job (~30-90s), so it returns a
// `pending` row immediately and finishes in the background (EdgeRuntime.waitUntil):
//
//   client → POST { bookId }
//     → verify caller can edit the book
//     → INSERT book_evaluations row (status:'pending')   ← returned in ~1s
//     → background: fetch manuscript → Claude → UPDATE row (status:'done'|'error')
//     → client learns via Realtime on book_evaluations
//
// Needs the ANTHROPIC_API_KEY secret:  supabase secrets set ANTHROPIC_API_KEY=...
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { getActiveModels } from "../_shared/model-config.ts";
import { runEvaluation, NONFICTION_BANDS, type Brief } from "../_shared/evaluate-core.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

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

    const { bookId } = await req.json().catch(() => ({}));
    if (!bookId) return json({ error: "bookId is required" }, 400);

    // Book + access check (owner or accepted collaborator).
    const { data: book, error: bookError } = await userClient
      .from("books")
      .select("id, name, subtitle, author, brief, owner_id")
      .eq("id", bookId)
      .single();
    if (bookError || !book) return json({ error: "Book not found" }, 404);

    const { data: access } = await userClient
      .from("book_access")
      .select("id")
      .eq("book_id", bookId)
      .eq("user_id", user.id)
      .eq("status", "accepted")
      .maybeSingle();
    if (book.owner_id !== user.id && !access) return json({ error: "Access denied" }, 403);

    // Fiction only for now — refuse non-fiction by the brief's scope band.
    const band = (book.brief as Brief | null)?.scope?.band;
    if (band && NONFICTION_BANDS.has(band)) {
      return json({ error: "The non-fiction rubric isn't available yet." }, 400);
    }

    // Service-role client for writes + manuscript read (bypasses RLS; reliable in background).
    const service = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);

    const { high: evalModel } = await getActiveModels();

    const { data: evalRow, error: insertError } = await service
      .from("book_evaluations")
      .insert({
        book_id: book.id,
        created_by: user.id,
        kind: "fiction",
        model: evalModel,
        status: "pending",
        brief_snapshot: book.brief ?? null,
      })
      .select()
      .single();
    if (insertError || !evalRow) return json({ error: "Could not start evaluation" }, 500);

    // Hand the slow work to the background; respond now with the pending row.
    const work = runEvaluation(service, apiKey, evalRow.id, book, evalModel);
    if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(work);

    return json({ status: "pending", evaluation: evalRow }, 202);
  } catch (e) {
    console.error("evaluate-book error:", e);
    return json({ error: "Internal server error" }, 500);
  }
});
