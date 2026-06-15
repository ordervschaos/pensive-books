// revise-node — synchronous revise for any named node (spine / objective / beat / foundation element / prose).
//
// Given the node's current text and an author instruction, rewrites it to honour the instruction while
// preserving what already works. Context assembled per layer (brief, spine, foundations, page metadata).
//
//   client → POST { bookId, pageId?, layer, current, instruction } → verify edit access → { text }
//
// Synchronous. The client shows a diff and, on accept, writes the node back. Needs ANTHROPIC_API_KEY.
// The durable path (ai-run kind "node_revise") shares revise-core for identical logic.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { hasEditAccess } from "../_shared/access.ts";
import { reviseNode, type ReviseLayer } from "../_shared/revise-core.ts";

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

    const { bookId, pageId, layer, current, instruction } = (await req.json().catch(() => ({}))) as {
      bookId?: number; pageId?: number; layer?: ReviseLayer; current?: string; instruction?: string;
    };
    if (!bookId) return json({ error: "bookId is required" }, 400);

    const { data: book, error: bookError } = await userClient
      .from("books").select("id, owner_id").eq("id", bookId).single();
    if (bookError || !book) return json({ error: "Book not found" }, 404);

    if (!(await hasEditAccess(userClient, bookId, user.id, book.owner_id)))
      return json({ error: "Access denied" }, 403);

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);

    const text = await reviseNode(userClient, apiKey, {
      bookId,
      layer: layer!,
      current: current ?? "",
      instruction: instruction ?? "",
      pageId,
      userId: user.id,
    });

    return json({ text });
  } catch (e) {
    console.error("revise-node error:", e);
    return json({ error: String((e as Error)?.message ?? e).slice(0, 500) }, 500);
  }
});
