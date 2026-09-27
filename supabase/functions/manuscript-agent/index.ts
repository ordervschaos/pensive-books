// manuscript-agent — the book's page-level editor AGENT: a durable, tool-using loop over the book's
// pages and fields (not the story DNA — that's book-agent). It reads pages, discusses the manuscript,
// and STAGES reviewable changes (book_agent_runs.proposals, kind='manuscript') that the author accepts
// in whole or word-by-word on the agent canvas (/books/:slug/agent). It never writes pages itself.
//
//   client → POST { bookId, message, model? }   → get-or-create thread (kind='manuscript') → chain
//   client → POST { runId, answer }              → append tool_result → chain
//   self   → POST { runId, chain: true }          → drive links in this worker (x-chain secret)
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, json } from "../_shared/cors.ts";
import { serviceClient, userClient as createUserClient } from "../_shared/task.ts";
import { isChainCall } from "../_shared/self-chain.ts";
import { ROW_COLS, type AgentStep, type RunRow } from "./shared.ts";
import { chain, driveChain } from "./advance.ts";

const KIND = "manuscript";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const service = serviceClient();
  try {
    const body = (await req.json().catch(() => ({}))) as { bookId?: number; runId?: number; answer?: string; chain?: boolean; message?: string; model?: string | null };

    if (body.chain) {
      if (!isChainCall(req)) return json({ error: "Unauthorized" }, 401);
      if (!body.runId) return json({ error: "runId required" }, 400);
      const work = driveChain(service, body.runId);
      if (typeof EdgeRuntime !== "undefined") { EdgeRuntime.waitUntil(work); return json({ ok: true }); }
      await work;
      return json({ ok: true });
    }

    const userClient = createUserClient(req.headers.get("Authorization") ?? "");
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: "Unauthorized" }, 401);

    // Answer to an ask_author question: append the tool_result and resume.
    if (body.runId) {
      const answer = (body.answer ?? "").trim();
      if (!answer) return json({ error: "answer is required" }, 400);
      const { data } = await userClient.from("book_agent_runs").select(ROW_COLS).eq("id", body.runId).maybeSingle();
      const row = data as RunRow | null;
      if (!row) return json({ error: "Run not found" }, 404);
      const { data: canEdit } = await userClient.rpc("user_can_edit_book", { _book_id: row.book_id });
      if (canEdit === false) return json({ error: "Access denied" }, 403);
      if (row.status !== "awaiting_input" || !row.pending) return json({ error: "The agent is not waiting for an answer" }, 409);
      const transcript = [...row.transcript, { role: "user", content: [...(row.pending.preResults ?? []), { type: "tool_result", tool_use_id: row.pending.tool_use_id, content: answer }] }];
      const steps = [...row.steps, { t: "answer", label: answer } as AgentStep];
      const { error } = await service.from("book_agent_runs").update({ transcript, steps, pending: null, status: "running", cancel_requested: false }).eq("id", row.id);
      if (error) throw new Error(error.message);
      chain(row.id);
      return json({ status: "running", runId: row.id }, 202);
    }

    if (typeof body.message === "string") {
      const bookId = body.bookId;
      const message = body.message.trim();
      if (!bookId) return json({ error: "bookId is required" }, 400);
      if (!message) return json({ error: "message is required" }, 400);
      const { data: canEdit } = await userClient.rpc("user_can_edit_book", { _book_id: bookId });
      if (canEdit === false) return json({ error: "Access denied" }, 403);
      // The author's model pick rides with every message (validated server-side at turn start).
      const model = typeof body.model === "string" && body.model.trim() ? body.model.trim().slice(0, 40) : null;

      const { data: existing } = await service.from("book_agent_runs").select(ROW_COLS).eq("book_id", bookId).eq("kind", KIND).maybeSingle();
      const thread = existing as RunRow | null;
      if (thread && (thread.status === "running" || thread.status === "awaiting_input")) {
        return json({ error: "The agent is mid-turn — answer its question or stop it first." }, 409);
      }
      const userMsg = { role: "user", content: [{ type: "text", text: message }] };
      const userStep = { t: "user", label: message } as AgentStep;
      if (!thread) {
        const { data: run, error } = await service.from("book_agent_runs")
          .insert({ book_id: bookId, created_by: user.id, kind: KIND, status: "running", context_model: model, transcript: [userMsg], steps: [userStep] })
          .select("id").single();
        if (error) throw new Error(error.message);
        const id = (run as { id: number }).id;
        chain(id);
        return json({ status: "running", runId: id }, 202);
      }
      const { error } = await service.from("book_agent_runs")
        .update({ transcript: [...thread.transcript, userMsg], steps: [...thread.steps, userStep], status: "running", turns: 0, pending: null, error: null, cancel_requested: false, context_model: model })
        .eq("id", thread.id);
      if (error) throw new Error(error.message);
      chain(thread.id);
      return json({ status: "running", runId: thread.id }, 202);
    }

    return json({ error: "Unrecognized request — expected { bookId, message }, { runId, answer }, or { runId, chain }." }, 400);
  } catch (e) {
    console.error("manuscript-agent error:", e);
    return json({ error: String((e as Error)?.message ?? e).slice(0, 500) }, 500);
  }
});
