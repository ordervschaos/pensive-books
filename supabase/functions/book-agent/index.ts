// book-agent — the book's ONE tool-using story-editor AGENT: a durable loop over the Novel DNA tree
// (docs/agent-rail.md, agent-capabilities.md). It holds the whole book_nodes tree as a digest, discusses
// it, and proposes reviewable changes (node ops, prose-render requests, alternatives) the author applies.
//
// It is read-only on book_nodes itself: every propose_* tool ends the turn and stages a reviewable
// proposal in book_agent_runs.proposals — the author (or auto-accept) applies it through the existing
// write path (applyNodeOps / the v2 prose pipeline). There is no path from the agent straight to book_nodes.
//
// Durability: the run lives in a book_agent_runs row (kind='thread', one per book); each self-chain link
// makes ONE Claude call (well under the ~150s worker cap), executes its tool calls, persists the
// transcript, and chains. An ask_author call parks the run in `awaiting_input` (no chain) until the
// author answers; the pg_cron watchdog only revives stalled 'running' rows. See docs/agent-runtime-architecture.md.
//
//   client → POST { bookId, message }                → get-or-create thread → chain (authenticated)
//   client → POST { runId, answer }                  → append tool_result → chain  (authenticated)
//   self   → POST { runId, chain: true }              → one model call → …          (x-chain secret)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, json } from "../_shared/cors.ts";
import { serviceClient, userClient as createUserClient } from "../_shared/task.ts";
import { isChainCall } from "../_shared/self-chain.ts";
import { ROW_COLS, type AgentStep, type RunRow } from "./shared.ts";
import { advance, chain } from "./advance.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const service = serviceClient();

  try {
    const body = (await req.json().catch(() => ({}))) as {
      bookId?: number; runId?: number; answer?: string; chain?: boolean; autoContinue?: boolean;
      message?: string; analysis?: string; effort?: "low" | "high"; auto?: boolean; objective?: string; attachedIds?: string[];
    };

    // ── Continue call (self/watchdog): advance one model turn ──
    if (body.chain) {
      if (!isChainCall(req)) return json({ error: "Unauthorized" }, 401);
      if (!body.runId) return json({ error: "runId required" }, 400);
      await advance(service, body.runId);
      return json({ ok: true });
    }

    // ── Authenticated client calls ──
    const userClient = createUserClient(req.headers.get("Authorization") ?? "");
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: "Unauthorized" }, 401);

    // Auto-accept LIVE loop: the client applied the agent's last staged change to the tree and is asking us
    // to resume the run, so the agent's next turn reads the updated tree. Pure status flip + chain — no
    // transcript edit (the transcript already ends with the propose_node_ops tool_result the model replies
    // to) and NO turns reset, so MAX_TURNS still bounds the whole autonomous instruction.
    if (body.runId && body.autoContinue) {
      const { data } = await userClient.from("book_agent_runs").select(ROW_COLS).eq("id", body.runId).maybeSingle();
      const row = data as RunRow | null;
      if (!row) return json({ error: "Run not found" }, 404);
      const { data: canEdit } = await userClient.rpc("user_can_edit_book", { _book_id: row.book_id });
      if (canEdit === false) return json({ error: "Access denied" }, 403);
      if (row.kind !== "thread" || !row.context_auto) return json({ error: "Not an autonomous thread" }, 409);
      if (row.status !== "idle") return json({ status: row.status, runId: row.id }, 202); // already running/parked — nothing to resume
      // Re-write `steps` (unchanged) alongside `status` — same unchanged-TOAST gotcha as the `turns` tick
      // below: a partial update can still arrive over Realtime with steps=null, blanking the feed, even with
      // REPLICA IDENTITY FULL. This fires on every auto-accept apply→continue cycle, so it's worth hardening.
      // cancel_requested reset here too: a Stop click that arrived after the prior turn already went
      // terminal leaves the flag stuck true, which would otherwise cancel THIS resumed turn on its first
      // advance() (the top-of-function check reads it unconditionally).
      await service.from("book_agent_runs").update({ status: "running", steps: row.steps, cancel_requested: false }).eq("id", row.id);
      chain(row.id);
      return json({ status: "running", runId: row.id }, 202);
    }

    // Answer to an ask_author question: append the tool_result and resume the chain.
    if (body.runId) {
      const answer = (body.answer ?? "").trim();
      if (!answer) return json({ error: "answer is required" }, 400);
      const { data } = await userClient.from("book_agent_runs").select(ROW_COLS).eq("id", body.runId).maybeSingle();
      const row = data as RunRow | null;
      if (!row) return json({ error: "Run not found" }, 404);
      const { data: canEdit } = await userClient.rpc("user_can_edit_book", { _book_id: row.book_id });
      if (canEdit === false) return json({ error: "Access denied" }, 403);
      if (row.status !== "awaiting_input" || !row.pending) return json({ error: "Run is not waiting for input" }, 409);

      const transcript = [...row.transcript, {
        role: "user",
        content: [
          ...(row.pending.preResults ?? []),
          { type: "tool_result", tool_use_id: row.pending.tool_use_id, content: answer },
        ],
      }];
      const steps = [...row.steps, { t: "answer", label: answer } as AgentStep];
      // cancel_requested: false — same stale-flag hazard as autoContinue above: a Stop click that missed
      // the parked turn must not cancel the turn this answer just resumed.
      const { error } = await service.from("book_agent_runs")
        .update({ transcript, steps, pending: null, status: "running", cancel_requested: false })
        .eq("id", row.id);
      if (error) throw new Error(error.message);
      chain(row.id);
      return json({ status: "running", runId: row.id }, 202);
    }

    // ── Thread message (the persistent omni-rail conversation — docs/agent-rail.md) ──
    // A free-text message to the book's ONE agent thread. Get-or-create the thread row (kind='thread'),
    // append the message, reset the per-turn budget, and drive it. A turn ends in 'idle' (not 'done'),
    // so the next message resumes with full transcript context.
    if (typeof body.message === "string") {
      const tBookId = body.bookId;
      const message = body.message.trim();
      if (!tBookId) return json({ error: "bookId is required" }, 400);
      if (!message) return json({ error: "message is required" }, 400);
      const { data: canEdit } = await userClient.rpc("user_can_edit_book", { _book_id: tBookId });
      if (canEdit === false) return json({ error: "Access denied" }, 403);

      // The client-computed story analysis (the engine lives in the web app) — refreshed this turn.
      const analysis: string | null = typeof body.analysis === "string" && body.analysis.trim() ? body.analysis.trim() : null;
      // The client-computed CURRENT OBJECTIVE (the now journey rung + recipe) — the guided-flow anchor.
      const objective: string | null = typeof body.objective === "string" && body.objective.trim() ? body.objective.trim() : null;
      // The context tray: node ids the author attached as anchors. Stashed on the thread and hydrated into a
      // live <focus> block each turn (never glued to the message, so it can't go stale in the transcript).
      const attachedIds: string[] | null = Array.isArray(body.attachedIds)
        ? body.attachedIds.filter((id): id is string => typeof id === "string" && !!id).slice(0, 40)
        : null;
      // Effort: "low" = propose inline on first response without exploring; "high" (default) = full tool loop.
      const effort: "low" | "high" = body.effort === "low" ? "low" : "high";
      // Auto-accept: run autonomously — the agent commits its own picks and never parks on ask_author; the
      // client auto-applies the proposals it stages. Carried on the run so every chain link sees it.
      const auto: boolean = body.auto === true;

      const { data: existing } = await service
        .from("book_agent_runs").select(ROW_COLS).eq("book_id", tBookId).eq("kind", "thread").maybeSingle();
      const thread = existing as RunRow | null;

      if (thread && (thread.status === "running" || thread.status === "awaiting_input")) {
        return json({ error: "The agent is mid-turn — answer its question or stop it first." }, 409);
      }

      if (!thread) {
        const { data: run, error: insErr } = await service
          .from("book_agent_runs")
          .insert({
            book_id: tBookId,
            created_by: user.id,
            kind: "thread",
            status: "running",
            context_analysis: analysis,
            context_objective: objective,
            context_attached_ids: attachedIds,
            context_effort: effort,
            context_auto: auto,
            transcript: [{ role: "user", content: [{ type: "text", text: message }] }],
            steps: [{ t: "user", label: message }],
          })
          .select("id")
          .single();
        if (insErr) throw new Error(insErr.message);
        const id = (run as { id: number }).id;
        chain(id);
        return json({ status: "running", runId: id }, 202);
      }

      // A fresh turn on the existing thread: append the message, reset the per-turn budget, clear any
      // prior error/cancel, and run.
      const transcript = [...thread.transcript, { role: "user", content: [{ type: "text", text: message }] }];
      const steps = [...thread.steps, { t: "user", label: message } as AgentStep];
      const { error } = await service.from("book_agent_runs")
        .update({ transcript, steps, status: "running", turns: 0, pending: null, error: null, cancel_requested: false, context_analysis: analysis, context_objective: objective, context_attached_ids: attachedIds, context_effort: effort, context_auto: auto })
        .eq("id", thread.id);
      if (error) throw new Error(error.message);
      chain(thread.id);
      return json({ status: "running", runId: thread.id }, 202);
    }

    return json({ error: "Unrecognized request — expected { message } for the agent thread, { runId, answer }, or { runId, chain }." }, 400);
  } catch (e) {
    console.error("book-agent error:", e);
    return json({ error: String((e as Error)?.message ?? e).slice(0, 500) }, 500);
  }
});
