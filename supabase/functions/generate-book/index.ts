// generate-book — write a book's draft as a durable, client-agnostic job: first PLAN BEATS for every
// objective-bearing page, then WRITE PROSE for every empty one (the "build the draft" cascade).
//
// This used to be a client for-loop in WriteAllPages.tsx: it died the moment the tab closed and lost
// its place on a refresh. Now it's a SELF-CHAINING edge function backed by a book_generations row
// (kind 'write_all'). It runs in two STAGES:
//   beats  — plan the beat for each objective-bearing page that lacks one, IN READING ORDER (causality
//            needs the previous beat), a small batch per invocation (beats are one paragraph, fast).
//   prose  — write prose for each empty page, ONE page per invocation (well under the ~150s cap; the
//            sequential order lets each render read the freshly-persisted preceding prose).
// Between the stages, an optional author checkpoint: if `pause_after_beats`, the row goes 'ready' with
// phase 'beats_done' and waits for an authenticated "Continue" (body.resume) before the prose stage.
// A pg_cron watchdog restarts the chain if a link dies. The client only watches the row.
//
//   client → POST { bookId, notify?, pauseAfterBeats? }        (authenticated kick-off)
//   client → POST { generationId, resume:true }                (authenticated continue after a pause)
//   self   → POST { generationId, chain:true }                 (x-chain secret; advances one unit)
//
// Clobber-safe: a page that already has a beat is skipped in the beat stage; a page that already has
// prose (or lost its objective) is skipped in the prose stage.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { beatToProse, tiptapToText } from "../_shared/generate-unit-core.ts";
import { objectiveToBeat } from "../_shared/beat-core.ts";
import { buildDoc } from "../_shared/build-doc.ts";
import { serviceClient } from "../_shared/task.ts";
import { reinvoke, isChainCall } from "../_shared/self-chain.ts";
import { captureException, isBillingError } from "../_shared/sentry.ts";
import { stampProse, stampBeat } from "../_shared/plan-provenance.ts";

const MAX_ATTEMPTS = 3; // 1 try + 2 retries per page (matches the old client loop)
// Across invocations: give up on a page after this many invocations fail to get past it. Guards the
// "stuck at N%" stall where a page keeps exceeding the worker's wall-clock cap, killing the worker
// mid-call (before progress is persisted) so the watchdog re-kicks the same head page forever.
const MAX_HEAD_ATTEMPTS = 3;
const BEATS_PER_INVOCATION = 5; // beats are one paragraph each — several fit under the worker cap
const RETRY_BASE_MS = 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

