// generate-book — write prose for every empty, objective-bearing page (the "write all pages"
// cascade), as a durable, client-agnostic job.
//
// This used to be a client for-loop in WriteAllPages.tsx: it died the moment the tab closed and
// lost its place on a refresh. Now it's a SELF-CHAINING edge function backed by a book_generations
// row (kind 'write_all'). Each invocation writes ONE page (well under the ~150s worker cap),
// persists progress, then fire-and-forgets a call to ITSELF for the next page. A pg_cron watchdog
// restarts the chain if a link dies. The client only watches the row.
//
//   client → POST { bookId, notify? }                         (authenticated kick-off)
//     → verify edit access
//     → INSERT book_generations { kind:'write_all', status:'running', progress:{done:0,total,remaining} }
//     → reinvoke self { generationId, chain:true }            (start the chain)
//     → return the row (client watches it over Realtime)
//
//   self → POST { generationId, chain:true }                  (x-chain secret; no user auth)
//     → load row → write the next remaining page (generate-unit-core) → update progress
//     → more pages? reinvoke self : status 'done'
//
// One page per invocation also enforces the sequential order generate-unit-core relies on (it reads
// the freshly-persisted preceding prose for continuity). Clobber-safe: a page that already has
// prose, or lost its objective, is skipped.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { generateUnit, tiptapToText } from "../_shared/generate-unit-core.ts";
import { buildDoc } from "../_shared/build-doc.ts";
import { serviceClient } from "../_shared/task.ts";
import { reinvoke, isChainCall } from "../_shared/self-chain.ts";
import { captureException, isBillingError } from "../_shared/sentry.ts";
import { stampProse } from "../_shared/plan-provenance.ts";

const MAX_ATTEMPTS = 3; // 1 try + 2 retries per page (matches the old client loop)
// Across invocations: give up on a page after this many invocations fail to get past it. Guards the
// "stuck at N%" stall where a page keeps exceeding the worker's wall-clock cap, killing the worker
// mid-call (before progress is persisted) so the watchdog re-kicks the same head page forever.
const MAX_HEAD_ATTEMPTS = 3;
const RETRY_BASE_MS = 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

interface Progress {
  done: number;
  total: number;
  remaining: number[]; // page ids still to write
  failures: number;
  phase?: string;
  headPageId?: number | null; // the page at the front of `remaining` we're currently attempting
  headAttempts?: number;      // how many invocations have tried that head page (poison-page guard)
}

// Body text excluding the leading title heading — decides if a page is still "empty".
function bodyText(content: unknown): string {
  if (!content || typeof content !== "object") return typeof content === "string" ? content : "";
  const doc = content as { content?: Array<Record<string, unknown>> };
  if (!Array.isArray(doc.content)) return "";
  const nodes = doc.content[0]?.type === "heading" ? doc.content.slice(1) : doc.content;
  return nodes.map((n) => tiptapToText(n)).join("").trim();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);
  const service = serviceClient();

  try {
    const body = (await req.json().catch(() => ({}))) as {
      bookId?: number;
      notify?: boolean;
      generationId?: number;
      chain?: boolean;
      pageIds?: number[]; // re-render mode: rewrite THESE pages (even ones that already have prose)
    };

    // ── Continue call (self/watchdog): advance the chain by one page ──
    if (body.chain) {
      if (!isChainCall(req)) return json({ error: "Unauthorized" }, 401);
      if (!body.generationId) return json({ error: "generationId required" }, 400);
      await advance(service, apiKey, body.generationId);
      return json({ ok: true });
    }

    // ── Kick-off (authenticated client) ──
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: "Unauthorized" }, 401);

    const { bookId, notify, pageIds } = body;
    if (!bookId) return json({ error: "bookId is required" }, 400);
    // Re-render mode: an explicit page set (e.g. "re-render stale") rewrites those pages from their
    // (updated) objectives, overwriting existing prose. The default fill mode targets empty pages.
    const rerenderIds = Array.isArray(pageIds) ? pageIds.filter((n) => typeof n === "number") : [];
    const rerender = rerenderIds.length > 0;

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

    // Targets: empty text pages that have an objective, in reading order.
    const { data: pages, error: pagesError } = await userClient
      .from("pages")
      .select("id, content, metadata")
      .eq("book_id", bookId)
      .eq("page_type", "text")
      .eq("archived", false)
      .order("page_index", { ascending: true });
    if (pagesError) return json({ error: pagesError.message }, 500);

    const allPages = (pages as Array<{ id: number; content: unknown; metadata: { objective?: string } | null }>) ?? [];
    const remaining = rerender
      // Re-render: the given pages (in reading order) that still carry an objective. Existing prose
      // is intentionally overwritten — advance() bypasses its clobber-guard in this mode.
      ? allPages.filter((p) => rerenderIds.includes(p.id) && p.metadata?.objective).map((p) => p.id)
      // Fill: every empty, objective-bearing page.
      : allPages.filter((p) => p.metadata?.objective && !bodyText(p.content)).map((p) => p.id);

    if (remaining.length === 0) {
      return json({ error: rerender ? "None of those pages can be re-rendered (no objective)." : "No empty pages with an objective were found." }, 400);
    }

    const progress: Progress = { done: 0, total: remaining.length, remaining, failures: 0, phase: `Writing 0/${remaining.length}` };
    const { data: gen, error: insertError } = await service
      .from("book_generations")
      .insert({ book_id: bookId, created_by: user.id, kind: rerender ? "rerender_stale" : "write_all", scope: "book", status: "running", input: { rerender }, progress, notify_email: notify === true })
      .select()
      .single();
    if (insertError || !gen) return json({ error: "Could not start the writing run" }, 500);

    // Start the chain (the first page is written by the continue call).
    if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(reinvoke("generate-book", { generationId: gen.id }));

    return json({ status: "running", generation: gen }, 202);
  } catch (e) {
    console.error("generate-book error:", e);
    return json({ error: String((e as Error)?.message ?? e).slice(0, 500) }, 500);
  }
});

