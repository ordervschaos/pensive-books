// book-agent verify layer: judge a scene's prose against its own DNA plan (plan-conformance), scope
// payoffs to the last scene that carries them, and the auto-mode render→verify injection.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { nodeHandle, type AgentStep, type RunRow } from "./shared.ts";
import { liveNodes, scenesInOrder, type DnaNode, type SceneContent, type ThreadRef } from "../_shared/novel-dna.ts";
import { judgeAgainstPlan, planHasContent, type PlanAxisVerdict, type ScenePlan } from "../_shared/plan-gate.ts";

// §v1 fix (docs/agent-improvement-remaining.md): a beat's threads sometimes get minted verbatim onto EVERY
// child scene instead of split (confirmed on book 1229 — two sibling scenes carried byte-identical
// payoff-role refs). A "payoff" is a promise paid ONCE; judging every duplicate-holding sibling against it
// FAILs the ones that don't actually deliver it, and the agent learns to dismiss verify (alarm fatigue,
// partially defeating P2.3). Scope payoff judgment to the LAST scene (book reading order) that still carries
// a given ref — earlier scenes sharing it are a stale copy, not a second obligation, so drop it from their plan.
async function scopePayoffsToLatestScene(
  service: SupabaseClient, bookId: number, sceneId: string, threadRefs: ThreadRef[],
): Promise<ThreadRef[]> {
  const payoffRefs = new Set(threadRefs.filter((r) => r?.role === "payoff" && r.ref).map((r) => r.ref));
  if (!payoffRefs.size) return threadRefs;
  const { data: allNodes } = await service.from("book_nodes")
    .select("id, book_id, parent_id, level, kind, position, content, authoring")
    .eq("book_id", bookId);
  if (!allNodes?.length) return threadRefs;
  // liveNodes: a materialized placeholder scene is not a later payoff site (doc_1785673597000.md §5a).
  // Safe for the target scene itself — this path only runs on scenes that already have prose.
  const order = scenesInOrder(liveNodes(allNodes as DnaNode[]));
  const selfIdx = order.findIndex((n) => n.id === sceneId);
  if (selfIdx < 0) return threadRefs;
  const laterHasPayoff = new Set<string>();
  for (const later of order.slice(selfIdx + 1)) {
    for (const t of (later.content as SceneContent)?.threads ?? []) {
      if (t?.role === "payoff" && t.ref && payoffRefs.has(t.ref)) laterHasPayoff.add(t.ref);
    }
  }
  return laterHasPayoff.size ? threadRefs.filter((r) => !(r.role === "payoff" && laterHasPayoff.has(r.ref))) : threadRefs;
}

// Build a scene's PLAN SLICE from its DNA edges (resolving thread ids → names/promises so the judge reads the
// promise, not a hash) and judge its prose against it (P2.2). Shared by the check_against_contract tool and the
// P2.3 auto-verify. Returns null when the scene has no prose; `{axes:[], summary}` when it has no structural
// plan; else the judged axes + an indented summary. `fn` labels the caller in ai_calls.
async function planConformanceSummary(
  service: SupabaseClient, model: string, sceneId: string, content: SceneContent | null | undefined, fn: string, bookId: number,
): Promise<{ axes: PlanAxisVerdict[]; summary: string } | null> {
  const c = (content ?? {}) as SceneContent;
  const proseText = (c.prose?.text ?? "").trim();
  if (!proseText) return null;
  const rawThreadRefs = (Array.isArray(c.threads) ? c.threads : []).filter((r): r is ThreadRef => !!r?.ref);
  const threadRefs = await scopePayoffsToLatestScene(service, bookId, sceneId, rawThreadRefs);
  const threadIds = threadRefs.map((r) => r.ref);
  const { data: threadNodes } = threadIds.length
    ? await service.from("book_nodes").select("id, content").in("id", threadIds)
    : { data: [] as { id: string; content: Record<string, unknown> }[] };
  const tById = new Map((threadNodes ?? []).map((tn) => [tn.id, tn.content as { name?: string; promise?: string }]));
  const plan: ScenePlan = {
    goal: c.goal, outcome: c.outcome,
    valueShift: c.value_shift ? { value: c.value_shift.value, from: c.value_shift.from, to: c.value_shift.to, polarity: c.value_shift.polarity } : undefined,
    establishes: c.establishes, needs: c.needs,
    threads: threadRefs.map((r) => ({ name: tById.get(r.ref)?.name ?? "(unnamed thread)", promise: tById.get(r.ref)?.promise, role: r.role })),
    direction: c.sketch?.direction,
  };
  if (!planHasContent(plan)) return { axes: [], summary: "  this scene has no structural plan (no value_shift / establishes / threads) to check against." };
  const axes = await judgeAgainstPlan(model, plan, proseText, { fn, bookId, nodeId: sceneId, operation: "plan-conformance", taskTable: "book_agent_runs", taskId: null, userId: null });
  const summary = axes.map((a) => `  ${a.field}: ${a.verdict.toUpperCase()} — ${a.detail}${a.evidence ? ` (e.g. "${a.evidence}")` : ""}`).join("\n");
  return { axes, summary };
}

