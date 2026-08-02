/**
 * One real agent turn against a real digest — no UI, no browser.
 *
 *   cd apps/digest && npx tsx --env-file=.env.local scripts/smoke-agent.ts <digestId> "your message"
 *
 * THIS SPENDS MONEY (DeepSeek, a few tenths of a cent per turn) and, depending on what you ask for, THIS
 * WRITES to the digest. Ask it something read-only if you only want to see the loop run.
 *
 * No flag needed: the agent is available to every digest regardless of the paid `ai_enabled` tier
 * (lib/digest/llm.ts `agentEnabled`). `DIGEST_AI_ENABLED=false` is the only thing that stops it.
 *
 * Service role, because a script has no session — so this bypasses RLS. The real caller passes a
 * request-scoped client and the agent is confined to one digest by `ToolCtx` either way.
 */
import { NEW_CHAT, runAgentTurn, type DigestForAgent } from "../lib/digest/agent/loop";
import { createServiceClient } from "../lib/supabase/server";

const digestId = Number(process.argv[2] ?? 1);
const message = process.argv[3] ?? "What's in this digest, and is anything about to silently fail?";

async function main() {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("digests")
    .select("id, owner_id, name, ai_enabled")
    .eq("id", digestId)
    .single();
  if (error) throw new Error(error.message);

  console.log(`\n> ${message}\n`);
  const started = Date.now();
  const turn = await runAgentTurn({
    supabase: supabase as never,
    digest: data as DigestForAgent,
    chat: NEW_CHAT,
    message,
  });

  for (const s of turn.steps) {
    const input = JSON.stringify(s.input);
    console.log(`  ${s.isError ? "✗" : "·"} ${s.tool}${input === "{}" ? "" : ` ${input}`}`);
    console.log(`      ${s.result.split("\n").slice(0, 3).join("\n      ").slice(0, 400)}`);
  }

  console.log(`\n${turn.text}\n`);
  console.log(
    `[${turn.steps.length} tool call(s) · stopped at ${turn.stoppedAt} · ${Math.round(
      (Date.now() - started) / 1000,
    )}s]`,
  );
}

main();