// Advance one page, persist progress, then chain to the next (or finish).
async function advance(service: ReturnType<typeof serviceClient>, apiKey: string, genId: number) {
  const { data: row } = await service
    .from("book_generations")
    .select("id, book_id, status, progress, input")
    .eq("id", genId)
    .maybeSingle();
  if (!row || row.status !== "running") return; // finished, errored, or gone — stop the chain

  const rerender = (row.input as { rerender?: boolean } | null)?.rerender === true;
  const progress = (row.progress as Progress) ?? { done: 0, total: 0, remaining: [], failures: 0 };
  const remaining = [...progress.remaining];

  if (remaining.length === 0) {
    await service.from("book_generations").update({ status: "done", progress: { ...progress, phase: "Done" } }).eq("id", genId);
    return;
  }

  const pageId = remaining[0];

  // Poison-page guard. Count attempts on the current head page across invocations. A worker killed
  // mid-generation (page over the wall-clock cap) never reaches the progress write below, so the
  // head page would otherwise be retried forever. Past the limit, skip it as a failure and move on.
  const headAttempts = (progress.headPageId === pageId ? progress.headAttempts ?? 0 : 0) + 1;
  if (headAttempts > MAX_HEAD_ATTEMPTS) {
    console.error(`generate-book: skipping page ${pageId} after ${MAX_HEAD_ATTEMPTS} stalled attempts`);
    const done = progress.done + 1;
    const skipped: Progress = {
      ...progress, remaining: remaining.slice(1), done, failures: progress.failures + 1,
      headPageId: null, headAttempts: 0, phase: `Writing ${done}/${progress.total}`,
    };
    if (skipped.remaining.length > 0) {
      await service.from("book_generations").update({ progress: skipped }).eq("id", genId);
      if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(reinvoke("generate-book", { generationId: genId }));
    } else {
      await service.from("book_generations").update({ status: "done", progress: { ...skipped, phase: "Done" } }).eq("id", genId);
    }
    return;
  }

  // Record the attempt BEFORE the slow generation, so a worker killed mid-call still counts toward
  // the guard above (this persisted write is what lets the next invocation know we already tried).
  await service.from("book_generations").update({ progress: { ...progress, headPageId: pageId, headAttempts } }).eq("id", genId);

  let failures = progress.failures;

  try {
    // Re-read the page now (clobber-safe + fresh objective). Skip if no longer eligible.
    const { data: page } = await service
      .from("pages")
      .select("id, title, content, metadata")
      .eq("id", pageId)
      .maybeSingle();
    const objective = (page?.metadata as { objective?: string } | null)?.objective;
    const alreadyWritten = page ? bodyText(page.content) : true;

    // Fill mode skips a page that already has prose (clobber-safe). Re-render mode is an explicit
    // overwrite, so it proceeds regardless — stampProse afterward re-syncs prose_src_hash.
    if (page && objective && (rerender || !alreadyWritten)) {
      let written = false;
      let lastErr: unknown = null;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS && !written; attempt++) {
        try {
          const text = await generateUnit(service, apiKey, { bookId: row.book_id, pageId, level: "page", objective, log: { taskTable: "book_generations", taskId: row.id } });
          if (text) {
            const { error: upErr } = await service.from("pages").update({ content: buildDoc(page.title, text) }).eq("id", pageId);
            if (upErr) throw new Error(upErr.message);
            // Plan↔prose provenance: record which objective this prose was written from.
            await stampProse(service, pageId, objective);
          }
          written = true;
        } catch (e) {
          lastErr = e;
          // A billing failure won't recover on retry — fail the whole run so the author is told.
          if (isBillingError(e)) throw e;
          if (attempt < MAX_ATTEMPTS) await sleep(RETRY_BASE_MS * 2 ** (attempt - 1) + Math.random() * 250);
        }
      }
      if (!written) {
        failures++;
        console.error(`generate-book: page ${pageId} failed after ${MAX_ATTEMPTS} attempts:`, lastErr);
      }
    }
  } catch (e) {
    // Hard failure (e.g. billing): record it as a terminal error on the row.
    const billing = isBillingError(e);
    await captureException(e, { function: "generate-book", book_id: String(row.book_id), billing: String(billing) });
    const msg = billing
      ? "AI credits exhausted — the team has been notified."
      : String((e as Error)?.message ?? e).slice(0, 1000);
    await service.from("book_generations").update({ status: "error", error: msg }).eq("id", genId);
    return;
  }

  const done = progress.done + 1;
  const rest = remaining.slice(1);
  const next: Progress = { ...progress, remaining: rest, done, failures, headPageId: null, headAttempts: 0, phase: `Writing ${done}/${progress.total}` };

  if (rest.length > 0) {
    await service.from("book_generations").update({ progress: next }).eq("id", genId);
    if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(reinvoke("generate-book", { generationId: genId }));
  } else {
    await service.from("book_generations").update({ status: "done", progress: { ...next, phase: "Done" } }).eq("id", genId);
  }
}