// Marks the injected auto-verify block so a transient re-chain of the same turn doesn't append it twice.
const VERIFY_SENTINEL = "🔎 AUTO-VERIFY";

// P2.3 — enforced render→verify. In AUTO mode, right after an APPLIED prose render (the render was the prior
// assistant turn; the client has since written the prose and resumed us), judge the rendered scene(s) against
// their OWN plan and INJECT the verdict into the transcript before this turn's model call — so verify is a
// STRUCTURAL step the cheap model can't skip (it was only a line in the objective recipe before) and the model
// is told to FIX any fail before moving on. Returns the augmented { transcript, steps } (persisted) or the
// originals. Best-effort: any failure returns the originals unchanged so the auto loop never breaks.
async function maybeInjectRenderVerify(
  service: SupabaseClient, model: string, row: RunRow,
): Promise<{ transcript: unknown[]; steps: AgentStep[] }> {
  const fallback = { transcript: row.transcript, steps: row.steps };
  try {
    // deno-lint-ignore no-explicit-any
    const transcript = row.transcript as { role: string; content: any[] }[];
    const lastAssistant = [...transcript].reverse().find((m) => m.role === "assistant");
    const renderUse = lastAssistant?.content?.find?.((b) => b.type === "tool_use" && b.name === "propose_prose_render");
    if (!renderUse) return fallback;
    const sceneIds = (Array.isArray(renderUse.input?.sceneIds) ? renderUse.input.sceneIds : [])
      .filter((s: unknown): s is string => typeof s === "string").slice(0, 3); // bound cost: at most 3 scenes/turn
    if (!sceneIds.length) return fallback;
    const lastMsg = transcript[transcript.length - 1];
    if (!lastMsg || lastMsg.role !== "user" || !Array.isArray(lastMsg.content)) return fallback;
    // Idempotency: skip if we already appended a verdict to this turn's ack (a transient call retry re-runs advance).
    if (lastMsg.content.some((b) => b.type === "text" && String(b.text ?? "").startsWith(VERIFY_SENTINEL))) return fallback;

    // One judge call per scene, all independent — run them together (this happens BEFORE the turn's
    // model call, so serial judges here added straight to the author's perceived latency).
    const blocks = (await Promise.all(sceneIds.map(async (id: string) => {
      const { data: sc } = await service.from("book_nodes").select("content").eq("id", id).maybeSingle();
      const content = (sc as { content?: SceneContent } | null)?.content;
      const res = await planConformanceSummary(service, model, id, content, "book-agent-autoverify", row.book_id);
      if (!res || !res.axes.length) return null; // no prose written yet, or no structural plan → nothing to enforce
      return `Scene [${id}] “${nodeHandle(content as Record<string, unknown>)}”:\n${res.summary}`;
    }))).filter((b): b is string => !!b);
    if (!blocks.length) return fallback;
    const text = `${VERIFY_SENTINEL} (plan conformance — the server checked the scene(s) you just rendered against their own plan):\n\n${blocks.join("\n\n")}\n\nIf any axis FAILED, fix that scene FIRST — propose_prose_render again with a corrective brief, or propose_node_ops for a small wording fix — before rendering the next scene. If all PASSED, continue.`;
    const augmented = transcript.map((m, i) => i === transcript.length - 1 ? { ...m, content: [...m.content, { type: "text", text }] } : m);
    const steps = [...row.steps, { t: "read", label: "Auto-verified the rendered scene against its plan." } as AgentStep];
    await service.from("book_agent_runs").update({ transcript: augmented, steps }).eq("id", row.id);
    return { transcript: augmented, steps };
  } catch (e) {
    console.error(`book-agent auto-verify skipped (run ${row.id}):`, e);
    return fallback;
  }
}

export { planConformanceSummary, maybeInjectRenderVerify, VERIFY_SENTINEL };
