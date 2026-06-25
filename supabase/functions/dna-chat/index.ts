// dna-chat — the per-STAGE conversational reviser for the Novel DNA journey (the third studio pillar).
// One thread per (book, stage). The author talks to a story editor scoped to that resolution; it holds the
// stage's nodes + the journey context, and may PROPOSE a structured change to the tree (node ops) that the
// author reviews before applying. Mirrors revise-chat, but over book_nodes. See docs/novel-dna-spec.md.
//
//   client → POST { bookId, stage, message } → append user msg → model → append reply + any proposal → save
//
// The edge fn is the single writer of the dna_chats row; the client watches it over Realtime (refresh = no-op).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { callClaude, textFromClaude, type CallMeta } from "../_shared/claude.ts";
import { getActiveModels } from "../_shared/model-config.ts";
import { extractJsonBlock } from "../_shared/json.ts";
import { type Brief, briefContext, mandateContext } from "../_shared/brief.ts";

type Stage = "premise" | "foundations" | "structure" | "scenes" | "draft";
interface Node { id: string; parent_id: string | null; kind: string; level: number; content: Record<string, unknown>; authoring: { locked?: boolean; status?: string } }
interface ChatMessage { role: "user" | "assistant"; text: string; ts: string; plan?: string }

const STAGE_KINDS: Record<Stage, string[]> = {
  premise: ["seed", "premise"],
  foundations: ["pillar", "character", "relationship", "tentpole", "world_fact", "voice_profile"],
  structure: ["movement", "beat", "thread"],
  scenes: ["scene"],
  draft: ["scene"],
};
const STAGE_GUIDE: Record<Stage, string> = {
  premise: "the PREMISE — the logline, genre, tone, dramatic question, and the 5-part shape. Sharpen the question and the turns; keep it one true idea.",
  foundations: "the FOUNDATIONS — the controlling idea, the ending, and the CAST (each character's want/need/wound/lie/truth/idiolect), world rules, tentpole set-pieces, and relationships. The wound + lie are the human core. Pressure-test them; deepen, don't generic-ify.",
  structure: "the STRUCTURE — the acts (movements) and their causal beats. Hunt sagging middles, weak turning points, 'and-then' beats; every beat should connect with therefore/but.",
  scenes: "the SCENES — each scene's pov/goal/conflict/outcome and its VALUE SHIFT. Every scene must turn a value; fix flat scenes; check order and escalation.",
  draft: "the DRAFT — the prose of each scene. Voice, heat (per the mandate), pacing, line-level craft. Edit a scene's prose under content.prose.text.",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const userClient = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const { bookId, stage, message, analysis } = (await req.json().catch(() => ({}))) as { bookId?: number; stage?: Stage; message?: string; analysis?: string };
    if (!bookId || !stage || !STAGE_KINDS[stage]) return json({ error: "bookId, a valid stage, and message are required" }, 400);
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);

    const [{ data: book }, { data: nodeRows }, { data: existing }] = await Promise.all([
      userClient.from("books").select("name, brief").eq("id", bookId).maybeSingle(),
      userClient.from("book_nodes").select("id, parent_id, kind, level, content, authoring").eq("book_id", bookId),
      userClient.from("dna_chats").select("messages, pending_proposal").eq("book_id", bookId).eq("stage", stage).maybeSingle(),
    ]);
    const nodes = (nodeRows as Node[] | null) ?? [];
    const prior: ChatMessage[] = Array.isArray(existing?.messages) ? existing!.messages as ChatMessage[] : [];
    const withUser: ChatMessage[] = [...prior, { role: "user", text: (message ?? "").trim(), ts: new Date().toISOString() }];
    await userClient.from("dna_chats").upsert({ book_id: bookId, stage, messages: withUser, status: "thinking", error: null }, { onConflict: "book_id,stage" });

    const brief = book?.brief as Brief | null;
    const mandate = mandateContext(brief);
    // The rail holds the WHOLE tree (premise → scenes) and may edit ANY non-locked node — the stage names the
    // editor's FOCUS, not its reach. Prose is heavy: include scene prose only on the draft stage (its concern),
    // strip it elsewhere to keep the context lean.
    const withProse = stage === "draft";
    const serialize = (n: Node): string => {
      let content = n.content;
      if (!withProse && n.kind === "scene" && content && typeof content === "object" && "prose" in content) {
        const { prose: _drop, ...rest } = content as Record<string, unknown>;
        content = rest;
      }
      return `[${n.id}${n.authoring?.locked ? " · LOCKED" : ""}] L${n.level} ${n.kind}: ${JSON.stringify(content)}`;
    };
    const tree = [...nodes].sort((a, b) => a.level - b.level).map(serialize).join("\n");
    const system = `You are a sharp, warm developmental STORY EDITOR in conversation with an author. Your current FOCUS is ${STAGE_GUIDE[stage]}

You hold the book's ENTIRE DNA tree — premise → foundations → structure → scenes${withProse ? " → prose" : ""} — and you may edit, add, or delete ANY non-locked node at ANY level, not just your focus stage. The focus names what the author is working on, not a fence around what you can touch.${withProse ? " Scene PROSE is included here (content.prose.text); you may rewrite it." : ""}

Reply to the author in plain MARKDOWN prose — discuss, pressure-test, answer. If — and ONLY if — this message DELIVERS a concrete change to apply, append at the VERY END a single fenced \`\`\`json block (nothing after it) with node operations over the REAL node ids given:
{ "summary": "<one line: what changes>",
  "ops": [
    { "op": "edit", "id": "<existing node id>", "content": { <fields to merge> } },
    { "op": "add", "kind": "<character|world_fact|relationship|tentpole|thread|movement|beat|scene>", "parentId": "<existing node id>", "content": { … } },
    { "op": "delete", "id": "<existing node id>" },
    { "op": "replace_children", "parentId": "<parent id, e.g. the pillar>", "childKind": "movement", "children": [ { "content": { …movement… }, "children": [ { "content": { …beat… } } ] } ] }
  ] }
Only reference ids that exist. Honor LOCKED nodes (never edit/delete them). Don't propose unless the author asked for a change or agreed to one — talk first.
To REBUILD a whole level (replace all acts, or all beats under an act), use ONE replace_children op — it deletes the existing non-locked children of childKind first, so the rebuild replaces instead of duplicating. Children nest down the ladder (movement→beat→scene). Use "add" only to APPEND a single node.

CONTENT FIELD SCHEMAS — use EXACTLY these key names (wrong keys silently orphan data):
- premise  → content.shape keys: setup | turn1 | turn2 | turn3 | resolution  (never "midpoint", never "climax")
- movement → content: { title, goal, turning_point, target_pct, value: { from, to } }
- beat     → content: { summary, connector ("therefore"|"but"), polarity ("up"|"down"), threads, grounds_in, needs, establishes, realizes, plays, resolves }
- scene    → content: { goal, conflict, outcome, pov, value: { from, to }, prose: { text } }
- character → content: { name, want, need, wound, lie, truth, idiolect, role }
- relationship → content: { a, b, dynamic, arc }
- tentpole → content: { title, summary, when }
- world_fact → content: { name, rule, mechanism }
- thread   → content: { name, promise, payoff, kind ("mystery"|"foreshadow"|"setup_payoff"|"arc") }`;

    const ctx = [
      `BOOK: ${book?.name ?? ""}`,
      `BRIEF (binding): ${briefContext(brief, { scope: "full", success: true, none: "(no brief)", empty: "(empty)" })}`,
      mandate ? `MANDATE — NON-NEGOTIABLE: ${mandate}` : "",
      // The three-axis story analysis (computed client-side from the live tree) — so the editor can act on
      // pacing drift, dangling promises, and sagging runs rather than eyeballing them.
      analysis?.trim() ? `STORY ANALYSIS (the structural backstop — address any ⚠ flags):\n${analysis.trim()}` : "",
      `THE DNA TREE (edit/add/delete by these ids; LOCKED = immutable):\n${tree || "(none yet)"}`,
    ].filter(Boolean).join("\n\n");

    const { high: model } = await getActiveModels();
    const meta: CallMeta = { fn: "dna-chat", bookId, userId: user.id };
    const history = withUser.slice(-12).map((m) => ({ role: m.role, content: m.text }));
    const data = await callClaude(apiKey, {
      model, max_tokens: 3000,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: `${ctx}\n\n— The conversation so far is below; respond to the latest message.` }, ...history],
    }, meta);

    const full = textFromClaude(data).trim();
    let reply = full, proposal: { summary: string; ops: unknown[] } | null = null;
    const fence = full.match(/```json\s*([\s\S]*?)```\s*$/);
    if (fence) {
      try {
        const parsed = JSON.parse(extractJsonBlock(fence[1]));
        const ids = new Set(nodes.map((n) => n.id));
        const locked = new Set(nodes.filter((n) => n.authoring?.locked).map((n) => n.id));
        const VALID_KINDS = new Set(["seed","premise","pillar","movement","beat","scene","character","relationship","tentpole","world_fact","thread","game","voice_profile"]);
        const ops = (Array.isArray(parsed.ops) ? parsed.ops : []).filter((o: { op?: string; id?: string; parentId?: string; kind?: string; childKind?: string; children?: unknown[] }) =>
          (o.op === "edit" && o.id && ids.has(o.id) && !locked.has(o.id)) ||
          (o.op === "delete" && o.id && ids.has(o.id) && !locked.has(o.id)) ||
          (o.op === "add" && o.parentId && ids.has(o.parentId) && o.kind && VALID_KINDS.has(o.kind)) ||
          (o.op === "replace_children" && o.parentId && ids.has(o.parentId) && !locked.has(o.parentId) && o.childKind && VALID_KINDS.has(o.childKind) && Array.isArray(o.children) && o.children.length > 0));
        if (ops.length) { proposal = { summary: String(parsed.summary ?? "Proposed change").trim(), ops }; reply = full.slice(0, fence.index).trim(); }
      } catch { /* keep the prose, drop the malformed block */ }
    }

    const assistant: ChatMessage = { role: "assistant", text: reply, ts: new Date().toISOString(), plan: proposal?.summary };
    await userClient.from("dna_chats").update({
      messages: [...withUser, assistant], pending_proposal: proposal ?? existing?.pending_proposal ?? null, status: "idle",
    }).eq("book_id", bookId).eq("stage", stage);

    return json({ reply, proposal });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e).slice(0, 500) }, 500);
  }
});