interface Progress {
  done: number;          // prose pages written
  total: number;         // prose pages to write
  remaining: number[];   // prose page ids still to write
  failures: number;
  phase?: string;        // human label, or the machine marker 'beats_done' while paused for review
  stage?: "beats" | "prose";
  beatsRemaining?: number[]; // page ids still needing a beat (beats stage)
  beatsTotal?: number;
  beatsDone?: number;
  pauseAfterBeats?: boolean;
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
      pauseAfterBeats?: boolean;
      generationId?: number;
      chain?: boolean;
      resume?: boolean;   // authenticated continue after a beats-review pause
      pageIds?: number[]; // re-render mode: rewrite THESE pages (even ones that already have prose)
    };

    // ── Continue call (self/watchdog): advance the chain by one unit ──
    if (body.chain) {
      if (!isChainCall(req)) return json({ error: "Unauthorized" }, 401);
      if (!body.generationId) return json({ error: "generationId required" }, 400);
      await advance(service, apiKey, body.generationId);
      return json({ ok: true });
    }

    // ── Authenticated calls (kick-off or resume) ──
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: "Unauthorized" }, 401);

    // ── Resume after a beats-review pause: verify access, flip 'ready' → 'running', restart chain ──
    if (body.resume) {
      if (!body.generationId) return json({ error: "generationId required" }, 400);
      const { data: gen } = await service
        .from("book_generations").select("id, book_id, status, progress").eq("id", body.generationId).maybeSingle();
      if (!gen) return json({ error: "Run not found" }, 404);
      if (!(await canEdit(userClient, gen.book_id, user.id))) return json({ error: "Access denied" }, 403);
      if (gen.status !== "ready") return json({ error: "This run is not waiting to continue" }, 409);
      const progress = { ...((gen.progress as Progress) ?? {}), stage: "prose" as const, phase: `Writing 0/${(gen.progress as Progress)?.total ?? 0}` };
      await service.from("book_generations").update({ status: "running", progress }).eq("id", gen.id);
      if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(reinvoke("generate-book", { generationId: gen.id }));
      return json({ status: "running", generationId: gen.id }, 202);
    }

    const { bookId, notify, pauseAfterBeats, pageIds } = body;
    if (!bookId) return json({ error: "bookId is required" }, 400);
    // Re-render mode: an explicit page set (e.g. "re-render stale") rewrites those pages from their
    // (updated) objectives, overwriting existing prose. The default fill mode targets empty pages.
    const rerenderIds = Array.isArray(pageIds) ? pageIds.filter((n) => typeof n === "number") : [];
    const rerender = rerenderIds.length > 0;

    const { data: book, error: bookError } = await userClient
      .from("books").select("id, owner_id").eq("id", bookId).single();
    if (bookError || !book) return json({ error: "Book not found" }, 404);
    if (!(await canEdit(userClient, bookId, user.id, book.owner_id))) return json({ error: "Access denied" }, 403);

    // Targets: text pages (with an objective), in reading order.
    const { data: pages, error: pagesError } = await userClient
      .from("pages")
      .select("id, content, metadata")
      .eq("book_id", bookId)
      .eq("page_type", "text")
      .eq("archived", false)
      .order("page_index", { ascending: true });
    if (pagesError) return json({ error: pagesError.message }, 500);

    const allPages = (pages as Array<{ id: number; content: unknown; metadata: { objective?: string; beat?: string } | null }>) ?? [];
    const remaining = rerender
      // Re-render: the given pages (in reading order) that still carry an objective. Existing prose
      // is intentionally overwritten — advance() bypasses its clobber-guard in this mode.
      ? allPages.filter((p) => rerenderIds.includes(p.id) && p.metadata?.objective).map((p) => p.id)
      // Fill: every empty, objective-bearing page.
      : allPages.filter((p) => p.metadata?.objective && !bodyText(p.content)).map((p) => p.id);

    if (remaining.length === 0) {
      return json({ error: rerender ? "None of those pages can be re-rendered (no objective)." : "No empty pages with an objective were found." }, 400);
    }

    // Beat stage targets: objective-bearing pages that don't yet have a beat. Re-render skips the beat
    // stage (it's an explicit prose overwrite from already-reviewed objectives).
    const beatsRemaining = rerender
      ? []
      : allPages.filter((p) => p.metadata?.objective && !(p.metadata?.beat ?? "").trim()).map((p) => p.id);
    const stage: "beats" | "prose" = beatsRemaining.length > 0 ? "beats" : "prose";

    const progress: Progress = {
      done: 0, total: remaining.length, remaining, failures: 0,
      stage, beatsRemaining, beatsTotal: beatsRemaining.length, beatsDone: 0,
      pauseAfterBeats: pauseAfterBeats === true && !rerender,
      phase: stage === "beats" ? `Planning beats 0/${beatsRemaining.length}` : `Writing 0/${remaining.length}`,
    };
    const { data: gen, error: insertError } = await service
      .from("book_generations")
      .insert({ book_id: bookId, created_by: user.id, kind: rerender ? "rerender_stale" : "write_all", scope: "book", status: "running", input: { rerender, pauseAfterBeats: progress.pauseAfterBeats }, progress, notify_email: notify === true })
      .select()
      .single();
    if (insertError || !gen) return json({ error: "Could not start the writing run" }, 500);

    // Start the chain (the first unit is done by the continue call).
    if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(reinvoke("generate-book", { generationId: gen.id }));

    return json({ status: "running", generation: gen }, 202);
  } catch (e) {
    console.error("generate-book error:", e);
    return json({ error: String((e as Error)?.message ?? e).slice(0, 500) }, 500);
  }
});

async function canEdit(client: ReturnType<typeof createClient>, bookId: number, userId: string, ownerId?: string): Promise<boolean> {
  if (ownerId && ownerId === userId) return true;
  if (!ownerId) {
    const { data: book } = await client.from("books").select("owner_id").eq("id", bookId).maybeSingle();
    if (book && (book as { owner_id: string }).owner_id === userId) return true;
  }
  const { data: access } = await client
    .from("book_access").select("id").eq("book_id", bookId).eq("user_id", userId).eq("status", "accepted").maybeSingle();
  return !!access;
}

// Advance one unit (a batch of beats, or one prose page), persist progress, then chain (or finish).
async function advance(service: ReturnType<typeof serviceClient>, apiKey: string, genId: number) {
  const { data: row } = await service
    .from("book_generations")
    .select("id, book_id, status, progress, input")
    .eq("id", genId)
    .maybeSingle();
  if (!row || row.status !== "running") return; // finished, errored, paused, or gone — stop the chain

  const progress = (row.progress as Progress) ?? { done: 0, total: 0, remaining: [], failures: 0 };
  const stage = progress.stage ?? "prose";

  try {
    if (stage === "beats") {
      await advanceBeats(service, apiKey, row.id, row.book_id, progress);
    } else {
      await advanceProse(service, apiKey, row.id, row.book_id, (row.input as { rerender?: boolean } | null)?.rerender === true, progress);
    }
  } catch (e) {
    // Hard failure (e.g. billing): record it as a terminal error on the row.
    const billing = isBillingError(e);
    await captureException(e, { function: "generate-book", book_id: String(row.book_id), billing: String(billing) });
    const msg = billing
      ? "AI credits exhausted — the team has been notified."
      : String((e as Error)?.message ?? e).slice(0, 1000);
    await service.from("book_generations").update({ status: "error", error: msg }).eq("id", genId);
  }
}

