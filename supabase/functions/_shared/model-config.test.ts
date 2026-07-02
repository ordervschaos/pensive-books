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

Deno.test("an unknown override tier falls back to the base tier's high", () => {
  const r = resolveRoleModels({ ai_model_tier: "opus", ai_model_tier_prose: "not-a-tier" as unknown as never });
  assertEquals(r.prose, "claude-opus-4-8");
});

Deno.test("a per-role override wins over the base even when the base is set", () => {
  const r = resolveRoleModels({ ai_model_tier: "opus", ai_model_tier_agent: "sonnet" });
  assertEquals(r.agent, "claude-sonnet-4-6");
  assertEquals(r.structure, "claude-opus-4-8");
});
