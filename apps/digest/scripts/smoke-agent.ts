/**
 * One real agent turn against a real digest — no UI, no browser.
 *
 *   cd apps/digest && DIGEST_AI_ENABLED=true npx tsx --env-file=.env.local scripts/smoke-agent.ts <digestId> "your message"
 *
 * THIS SPENDS MONEY (DeepSeek, a few tenths of a cent per turn) and, depending on what you ask for, THIS
 * WRITES to the digest. Ask it something read-only if you only want to see the loop run.
 *
 * `DIGEST_AI_ENABLED=true` is needed outside production for the same reason every other model path needs
 * it: iterating locally should never quietly spend real money (lib/digest/llm.ts `aiEnabled`).
 *
 * Service role, because a script has no session — so this bypasses RLS. The real caller passes a
 * request-scoped client and the agent is confined to one digest by `ToolCtx` either way.
 */
import { NEW_CHAT, runAgentTurn, type DigestForAgent } from "../lib/digest/agent/loop";
import { createServiceClient } from "../lib/supabase/server";

const digestId = Number(process.argv[2] ?? 1);
const message = process.argv[3] ?? "What's in this digest, and is anything about to silently fail?";
// Exercises the LOOP on a digest whose paid gate is off. It overrides `ai_enabled` in the object handed to
// runAgentTurn — so it tests the loop, NOT the gate, and says so rather than quietly flipping a column that
// exists to stop unattended spend. (The gate itself is trivially checked by dropping this flag.)
const forceAi = process.argv.includes("--force-ai");

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
    digest: { ...(data as DigestForAgent), ai_enabled: forceAi || (data as DigestForAgent).ai_enabled },
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
