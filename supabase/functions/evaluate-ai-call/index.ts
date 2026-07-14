// evaluate-ai-call — on-demand LLM-as-judge for one logged ai_call (phase 2).
//
//   client/script → POST { aiCallId }   (authenticated)
//     → read the ai_call (RLS: caller must be able to edit its book)
//     → INSERT ai_call_evals { status:'running' }   ← returned in ~1s
//     → background: judge via the shared callLLM chokepoint (the judge call is itself logged to
//       ai_calls as fn='judge-ai-call'), then UPDATE the eval row with scores/findings/amendments.
//
// On demand only — nothing auto-evaluates. Locally, getJudgeModel() rides the claude-local shim
// (scripts/claude-local-shim.mjs) instead of the metered API when CLAUDE_LOCAL_URL is set.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, json } from "../_shared/cors.ts";
import { runInBackground, serviceClient, userClient as createUserClient } from "../_shared/task.ts";
import { callLLM, textFromLLM } from "../_shared/llm.ts";
import { getJudgeModel, JUDGE_SYSTEM, buildJudgeUser, parseJudgement } from "../_shared/judge.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const userClient = createUserClient(req.headers.get("Authorization") ?? "");

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: "Unauthorized" }, 401);

    const { aiCallId } = (await req.json().catch(() => ({}))) as { aiCallId?: number };
    if (!aiCallId) return json({ error: "aiCallId is required" }, 400);

    // Read the call THROUGH the user client: ai_calls' RLS (user_can_edit_book) is the access check.
    const { data: call, error: callError } = await userClient
      .from("ai_calls")
      .select("id, book_id, fn, system, input, output")
      .eq("id", aiCallId)
      .maybeSingle();
    if (callError) return json({ error: callError.message }, 500);
    if (!call) return json({ error: "AI call not found or not accessible" }, 404);


    const service = serviceClient();
    const judgeModel = getJudgeModel();
    const { data: row, error: insertError } = await service
      .from("ai_call_evals")
      .insert({ ai_call_id: call.id, book_id: call.book_id, status: "running", judge_model: judgeModel })
      .select()
      .single();
    if (insertError || !row) return json({ error: "Could not start eval" }, 500);

    runInBackground(service, "ai_call_evals", row.id, "evaluate-ai-call", async () => {
      const data = await callLLM({
        model: judgeModel,
        max_tokens: 2000,
        system: [{ type: "text", text: JUDGE_SYSTEM, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: buildJudgeUser(call) }],
      }, { fn: "judge-ai-call", bookId: call.book_id, taskTable: "ai_call_evals", taskId: row.id });

      const text = textFromLLM(data).trim();
      const j = parseJudgement(text);
      return { status: "done", scores: j.scores, verdict: j.verdict, findings: j.findings, amendments: j.amendments };
    });

    return json({ status: "running", eval: row }, 202);
  } catch (e) {
    console.error("evaluate-ai-call error:", e);
    return json({ error: String((e as Error)?.message ?? e).slice(0, 500) }, 500);
  }
});
