import { assertEquals } from "jsr:@std/assert@1";
import { resolveRoleModels } from "./model-config.ts";

// §4c: per-role model resolution. Behaviour-preserving when no overrides are set; each role reads its own
// tier override with fallback to the base tier.

Deno.test("no overrides → every role is the base tier's high (behaviour-preserving)", () => {
  const r = resolveRoleModels({ ai_model_tier: "opus" });
  assertEquals(r.agent, "claude-opus-4-8");
  assertEquals(r.structure, "claude-opus-4-8");
  assertEquals(r.prose, "claude-opus-4-8");
  assertEquals(r.low, "claude-haiku-4-5-20251001");
});

Deno.test("empty map → sonnet default for all roles", () => {
  const r = resolveRoleModels({});
  assertEquals(r.agent, "claude-sonnet-4-6");
  assertEquals(r.prose, "claude-sonnet-4-6");
});

Deno.test("the documented split: prose on a prose-specialist, structure/agent on JSON-reliable", () => {
  // hermes writes great prose but breaks structural JSON (model-config warns) — so run prose on hermes while
  // keeping structure + agent on sonnet. Each override is independent; the base tier only backs the unset ones.
  const r = resolveRoleModels({
    ai_model_tier: "sonnet",
    ai_model_tier_prose: "hermes",
  });
  assertEquals(r.prose, "nousresearch/hermes-3-llama-3.1-405b");
  assertEquals(r.structure, "claude-sonnet-4-6"); // falls back to base
  assertEquals(r.agent, "claude-sonnet-4-6");     // falls back to base
});

Deno.test("hermes agent override with a tool-capable base → falls back to the base high (stays in-family)", () => {
  // hermes has no OpenRouter tool-use endpoint; the agent loop always sends tools, so it must not run there.
  // With a sonnet base, the fence keeps the agent on the base's Anthropic model rather than jumping tiers.
  const r = resolveRoleModels({ ai_model_tier: "sonnet", ai_model_tier_agent: "hermes" });
  assertEquals(r.agent, "claude-sonnet-4-6");                          // fenced to the tool-capable base high
  assertEquals(r.prose, "claude-sonnet-4-6");                          // prose unaffected (base)
});

Deno.test("hermes as the BASE tier → agent on the OpenRouter default, prose/structure stay hermes", () => {
  // Base high is hermes (tool-incapable) too, so the agent drops to the OpenRouter default (qwen) — NOT
  // Anthropic sonnet: a hermes user is deliberately off the Anthropic path.
  const r = resolveRoleModels({ ai_model_tier: "hermes" });
  assertEquals(r.agent, "qwen/qwen3-235b-a22b");                      // fenced to the OpenRouter fallback
  assertEquals(r.structure, "nousresearch/hermes-3-llama-3.1-405b");  // structure still base high
  assertEquals(r.prose, "nousresearch/hermes-3-llama-3.1-405b");      // prose still base high
});

Deno.test("an unknown override tier falls back to the base tier's high", () => {
  const r = resolveRoleModels({ ai_model_tier: "opus", ai_model_tier_prose: "not-a-tier" as unknown as never });
  assertEquals(r.prose, "claude-opus-4-8");
});

Deno.test("a per-role override wins over the base even when the base is set", () => {
  const r = resolveRoleModels({ ai_model_tier: "opus", ai_model_tier_agent: "sonnet" });
  assertEquals(r.agent, "claude-sonnet-4-6");
  assertEquals(r.structure, "claude-opus-4-8");
});

Deno.test("ai_model_tier_agent=claude-local sends only the agent role to the local claude -p bridge", () => {
  // "claude-local" is a sentinel, not a real model id — llm.ts routes it to CLAUDE_LOCAL_URL. It isn't in
  // TOOL_INCAPABLE_MODELS, so the agent-role tool fence (see the hermes tests above) must pass it through
  // unchanged rather than falling back to the base tier's high.
  const r = resolveRoleModels({ ai_model_tier: "sonnet", ai_model_tier_agent: "claude-local" });
  assertEquals(r.agent, "claude-local");
  assertEquals(r.structure, "claude-sonnet-4-6"); // unaffected — only the agent role rides the bridge
  assertEquals(r.prose, "claude-sonnet-4-6");
});

// localBridgeUp: the CLAUDE_LOCAL_URL-is-set signal getRoleModels() passes in. It's a DEFAULT for every high
// role (agent, structure, prose), never a mandate — see resolveRoleModels' doc comment. These pin that
// precedence and its blast radius.

Deno.test("localBridgeUp=true with no overrides defaults the whole high tier to claude-local", () => {
  const r = resolveRoleModels({ ai_model_tier: "sonnet" }, true);
  assertEquals(r.agent, "claude-local");
  assertEquals(r.structure, "claude-local"); // structure (e.g. scene sketch) rides the shim too now
  assertEquals(r.prose, "claude-local");
  assertEquals(r.low, "claude-haiku-4-5-20251001"); // low tier is unaffected — only high roles ride the bridge
});

Deno.test("localBridgeUp=false (the deployed/no-shim case) never defaults to claude-local", () => {
  const r = resolveRoleModels({ ai_model_tier: "sonnet" }, false);
  assertEquals(r.agent, "claude-sonnet-4-6");
  assertEquals(r.structure, "claude-sonnet-4-6");
  assertEquals(r.prose, "claude-sonnet-4-6");
});

Deno.test("an explicit ai_model_tier_agent override wins over localBridgeUp — a deliberate local choice is never clobbered", () => {
  const r = resolveRoleModels({ ai_model_tier: "sonnet", ai_model_tier_agent: "hermes" }, true);
  // hermes is tool-incapable, so the usual tool fence applies on top of the explicit override — the point
  // here is that localBridgeUp did NOT silently substitute claude-local for the admin's explicit pick.
  assertEquals(r.agent, "claude-sonnet-4-6"); // fenced to the tool-capable base, not claude-local
  assertEquals(r.structure, "claude-local"); // structure had no override, so it still defaults to the shim
});

Deno.test("an explicit per-role override wins over localBridgeUp for structure/prose too", () => {
  const r = resolveRoleModels({ ai_model_tier: "opus", ai_model_tier_structure: "sonnet" }, true);
  assertEquals(r.structure, "claude-sonnet-4-6"); // explicit override stands
  assertEquals(r.prose, "claude-local");          // no prose override → defaults to the shim
  assertEquals(r.agent, "claude-local");          // no agent override → defaults to the shim
});
