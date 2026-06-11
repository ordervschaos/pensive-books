// ai-run — the durable harness for SHORT AI ops (objective options, spine, node-revise, beats…).
//
// Every short op used to be a synchronous fetch held in client useState — abandoned the instant the
// author navigated away. This makes them server-owned, exactly like scaffold/eval: insert a
// book_generations row (status 'running') → return its id in ~1s → EdgeRuntime.waitUntil runs the
// Claude work → flip the row to 'ready' with the result. The client renders from the row over
// Realtime (useLatestTaskRow), so a refresh / second tab / navigate-away-and-back loses nothing.
//
//   client → POST { bookId, kind, targetKey?, targetPageId?, params } → auth + access → insert row
//          → { runId }   (background fills result)
//
// Cancel = the client sets status 'cancelled' (abandon: the result is discarded when it lands).
// Accept/reject = the client applies the result then sets 'applied' / 'dismissed'.
// Needs ANTHROPIC_API_KEY (shared with the other AI steps).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { runInBackground, serviceClient } from "../_shared/task.ts";
import { objectiveOptions } from "../_shared/options-core.ts";
import { generateSpine, spineOptions } from "../_shared/spine-core.ts";
import { reviseNode, type ReviseLayer } from "../_shared/revise-core.ts";
import { beatCandidates } from "../_shared/beat-core.ts";
import { foundationsOptions, spineRoutes, type FoundationsStep } from "../_shared/foundations-core.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Each kind maps to a worker that produces the row's `result`. Workers throw on failure (the harness
// turns a throw into a graceful error row). Add a case here to make a new short op durable.
async function runWorker(
  kind: string,
  params: Record<string, unknown>,
  ctx: { client: ReturnType<typeof createClient>; apiKey: string; bookId: number; userId: string },
): Promise<unknown> {
  switch (kind) {
    case "objective_options": {
      const options = await objectiveOptions(ctx.client, ctx.apiKey, {
        bookId: ctx.bookId,
        pageId: params.pageId as number | undefined,
        scaffold: params.scaffold as { pages?: never[] } | undefined,
        pageIndex: params.pageIndex as number | undefined,
        userId: ctx.userId,
      });
      return { options };
    }
    case "spine": {
      const text = await generateSpine(ctx.client, ctx.apiKey, { bookId: ctx.bookId, userId: ctx.userId });
      return { text };
    }
    case "spine_options": {
      const options = await spineOptions(ctx.client, ctx.apiKey, { bookId: ctx.bookId, userId: ctx.userId });
      return { options };
    }
    case "node_revise": {
      const text = await reviseNode(ctx.client, ctx.apiKey, {
        bookId: ctx.bookId,
        layer: params.layer as ReviseLayer,
        current: params.current as string,
        instruction: params.instruction as string,
        userId: ctx.userId,
      });
      return { text };
    }
    case "beat_candidates": {
      const options = await beatCandidates(ctx.client, ctx.apiKey, {
        bookId: ctx.bookId,
        pageId: params.pageId as number,
        objective: params.objective as string,
        userId: ctx.userId,
      }, 3);
      return { options };
    }
    case "foundations_options": {
      return await foundationsOptions(ctx.client, ctx.apiKey, {
        bookId: ctx.bookId,
        step: params.step as FoundationsStep,
        userId: ctx.userId,
      });
    }
    case "spine_routes": {
      const routes = await spineRoutes(ctx.client, ctx.apiKey, {
        bookId: ctx.bookId,
        avoid: params.avoid as string[] | undefined,
        userId: ctx.userId,
      });
      return { routes };
    }
    default:
      throw new Error(`Unknown ai-run kind: ${kind}`);
  }
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

    const { bookId, kind, targetKey, targetPageId, params } = (await req.json().catch(() => ({}))) as {
      bookId?: number; kind?: string; targetKey?: string; targetPageId?: number; params?: Record<string, unknown>;
    };
    if (!bookId || !kind) return json({ error: "bookId and kind are required" }, 400);

    const { data: book, error: bookError } = await userClient
      .from("books").select("id, owner_id").eq("id", bookId).single();
    if (bookError || !book) return json({ error: "Book not found" }, 404);

    const { data: access } = await userClient
      .from("book_access").select("id").eq("book_id", bookId).eq("user_id", user.id).eq("status", "accepted").maybeSingle();
    if (book.owner_id !== user.id && !access) return json({ error: "Access denied" }, 403);

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);

    // Insert the running row first (service role; the client watches it over Realtime), then hand the
    // slow Claude work to the background so the HTTP response returns immediately.
    const service = serviceClient();
    const { data: rowIns, error: insErr } = await service.from("book_generations").insert({
      book_id: bookId,
      created_by: user.id,
      kind,
      scope: targetPageId ? "page" : "book",
      target_page_id: targetPageId ?? null,
      target_key: targetKey ?? null,
      status: "running",
      input: params ?? {},
    }).select("id").single();
    if (insErr || !rowIns) return json({ error: `Could not start run: ${insErr?.message}` }, 500);

    runInBackground(service, "book_generations", rowIns.id, `ai-run:${kind}`, async () => {
      // If the author cancelled between insert and here, don't bother running (keep it cancelled).
      const { data: cur } = await service.from("book_generations").select("status").eq("id", rowIns.id).single();
      if (cur?.status === "cancelled") return { status: "cancelled" };
      const result = await runWorker(kind, params ?? {}, { client: userClient, apiKey, bookId, userId: user.id });
      // Re-check cancel right before the terminal write so a late cancel still wins (abandon the result).
      const { data: after } = await service.from("book_generations").select("status").eq("id", rowIns.id).single();
      if (after?.status === "cancelled") return { status: "cancelled" };
      return { status: "ready", result };
    });

    return json({ runId: rowIns.id });
  } catch (e) {
    console.error("ai-run error:", e);
    return json({ error: String((e as Error)?.message ?? e).slice(0, 500) }, 500);
  }
});
