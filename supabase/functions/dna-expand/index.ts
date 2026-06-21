// dna-expand — Phase 5: the "expand" verb for the Novel DNA tree. Generates a node's next rung as ONE
// authoritative version (NOT 2–3 proposals to choose among): the AI fills the structure, the author then
// edits / regenerates / locks. See docs/novel-dna-schema.md + novel-dna-spec.md §6.
//
//   client → POST { bookId, nodeId } → load node + ancestors + mandate → Claude → { children } | { prose }
//
// Locked ancestors are hard constraints; accepted siblings give local coherence. Scene → prose fills the
// scene's own text. Needs ANTHROPIC_API_KEY. The bridge (scripts/eval-bridge.mjs) mirrors this for dev.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { callClaude, textFromClaude, type CallMeta } from "../_shared/claude.ts";
import { getActiveModels } from "../_shared/model-config.ts";
import { extractJsonBlock } from "../_shared/json.ts";
import { type Brief, briefContext, mandateContext } from "../_shared/brief.ts";

interface Node { id: string; parent_id: string | null; kind: string; content: Record<string, unknown>; authoring: { locked?: boolean; status?: string } }

// What each TARGET expands into. One authoritative set; never alternatives. Keyed by target (a node can
// have several — a pillar generates cast, world, AND acts), so the client passes which to generate.
const SPEC: Record<string, { from: string; childKind: string; childLevel: number; count: string; schema: string; role: string }> = {
  premise: { from: "seed", childKind: "premise", childLevel: 1, count: "exactly 1",
    role: "the PREMISE — genre, tone, the dramatic question, and a 5-part shape (setup → three turns → resolution)",
    schema: `{ "genre": ["..."], "tone": ["..."], "dramatic_question": "...", "shape": { "setup": "...", "turn1": "...", "turn2": "...", "turn3": "...", "resolution": "..." } }` },
  pillar: { from: "premise", childKind: "pillar", childLevel: 2, count: "exactly 1",
    role: "the PILLAR — the controlling idea the book proves and the ending it must reach",
    schema: `{ "controlling_idea": "...", "ending": "..." }` },
  cast: { from: "pillar", childKind: "character", childLevel: 2, count: "3 to 5",
    role: "the CAST — a protagonist plus key opposition/allies; each gets a want, need, wound, lie, truth, idiolect",
    schema: `{ "name": "...", "role": "protagonist|antagonist|ally|love_interest|minor", "want": "...", "need": "...", "wound": "...", "lie": "...", "truth": "...", "idiolect": "..." }` },
  world: { from: "pillar", childKind: "world_fact", childLevel: 2, count: "3 to 6",
    role: "the WORLD — the load-bearing rules and facts that constrain the story",
    schema: `{ "rule": "...", "category": "..." }` },
  movements: { from: "pillar", childKind: "movement", childLevel: 3, count: "3 to 5", role: "the ACTS — each a major movement with a turning point and a value shift",
    schema: `{ "title": "...", "goal": "...", "turning_point": "...", "value": { "name": "...", "from": "...", "to": "..." } }` },
  beats: { from: "movement", childKind: "beat", childLevel: 4, count: "2 to 4", role: "the causal BEATS inside this act; each links to the previous with therefore or but, escalating",
    schema: `{ "summary": "...", "connector": "therefore" | "but" }` },
  scenes: { from: "beat", childKind: "scene", childLevel: 5, count: "1 to 3", role: "the dramatized SCENES that deliver this beat; EVERY scene must turn a value (no flat 'and-then')",
    schema: `{ "loc": "...", "goal": "...", "conflict": "...", "outcome": "...", "value_shift": { "value": "...", "from": "...", "to": "..." } }` },
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const userClient = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const { bookId, nodeId, target } = (await req.json().catch(() => ({}))) as { bookId?: number; nodeId?: string; target?: string };
    if (!bookId || !nodeId) return json({ error: "bookId and nodeId are required" }, 400);
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);

    const { data: book } = await userClient.from("books").select("name, brief, foundations").eq("id", bookId).maybeSingle();
    const { data: nodeRows } = await userClient.from("book_nodes").select("id, parent_id, kind, content, authoring").eq("book_id", bookId);
    const nodes = (nodeRows as Node[] | null) ?? [];
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return json({ error: "Node not found" }, 404);

    const brief = book?.brief as Brief | null;
    const mandate = mandateContext(brief);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    // Ancestor chain (root → parent), locked ones flagged as hard constraints.
    const chain: Node[] = [];
    for (let p = node.parent_id; p; p = byId.get(p)?.parent_id ?? null) { const a = byId.get(p); if (a) chain.unshift(a); }
    const ctx = [
      `BOOK: ${book?.name ?? ""}`,
      `BRIEF (binding):\n${briefContext(brief, { scope: "full", success: true, none: "(no brief)", empty: "(empty)" })}`,
      mandate ? `MANDATE — NON-NEGOTIABLE:\n${mandate}` : "",
      "STORY SO FAR (the ladder above this node; LOCKED items are immutable):",
      ...chain.map((a) => `[${a.kind}${a.authoring?.locked ? " · LOCKED" : ""}] ${JSON.stringify(a.content)}`),
      `THIS NODE [${node.kind}]: ${JSON.stringify(node.content)}`,
    ].filter(Boolean).join("\n\n");

    const { high: model } = await getActiveModels();
    const meta: CallMeta = { fn: "dna-expand", bookId, userId: user.id };

    if (target === "prose" || (!target && node.kind === "scene")) {
      // Scene → prose: fill the scene's own text. One true draft, in voice.
      const system = `You are a novelist writing the PROSE for one scene, from its plan. Write the scene fully — vivid, causal, in the book's voice — honoring the MANDATE (heat/tone/length) without laundering. Output the prose ONLY: no preamble, no headings, no JSON.`;
      const data = await callClaude(apiKey, { model, max_tokens: 4000, system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: `${ctx}\n\nWrite this scene's prose.` }] }, meta);
      return json({ prose: textFromClaude(data).trim() });
    }

    const spec = target ? SPEC[target] : undefined;
    if (!spec) return json({ error: `Unknown expand target "${target}"` }, 400);
    const system = `You are a story architect expanding a ${node.kind} into ${spec.role}. Generate ${spec.count} ${spec.childKind}s as ONE authoritative structure — NOT alternatives to choose among. Honor every LOCKED ancestor and the MANDATE verbatim. Output JSON ONLY: { "children": [ ${spec.schema} ] }`;
    const data = await callClaude(apiKey, { model, max_tokens: 4000, system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: `${ctx}\n\nGenerate the ${spec.childKind}s. JSON only.` }] }, meta);
    const parsed = JSON.parse(extractJsonBlock(textFromClaude(data)));
    const children = Array.isArray(parsed.children) ? parsed.children : [];
    return json({ childKind: spec.childKind, childLevel: spec.childLevel, children });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e).slice(0, 500) }, 500);
  }
});
