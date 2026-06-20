// mandate-gate — the conformance BACKSTOP ("gate (a)").
//
// Scores a finished book against the SAME brief MANDATE the generator was handed and returns a
// per-axis conformance report (length deterministic; heat/genre/success LLM-judged). It REPORTS,
// it does not block — a confirm-don't-enforce backstop on top of the C1–C4 mechanism fix.
//
//   client → POST { bookId }  →  { report: ConformanceReport }
//
// Synchronous: one judge call (~15-30s), well under the worker wall-clock. Needs ANTHROPIC_API_KEY.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { runMandateGate } from "../_shared/mandate-gate.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } },
    );

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: "Unauthorized" }, 401);

    const { bookId } = await req.json().catch(() => ({}));
    if (!bookId) return json({ error: "bookId is required" }, 400);

    // Access check (owner or accepted collaborator) — same predicate as the other book AI surfaces.
    const { data: book, error: bookError } = await userClient
      .from("books").select("id, owner_id").eq("id", bookId).single();
    if (bookError || !book) return json({ error: "Book not found" }, 404);
    const { data: access } = await userClient
      .from("book_access").select("id")
      .eq("book_id", bookId).eq("user_id", user.id).eq("status", "accepted").maybeSingle();
    if (book.owner_id !== user.id && !access) return json({ error: "Access denied" }, 403);

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);

    // Service-role client for the manuscript read (bypasses RLS, reliable).
    const service = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const report = await runMandateGate(service, apiKey, bookId, { userId: user.id });
    return json({ report });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
