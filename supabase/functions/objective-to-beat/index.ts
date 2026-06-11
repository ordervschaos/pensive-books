// objective-to-beat — the objective→beat transform (one downward edge of the resolution ladder).
//
// A BEAT is a single paragraph that plans, in concrete order, what one page does to fulfil its
// objective — the middle resolution between the OBJECTIVE (what the page must achieve) and the PROSE
// (the words). This is the SYNC workshop endpoint: it owns auth + access, and delegates the actual
// objective→beat work to _shared/beat-core.ts (the same core generate-book's beat phase calls, so a
// single page and a bulk build produce byte-identical beats).
//
//   client → POST { bookId, pageId, objective }
//     → verify edit access → objectiveToBeat() (brief + spine + outline + previous beat + threads) → { beat }
//
// Synchronous (a paragraph is quick). The client writes metadata.beat and stamps the objective_beat
// edge hash (planProvenance.stampEdge) — this function only returns the text.
// Needs ANTHROPIC_API_KEY (shared with the other AI steps).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { objectiveToBeat, beatCandidates } from "../_shared/beat-core.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

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

    const { bookId, pageId, objective, candidates } = (await req.json().catch(() => ({}))) as {
      bookId?: number; pageId?: number; objective?: string; candidates?: number;
    };
    if (!bookId || !pageId) return json({ error: "bookId and pageId are required" }, 400);
    const obj = (objective ?? "").trim();
    if (!obj) return json({ error: "An objective is required to write a beat" }, 400);

    const { data: book, error: bookError } = await userClient
      .from("books").select("id, owner_id").eq("id", bookId).single();
    if (bookError || !book) return json({ error: "Book not found" }, 404);

    const { data: access } = await userClient
      .from("book_access").select("id").eq("book_id", bookId).eq("user_id", user.id).eq("status", "accepted").maybeSingle();
    if (book.owner_id !== user.id && !access) return json({ error: "Access denied" }, 403);

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);

    // Use the user's client for context reads (RLS-scoped to a book they can edit) — same as before.
    // candidates>1 → return all the un-judged takes for the serial human-pick UI; else one beat.
    const n = Math.max(1, Math.min(Number(candidates) || 1, 5));
    if (n > 1) {
      const takes = await beatCandidates(userClient, apiKey, { bookId, pageId, objective: obj, userId: user.id }, n);
      return json({ candidates: takes });
    }
    const beat = await objectiveToBeat(userClient, apiKey, { bookId, pageId, objective: obj, userId: user.id });
    return json({ beat });
  } catch (e) {
    console.error("objective-to-beat error:", e);
    const msg = String((e as Error)?.message ?? e);
    const status = msg.includes("Book not found") ? 404 : msg.includes("objective is required") ? 400 : 500;
    return json({ error: msg.slice(0, 500) }, status);
  }
});
