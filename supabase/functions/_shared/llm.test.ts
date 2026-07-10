import { assertEquals } from "jsr:@std/assert@1";
import { resolveRoute, wireModelFor } from "./llm.ts";

// resolveRoute is the provider-routing table: (model, admin preference, which keys exist) → the host that
// runs the call. The invariant that matters is that a preference NEVER breaks a model the provider can't
// serve — it falls back to the model's native host.

const allKeys = () => true;
const noKeys = () => false;
const keysExcept = (missing: string) => (env: string) => env !== missing;

Deno.test("auto → historical behaviour: slashed ids go to MuleRouter when its key is set", () => {
  const r = resolveRoute("deepseek/deepseek-v4-pro", "auto", allKeys);
  assertEquals(r.provider, "mulerouter");
  assertEquals(r.model, "deepseek-v4-pro"); // MuleRouter takes bare ids
});

Deno.test("auto → OpenRouter when the MuleRouter key is absent", () => {
  const r = resolveRoute("deepseek/deepseek-v4-pro", "auto", keysExcept("MULE_ROUTER_API_KEY"));
  assertEquals(r.provider, "openrouter");
  assertEquals(r.model, "deepseek/deepseek-v4-pro"); // OpenRouter keeps the vendor prefix
});

Deno.test("auto → OpenRouter for a model MuleRouter doesn't carry, even with its key set", () => {
  const r = resolveRoute("qwen/qwen3-235b-a22b", "auto", allKeys);
  assertEquals(r.provider, "openrouter");
});

Deno.test("auto → Anthropic for bare claude ids, DeepSeek for bare deepseek ids", () => {
  assertEquals(resolveRoute("claude-opus-4-8", "auto", allKeys).provider, "anthropic");
  assertEquals(resolveRoute("deepseek-chat", "auto", allKeys).provider, "deepseek");
});

Deno.test("pref deepseek → the v4 tier routes to DeepSeek's own API with bare ids", () => {
  const r = resolveRoute("deepseek/deepseek-v4-pro", "deepseek", allKeys);
  assertEquals(r.provider, "deepseek");
  assertEquals(r.model, "deepseek-v4-pro");
  assertEquals(r.url, "https://api.deepseek.com/v1/chat/completions");
});

Deno.test("pref deepseek does NOT break models DeepSeek can't serve — they fall back to their native host", () => {
  // This is the fallback invariant. The pinned digest/image models (qwen) and any Anthropic tier must keep
  // working while the global switch says "deepseek", or flipping the switch takes the whole app down.
  assertEquals(resolveRoute("qwen/qwen3-235b-a22b", "deepseek", allKeys).provider, "openrouter");
  assertEquals(resolveRoute("qwen/qwen3.7-plus", "deepseek", allKeys).provider, "mulerouter");
  assertEquals(resolveRoute("claude-sonnet-4-6", "deepseek", allKeys).provider, "anthropic");
});

Deno.test("pref anthropic does NOT drag OpenRouter-only models onto Anthropic", () => {
  // claude-* has no slash so Anthropic serves it; qwen/* has no unprefixed Anthropic form, so it stays put.
  assertEquals(resolveRoute("qwen/qwen3-8b", "anthropic", allKeys).provider, "openrouter");
  assertEquals(resolveRoute("claude-opus-4-8", "anthropic", allKeys).provider, "anthropic");
});

Deno.test("pref openrouter overrides the MuleRouter takeover", () => {
  const r = resolveRoute("deepseek/deepseek-v4-pro", "openrouter", allKeys);
  assertEquals(r.provider, "openrouter");
  assertEquals(r.model, "deepseek/deepseek-v4-pro");
});

Deno.test("pref mulerouter can serve a bare deepseek id (which auto would send to DeepSeek)", () => {
  assertEquals(resolveRoute("deepseek-v4-pro", "auto", allKeys).provider, "deepseek");
  assertEquals(resolveRoute("deepseek-v4-pro", "mulerouter", allKeys).provider, "mulerouter");
});

Deno.test("a preferred provider whose key is missing is skipped, not used", () => {
  const r = resolveRoute("deepseek/deepseek-v4-pro", "deepseek", keysExcept("DEEPSEEK_API_KEY"));
  assertEquals(r.provider, "mulerouter"); // next in the model's native order
});

Deno.test("no keys at all → still a real request to the native host, so the error is that host's 401", () => {
  assertEquals(resolveRoute("deepseek/deepseek-v4-pro", "deepseek", noKeys).provider, "deepseek");
  assertEquals(resolveRoute("qwen/qwen3-8b", "auto", noKeys).provider, "openrouter");
  assertEquals(resolveRoute("claude-opus-4-8", "auto", noKeys).provider, "anthropic");
});

Deno.test("wireModelFor is the capability half: null means 'this host cannot run this model'", () => {
  assertEquals(wireModelFor("anthropic", "qwen/qwen3-8b"), null);
  assertEquals(wireModelFor("anthropic", "deepseek-chat"), null);
  assertEquals(wireModelFor("openrouter", "claude-opus-4-8"), null);
  assertEquals(wireModelFor("deepseek", "qwen/qwen3-8b"), null);
  assertEquals(wireModelFor("mulerouter", "qwen/qwen3-235b-a22b"), null);
  assertEquals(wireModelFor("mulerouter", "qwen/qwen3.7-plus"), "qwen3.7-plus");
});
