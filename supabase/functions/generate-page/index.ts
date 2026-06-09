// generate-page — the PageWorkshop's single-page render/revise, as a durable task.
//
// PageWorkshop used to call generate-unit and hold the returned/proposed prose in React state, so a
// refresh threw away an in-flight render and any proposal awaiting the author's review. This wraps
// the same per-page worker (generate-unit-core) in the task-row pattern: the proposal lives in a
// book_generations row (scope='page'), watched over Realtime, surviving a refresh until applied.
//
//   client → POST { bookId, pageId, objective, mode?, issues? }
//     → verify edit access
//     → INSERT book_generations { kind:'page_write'|'page_revise', scope:'page', status:'running' }
//     → background: generateUnit → UPDATE row { status:'ready', result:{text} }
//     → client watches book_generations (filtered to this page) via Realtime; applies on confirm
//
// Generation itself is unchanged — same context + prompts as generate-unit (shared core).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { beatToProse, revisePage, type ReviseIssue } from "../_shared/generate-unit-core.ts";
import { runInBackground, serviceClient } from "../_shared/task.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

interface PageGenRequest {
  bookId: number;
  pageId: number;
  objective?: string;
  mode?: "write" | "revise";
  issues?: ReviseIssue[];
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

    const body = (await req.json().catch(() => ({}))) as Partial<PageGenRequest>;
    const { bookId, pageId } = body;
    const mode = body.mode === "revise" ? "revise" : "write";
    if (!bookId) return json({ error: "bookId is required" }, 400);
    if (!pageId) return json({ error: "pageId is required" }, 400);
    if (mode === "write" && !body.objective?.trim()) return json({ error: "objective is required" }, 400);
    if (mode === "revise" && (!Array.isArray(body.issues) || body.issues.length === 0)) {
      return json({ error: "issues are required for revise" }, 400);
    }

    // Book + access check (owner or accepted collaborator — mirrors the other functions).
    const { data: book, error: bookError } = await userClient
      .from("books")
      .select("id, owner_id")
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

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);

    const service = serviceClient();
    const { data: gen, error: insertError } = await service
      .from("book_generations")
      .insert({
        book_id: bookId,
        created_by: user.id,
        kind: mode === "revise" ? "page_revise" : "page_write",
        scope: "page",
        target_page_id: pageId,
        status: "running",
        input: { objective: body.objective ?? null, mode, issues: body.issues ?? null },
      })
      .select()
      .single();
    if (insertError || !gen) return json({ error: "Could not start page generation" }, 500);

    runInBackground(service, "book_generations", gen.id, "generate-page", async () => {
      const log = { taskTable: "book_generations", taskId: gen.id };
      const text = mode === "revise"
        ? await revisePage(service, apiKey, { bookId, pageId, objective: body.objective, issues: body.issues ?? [], log })
        : await beatToProse(service, apiKey, { bookId, pageId, level: "page", objective: body.objective, log });
      if (!text) throw new Error("The editor returned no text.");
      return { status: "ready", result: { text } };
    });

    return json({ status: "running", generation: gen }, 202);
  } catch (e) {
    console.error("generate-page error:", e);
    return json({ error: String((e as Error)?.message ?? e).slice(0, 500) }, 500);
  }
});
