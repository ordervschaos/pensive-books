// read-facts — the continuity-ledger pass of the verify loop (docs/true-agent.md Step 3).
//
// Per scene, against the "story so far" canon the client folded from prior scenes: (1) EXTRACT the durable
// facts this scene's prose asserts or changes (key→value), and (2) FLAG anything the prose CONTRADICTS in the
// canon. Stateless (like read-meters / dna-chat): the client owns the tree, folds ledgerIn, writes the
// result onto the scene as observed_establishes + continuity_flags. Sequential over scenes = the prefix-sum.
//
//   client → POST { bookId, ledgerIn:[{key,value}], scene:{id,summary,prose} }
//          → one Claude call → { facts:[{key,value,note}], contradictions:[{key,was,now,note}] }
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { callLLM, textFromLLM, type CallMeta } from "../_shared/llm.ts";
import { getActiveModels } from "../_shared/model-config.ts";
import { extractJsonBlock } from "../_shared/json.ts";

// entity (Phase-1 grounding, docs/scene-ledger.md §1.3): the registry node id this fact is ABOUT, when it
// concerns a known entity. Validated server-side against the ids the client actually sent (below).
interface Fact { key: string; value: string; note?: string; entity?: string }
interface ReadScene { id: string; summary?: string; prose: string }
const MAX_PROSE_CHARS = 8000;   // one scene's prose; the ledger keeps the rest of the context bounded
const MAX_LEDGER = 200;         // cap the canon fed in (compaction is a fast-follow; guard the prompt size)

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const userClient = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const { bookId, ledgerIn, scene, entities } = (await req.json().catch(() => ({}))) as {
      bookId?: number; ledgerIn?: Fact[]; scene?: ReadScene; entities?: string;
    };
    if (!bookId || !scene?.id || !scene.prose?.trim()) {
      return json({ error: "bookId and a scene with prose are required" }, 400);
    }
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);

    const { data: book } = await userClient.from("books").select("id").eq("id", bookId).maybeSingle();
    if (!book) return json({ error: "Book not found or access denied" }, 403);

    const canon = (Array.isArray(ledgerIn) ? ledgerIn : []).slice(0, MAX_LEDGER)
      .map((f) => `- ${f.key}: ${f.value}`).join("\n") || "(nothing established yet — this is the opening)";

    // The entity registry the client folded from the tree (entityRegistryBlock). Grounding is ADDITIVE and
    // stateless: we validate any `entity` the model emits against exactly the ids present in this block — an
    // unknown id is dropped and the fact kept (grounding degrades to today's behaviour, never below it).
    const registry = (entities ?? "").trim();
    const registryIds = new Set((registry.match(/n_[a-z0-9]+/gi) ?? []));
    const registryBlock = registry
      ? `ENTITY REGISTRY — the canonical cast/places/rules, with ids. When a fact is ABOUT one of these, set ` +
        `"entity" to its id and reuse a consistent key. Resolve names, titles, epithets, and pronouns to registry ` +
        `entries; do NOT mint a parallel entry for a new way of referring to a known entity:\n${registry}\n\n`
      : "";

    const { high: model } = await getActiveModels();
    const meta: CallMeta = { fn: "read-facts", bookId, taskTable: "book_nodes", taskId: bookId };
    const data = await callLLM(apiKey, {
      model,
      max_tokens: 2000,
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      system: [{
        type: "text",
        text:
          "You maintain a story's continuity ledger. Given the CANON established so far (key→value facts) and " +
          "the NEW scene's prose, do two things: (1) EXTRACT the durable, trackable facts this scene asserts or " +
          "changes — concise snake_case key + a short value (identities, roles, relationships, possessions, " +
          "locations, physical/world facts). Reuse an existing canon key when the scene UPDATES it (that " +
          "supersedes the old value); omit facts already in the canon and unchanged. Skip transient mood. " +
          "(2) FLAG contradictions: any fact in the prose that conflicts with a canon value (was → now). A " +
          "deliberate, narrated change is NOT a contradiction — only an unintended conflict is.",
      }],
      messages: [{
        role: "user",
        content:
          registryBlock +
          `CANON (story so far):\n${canon}\n\n` +
          `NEW SCENE${scene.summary ? ` ("${scene.summary}")` : ""} — prose:\n${scene.prose.slice(0, MAX_PROSE_CHARS)}\n\n` +
          `Output ONLY this JSON (no prose, no fences):\n` +
          `{ "facts": [ { "key": "<snake_case>", "value": "<short>", "note": "<optional>", "entity": "<a registry id when the fact is about one, else omit>" } ], ` +
          `"contradictions": [ { "key": "<canon key>", "was": "<canon value>", "now": "<what the prose says>", "note": "<optional>" } ] }`,
      }],
    }, meta, { signal: AbortSignal.timeout(90_000) });

    const parsed = JSON.parse(extractJsonBlock(textFromLLM(data).trim())) as { facts?: unknown; contradictions?: unknown };
    const facts = (Array.isArray(parsed.facts) ? parsed.facts : []).filter(
      (f): f is Fact => !!f && typeof (f as Fact).key === "string" && typeof (f as Fact).value === "string"
    ).map((f) => ({
      key: f.key, value: f.value,
      ...(f.note ? { note: f.note } : {}),
      // Keep `entity` only when it resolves to an id actually sent — a hallucinated/garbled ref is dropped, the fact stays.
      ...(f.entity && registryIds.has(f.entity) ? { entity: f.entity } : {}),
    }));
    const contradictions = (Array.isArray(parsed.contradictions) ? parsed.contradictions : []).filter(
      (c): c is { key: string; was: string; now: string; note?: string } =>
        !!c && typeof (c as { key: unknown }).key === "string" && typeof (c as { was: unknown }).was === "string" && typeof (c as { now: unknown }).now === "string"
    ).map((c) => ({ key: c.key, was: c.was, now: c.now, ...(c.note ? { note: c.note } : {}) }));

    return json({ facts, contradictions });
  } catch (e) {
    console.error("read-facts error:", e);
    return json({ error: String((e as Error)?.message ?? e).slice(0, 500) }, 500);
  }
});