// ── Beat stage: plan a batch of beats in reading order, then chain (or hand off to prose/pause) ──
async function advanceBeats(
  service: ReturnType<typeof serviceClient>,
  apiKey: string,
  genId: number,
  bookId: number,
  progress: Progress,
) {
  const beatsRemaining = [...(progress.beatsRemaining ?? [])];
  let beatsDone = progress.beatsDone ?? 0;
  let failures = progress.failures;

  const batch = beatsRemaining.slice(0, BEATS_PER_INVOCATION);
  for (const pageId of batch) {
    const { data: page } = await service.from("pages").select("id, metadata").eq("id", pageId).maybeSingle();
    const objective = (page?.metadata as { objective?: string } | null)?.objective?.trim();
    if (!page || !objective) continue; // no longer eligible — drop silently
    if (((page.metadata as { beat?: string } | null)?.beat ?? "").trim()) { beatsDone++; continue; } // already has a beat
    try {
      // Best-of-3 in the bulk build: beats are one paragraph, so sampling 3 + judging is cents/page
      // and meaningfully lifts the rung everything below stands on. (The attended single-beat
      // workshop stays a fast single sample — candidates defaults to 1 there.)
      const beat = await objectiveToBeat(service, apiKey, { bookId, pageId, objective, candidates: 3, log: { taskTable: "book_generations", taskId: genId } });
      await stampBeat(service, pageId, objective, beat);
      beatsDone++;
    } catch (e) {
      if (isBillingError(e)) throw e; // bubble to the terminal-error handler in advance()
      failures++;
      console.error(`generate-book: beat for page ${pageId} failed:`, e);
    }
  }

  const restBeats = beatsRemaining.slice(batch.length);
  if (restBeats.length > 0) {
    const next: Progress = { ...progress, beatsRemaining: restBeats, beatsDone, failures, phase: `Planning beats ${beatsDone}/${progress.beatsTotal ?? 0}` };
    await service.from("book_generations").update({ progress: next }).eq("id", genId);
    if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(reinvoke("generate-book", { generationId: genId }));
    return;
  }

  // Beats done → checkpoint. Pause for review, or fall straight into the prose stage.
  const handedOff: Progress = { ...progress, beatsRemaining: [], beatsDone, failures, stage: "prose" };
  if (progress.pauseAfterBeats) {
    await service.from("book_generations").update({ status: "ready", progress: { ...handedOff, phase: "beats_done" } }).eq("id", genId);
    return;
  }
  await service.from("book_generations").update({ progress: { ...handedOff, phase: `Writing 0/${progress.total}` } }).eq("id", genId);
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(reinvoke("generate-book", { generationId: genId }));
}

// ── Prose stage: write ONE page, persist progress, then chain (or finish). ──
async function advanceProse(
  service: ReturnType<typeof serviceClient>,
  apiKey: string,
  genId: number,
  bookId: number,
  rerender: boolean,
  progress: Progress,
) {
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
        const text = await beatToProse(service, apiKey, { bookId, pageId, level: "page", objective, log: { taskTable: "book_generations", taskId: genId } });
        if (text) {
          const { error: upErr } = await service.from("pages").update({ content: buildDoc(page.title, text) }).eq("id", pageId);
          if (upErr) throw new Error(upErr.message);
          // Plan↔prose provenance: record which layer (beat or objective) this prose came from.
          await stampProse(service, pageId, objective, text);
          // Promise ledger: a page that seeds/pays off a thread flips its status (planned→open→closed).
          await maintainThreads(service, bookId, pageId);
        }
        written = true;
      } catch (e) {
        lastErr = e;
        if (isBillingError(e)) throw e; // a billing failure won't recover on retry — fail the run
        if (attempt < MAX_ATTEMPTS) await sleep(RETRY_BASE_MS * 2 ** (attempt - 1) + Math.random() * 250);
      }
    }
    if (!written) {
      failures++;
      console.error(`generate-book: page ${pageId} failed after ${MAX_ATTEMPTS} attempts:`, lastErr);
    }
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

// Maintain the promise/payoff ledger as prose is written: seeding a thread opens it, paying it off
// closes it. Best-effort — a thread bookkeeping miss must never fail the build.
async function maintainThreads(service: ReturnType<typeof serviceClient>, bookId: number, pageId: number) {
  try {
    await service.from("book_threads").update({ status: "open" })
      .eq("book_id", bookId).eq("setup_page_id", pageId).eq("status", "planned");
    await service.from("book_threads").update({ status: "closed" })
      .eq("book_id", bookId).eq("payoff_page_id", pageId).neq("status", "closed");
  } catch (e) {
    console.error("generate-book: maintainThreads failed (non-fatal):", e);
  }
}
