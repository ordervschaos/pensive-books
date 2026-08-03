// book-agent tool execution: run a turn's non-terminal tool calls (read_node / search_nodes /
// get_schema / read_skill / check_against_contract / update_vision / audit_vision / research_web) and
// return their tool_result blocks.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { type Brief, type BriefVision, VISION_SECTIONS } from "../_shared/brief.ts";
import { getRoleModels } from "../_shared/model-config.ts";
import { AGENT_SKILLS } from "../_shared/agent-skills.ts";
import { type DnaNode, type SceneContent, buildShapeReadInput, chapters, entityRegistryBlock, hasOwnContent, ledgerBefore, liveNodes } from "../_shared/novel-dna.ts";
import { judgeProse } from "../_shared/mandate-gate.ts";
import { callLLM, textFromLLM } from "../_shared/llm.ts";
import { extractJsonBlock } from "../_shared/json.ts";
import { renderResearch, researchCraft } from "../_shared/research.ts";
import { VISION_RUBRIC } from "../_shared/vision-craft.ts";
import { nodeHandle, schemaFor, SCHEMA_BY_KIND, type AgentStep } from "./shared.ts";
import { planConformanceSummary } from "./verify.ts";

// Execute a turn's non-terminal tool calls (read_node/get_schema/search_nodes/check_against_contract;
// unknown tools get an error result) and return the tool_result blocks, in tool order. `overrides` injects
// a prebuilt result for a given tool_use id. Independent calls FAN OUT concurrently (Promise.all) — the
// system prompt tells the model its reads run in parallel, so a batched turn must not pay for them serially
// (check_against_contract is an LLM judge call; two of them back-to-back used to double a turn's wall
// clock). Steps append in tool order AFTER the fan-out, so the visible feed stays deterministic.
// deno-lint-ignore no-explicit-any
async function toolResults(
  service: SupabaseClient,
  bookId: number,
  // deno-lint-ignore no-explicit-any
  toolUses: any[],
  steps: AgentStep[],
  overrides: Record<string, string> = {},
  _auto = false,
): Promise<unknown[]> {
  const outs = await Promise.all(toolUses.map((t) => execTool(service, bookId, t, overrides)));
  for (const o of outs) if (o.step) steps.push(o.step);
  return outs.map((o) => o.result);
}

// One tool call → its tool_result block (+ the feed step it should log, if any). Must never throw:
// every failure path returns an is_error result the model can react to.
// deno-lint-ignore no-explicit-any
async function execTool(
  service: SupabaseClient,
  bookId: number,
  // deno-lint-ignore no-explicit-any
  t: any,
  overrides: Record<string, string>,
): Promise<{ result: unknown; step?: AgentStep }> {
  if (overrides[t.id] != null) {
    return { result: { type: "tool_result", tool_use_id: t.id, content: overrides[t.id], is_error: true } };
  }
  if (t.name === "read_node") {
    const id = String((t.input as { id?: string })?.id ?? "");
    // The node in full, PLUS its position: ancestor path (what an edit must honor as fixed) and
    // children one level down (what an edit stales) — a read hands back everything an edit needs
    // except the craft (which rides as a skill). One whole-book minimal fetch serves both.
    const [{ data: node }, { data: all }] = await Promise.all([
      service.from("book_nodes").select("id, kind, content, authoring, book_id, parent_id").eq("id", id).maybeSingle(),
      service.from("book_nodes").select("id, parent_id, kind, position, content").eq("book_id", bookId),
    ]);
    if (!node || (node as { book_id?: number }).book_id !== bookId) {
      return { result: { type: "tool_result", tool_use_id: t.id, content: `No node with id ${id} in this book.`, is_error: true } };
    }
    const n = node as { id: string; kind: string; content: Record<string, unknown>; authoring: { locked?: boolean }; parent_id: string | null };
    const rows = (all ?? []) as { id: string; parent_id: string | null; kind: string; position: number; content: Record<string, unknown> | null }[];
    const rowById = new Map(rows.map((r) => [r.id, r]));
    const kids = rows.filter((r) => r.parent_id === id).sort((a, b) => a.position - b.position);
    const parts: string[] = [n.kind];
    for (let cur = n.parent_id ? rowById.get(n.parent_id) : undefined; cur; cur = cur.parent_id ? rowById.get(cur.parent_id) : undefined) {
      parts.unshift(`${cur.kind} “${nodeHandle(cur.content)}”`);
      if (parts.length > 10) break; // cycle guard
    }
    // NOT filtered (doc_1785673597000.md §5a class 3): read_node is how the agent inspects a slot it is
    // about to fill, so a placeholder must resolve. Only the LABEL changes — an empty child says so plainly
    // instead of trailing a blank handle the model would read as a nameless node.
    const childLines = kids.map((k) => `  - [${k.id}] ${k.kind}: ${hasOwnContent(k) ? nodeHandle(k.content) : "(empty — nothing written here yet)"}`).join("\n");
    const schema = schemaFor([n.kind]); // hand back the kind's field schema so an edit uses the right keys
    return {
      step: { t: "read", label: `Read ${n.kind} “${nodeHandle(n.content)}” in full.` },
      result: {
        type: "tool_result", tool_use_id: t.id,
        content: `[${n.id}${n.authoring?.locked ? " · LOCKED" : ""}] ${n.kind}\npath: ${parts.join(" › ")}\n${JSON.stringify(n.content)}` + (childLines ? `\nchildren (an edit here STALES them):\n${childLines}` : "") + (schema ? `\n\n${schema}` : ""),
      },
    };
  }
  // The interview's ONLY write (docs/agent-guidance-system.md D2): a DIRECT, non-terminal write of the
  // author's own words into books.brief.vision. Direct on purpose — a proposal card would make the author
  // review their own answers back. Shallow per-section merge: only the keys present in the call change.
  if (t.name === "update_vision") {
    const input = (t.input ?? {}) as Record<string, unknown>;
    const { data: book, error: readErr } = await service.from("books").select("brief").eq("id", bookId).maybeSingle();
    if (readErr) {
      return { result: { type: "tool_result", tool_use_id: t.id, content: `Couldn't read the brief: ${readErr.message}`, is_error: true } };
    }
    const brief = ((book as { brief?: Brief } | null)?.brief ?? {}) as Brief;
    const vision: BriefVision = { ...(brief.vision ?? {}) };
    const touched: string[] = [];
    for (const [key, label] of VISION_SECTIONS) {
      const v = input[key];
      if (typeof v !== "string" || !v.trim()) continue; // absent OR blanked → leave that section alone
      vision[key] = v.trim();
      touched.push(label);
    }
    const compiled = input.compiled === true;
    if (compiled) vision.compiled_at = new Date().toISOString();
    if (!touched.length && !compiled) {
      return { result: { type: "tool_result", tool_use_id: t.id, content: "Nothing to update — pass at least one non-empty section (or compiled: true).", is_error: true } };
    }
    const { error } = await service.from("books").update({ brief: { ...brief, vision } }).eq("id", bookId);
    if (error) {
      return { result: { type: "tool_result", tool_use_id: t.id, content: `Couldn't save the vision: ${error.message}`, is_error: true } };
    }
    const what = touched.length ? touched.join(", ") : "the interview";
    return {
      step: { t: "read", label: compiled ? `Compiled the vision${touched.length ? ` (${what})` : ""} — the interview is done.` : `Captured the vision: ${what}.` },
      result: {
        type: "tool_result", tool_use_id: t.id,
        content: `ok — vision updated (sections: ${what})` + (compiled ? ". The interview is now marked complete; the journey advances to the seed on its own." : ""),
      },
    };
  }
  if (t.name === "read_skill") {
    const name = String((t.input as { name?: string })?.name ?? "").trim();
    const skill = AGENT_SKILLS.find((s) => s.name === name);
    if (!skill) {
      return { result: { type: "tool_result", tool_use_id: t.id, content: `No skill named "${name}". Available: ${AGENT_SKILLS.map((s) => s.name).join(", ")}.`, is_error: true } };
    }
    return {
      step: { t: "read", label: `Loaded the ${name} playbook.` },
      result: { type: "tool_result", tool_use_id: t.id, content: `<skill name="${skill.name}">\n${skill.body}\n</skill>` },
    };
  }
  if (t.name === "get_schema") {
    const kinds = (Array.isArray((t.input as { kinds?: unknown })?.kinds) ? (t.input as { kinds: unknown[] }).kinds : [])
      .filter((k): k is string => typeof k === "string");
    const schema = schemaFor(kinds);
    return {
      result: schema
        ? { type: "tool_result", tool_use_id: t.id, content: schema }
        : { type: "tool_result", tool_use_id: t.id, content: `No schema for ${JSON.stringify(kinds)}. Valid kinds: ${Object.keys(SCHEMA_BY_KIND).join(", ")}.`, is_error: true },
    };
  }
  if (t.name === "search_nodes") {
    // The agent's grep: per-FIELD substring match over EVERY node's content (incl. scene prose, which the
    // digest drops). ~200 nodes/book — fetch all and match in JS; only id/kind/handle/field/snippet go back.
    const q = String((t.input as { query?: string })?.query ?? "").trim();
    if (!q) {
      return { result: { type: "tool_result", tool_use_id: t.id, content: "Provide a non-empty query string.", is_error: true } };
    }
    const { data: rows } = await service
      .from("book_nodes").select("id, kind, content").eq("book_id", bookId);
    const needle = q.toLowerCase();
    const hits: string[] = [];
    let more = 0;
    // prose.text is unwrapped one level so its snippet stays plain text; other nested values fall back to a
    // stringified sub-value (no deep recursion).
    for (const r of (rows ?? []) as { id: string; kind: string; content: Record<string, unknown> | null }[]) {
      for (const [field, value] of Object.entries(r.content ?? {})) {
        let text: string;
        if (typeof value === "string") text = value;
        else if (field === "prose" && value && typeof value === "object" && typeof (value as { text?: unknown }).text === "string") text = (value as { text: string }).text;
        else if (value && typeof value === "object") text = JSON.stringify(value);
        else continue;
        const idx = text.toLowerCase().indexOf(needle);
        if (idx === -1) continue;
        if (hits.length >= 30) { more++; continue; }
        const start = Math.max(0, idx - 60);
        const end = Math.min(text.length, idx + needle.length + 60);
        const snippet = (start > 0 ? "…" : "") + text.slice(start, end).replace(/\s+/g, " ") + (end < text.length ? "…" : "");
        hits.push(`[${r.id}] ${r.kind} “${nodeHandle(r.content)}” — ${field}: “${snippet}”`);
      }
    }
    return {
      step: { t: "read", label: `Searched for “${q}” (${hits.length + more} hit${hits.length + more === 1 ? "" : "s"}).` },
      result: {
        type: "tool_result", tool_use_id: t.id,
        content: hits.length
          ? `${hits.length + more} match(es) for "${q}"${more ? ` (showing first 30)` : ""} — read_node any [id] for full content:\n${hits.join("\n")}`
          : `No nodes match "${q}".`,
      },
    };
  }
  if (t.name === "check_against_contract") {
    const id = String((t.input as { id?: string })?.id ?? "");
    const { data: node } = await service
      .from("book_nodes").select("id, kind, content, book_id").eq("id", id).maybeSingle();
    if (!node || (node as { book_id?: number }).book_id !== bookId) {
      return { result: { type: "tool_result", tool_use_id: t.id, content: `No node with id ${id} in this book.`, is_error: true } };
    }
    const n = node as { id: string; kind: string; content: SceneContent };
    const proseText = (n.content?.prose?.text ?? "").trim();
    if (n.kind !== "scene") {
      return { result: { type: "tool_result", tool_use_id: t.id, content: `Node ${id} is a ${n.kind}, not a scene — only scene prose can be checked against the contract.`, is_error: true } };
    }
    if (!proseText) {
      return { result: { type: "tool_result", tool_use_id: t.id, content: `Scene ${id} has no prose yet (content.prose.text is empty). Render or write the scene before checking it.`, is_error: true } };
    }
    const check = ((t.input as { check?: string })?.check ?? "both");
    const doPlan = check !== "mandate", doMandate = check !== "plan";
    const { agent: model } = await getRoleModels();
    const meta = { fn: "book-agent-contract", bookId, nodeId: n.id, operation: "check-contract", taskTable: "book_agent_runs", taskId: null, userId: null };
    try {
      // The two judges are independent LLM calls — run them together.
      const [planRes, mandateBody] = await Promise.all([
        doPlan ? planConformanceSummary(service, model, n.id, n.content, "book-agent-contract", bookId) : Promise.resolve(null),
        doMandate
          ? (async () => {
            const { data: book } = await service.from("books").select("brief").eq("id", bookId).maybeSingle();
            const brief = ((book as { brief?: Brief } | null)?.brief ?? {}) as Brief;
            const axes = await judgeProse(model, brief, proseText, meta);
            return axes.map((a) => `  ${a.axis}: ${a.verdict.toUpperCase()} — ${a.detail}${a.evidence ? ` (e.g. "${a.evidence}")` : ""}`).join("\n");
          })()
          : Promise.resolve(null),
      ]);
      const sections: string[] = [];
      if (doPlan) sections.push(`PLAN CONFORMANCE (does the prose deliver the scene's own plan?):\n${planRes?.summary ?? "  (no prose to check)"}`);
      if (doMandate) sections.push(`MANDATE CONFORMANCE (does the prose honor the brief?):\n${mandateBody || "  (judge returned no axes — inspect by hand)"}`);
      return {
        step: { t: "read", label: `Checked scene “${nodeHandle(n.content as Record<string, unknown>)}” against ${check === "both" ? "its plan + the brief" : check === "plan" ? "its plan" : "the brief"}.` },
        result: { type: "tool_result", tool_use_id: t.id, content: sections.join("\n\n") || "No checks ran — inspect by hand." },
      };
    } catch (e) {
      return { result: { type: "tool_result", tool_use_id: t.id, content: `Contract check failed: ${String((e as Error)?.message ?? e)}`, is_error: true } };
    }
  }
  // The verify-layer reads (doc_1785668685869.md #1 — "wire the reads into the tool belt"): the same
  // judges that already run from MetersPane/LedgerPane, ported in-agent so the agent can read its own
  // work instead of only acting on it. Read-only, same shape as check_against_contract/audit_vision —
  // no write-back to book_nodes (the UI panels own writing observed_* fields).
  if (t.name === "read_shape") {
    const { data: rows } = await service.from("book_nodes").select("id, parent_id, kind, position, content").eq("book_id", bookId);
    // liveNodes (doc_1785673597000.md §5a): a read judges what the book SAYS. An unwritten act would
    // otherwise count against the shape it was never given a chance to deliver.
    const nodes = liveNodes((rows ?? []) as DnaNode[]);
    const input = buildShapeReadInput(nodes);
    if (!input) {
      return { result: { type: "tool_result", tool_use_id: t.id, content: "Not enough structure yet to read shape — need a premise with movements and at least one act with beats.", is_error: true } };
    }
    const movementMenu = input.movements.map((m, i) => `${i}. ${m}`).join("\n");
    const actMenu = input.acts.map((a) => {
      const beats = a.beats.map((b) => `    · [beat=${b.beatId}] ${b.summary ?? ""}`).join("\n");
      return `[act=${a.actId}]${a.title ? ` "${a.title}"` : ""}` +
        `${a.goal ? `\n    goal: ${a.goal}` : ""}${a.turningPoint ? `\n    turning point: ${a.turningPoint}` : ""}` +
        `${beats ? `\n${beats}` : ""}`;
    }).join("\n\n");
    const { agent: model } = await getRoleModels();
    const meta = { fn: "book-agent-read-shape", bookId, operation: "read-shape", taskTable: "book_agent_runs", taskId: null, userId: null };
    try {
      const resp = await callLLM({
        model, max_tokens: 1500, output_config: { effort: "medium" },
        system: [{
          type: "text",
          text: "You are a structural editor. The premise promises the story moves through these MOVEMENTS, in order. The acts below are the story's actual plan at the next zoom. For each movement, judge which act(s) carry it (actIds, in reading order, possibly empty when no act carries it) and how faithfully their content delivers that movement (fit 0=absent … 5=fully delivered). Judge the PLAN TEXT on the page, not what a good version would say. `worst` = the single act or beat most responsible for a low score. Be calibrated: do not flatter the outline.",
          cache_control: { type: "ephemeral" },
        }],
        messages: [{
          role: "user",
          content: `MOVEMENTS (the promise, in order — reference each by its number):\n${movementMenu}\n\n${input.endingFeel ? `ENDING FEEL (context only): ${input.endingFeel}\n\n` : ""}ACTS (the plan; each act's goal, turning point, and beat summaries):\n${actMenu}\n\nOutput ONLY this JSON (no prose, no fences):\n{ "fits": [ { "movement": <a movement number above>, "actIds": ["<act= id>", ...], "fit": <0..5>, "worst": "<an act= or beat= id>", "note": "<one line, ≤200 chars>" } ] }`,
        }],
      }, meta, { signal: AbortSignal.timeout(120_000) });
      const parsed = JSON.parse(extractJsonBlock(textFromLLM(resp).trim())) as { fits?: { movement: number; actIds: string[]; fit: number; worst?: string; note?: string }[] };
      const fits = Array.isArray(parsed.fits) ? parsed.fits : [];
      const lines = fits.map((f) =>
        `movement ${f.movement} “${input.movements[f.movement] ?? "?"}”: fit ${f.fit}/5${f.actIds?.length ? ` (carried by ${f.actIds.join(", ")})` : " (no act carries it)"}${f.worst ? ` — weakest: ${f.worst}` : ""}${f.note ? ` — ${f.note}` : ""}`
      );
      return {
        step: { t: "read", label: "Read the shape fit — do the acts deliver the premise's promised movements?" },
        result: { type: "tool_result", tool_use_id: t.id, content: lines.join("\n") || "(the judge returned nothing — inspect by hand)" },
      };
    } catch (e) {
      return { result: { type: "tool_result", tool_use_id: t.id, content: `Shape read failed: ${String((e as Error)?.message ?? e)}`, is_error: true } };
    }
  }
  if (t.name === "read_facts") {
    const id = String((t.input as { id?: string })?.id ?? "");
    const { data: rows } = await service.from("book_nodes").select("id, parent_id, kind, position, content").eq("book_id", bookId);
    // liveNodes: the canon ledger + entity registry below must not carry blank rows. Safe for the target —
    // this tool refuses a scene without prose, and prose counts as content.
    const nodes = liveNodes((rows ?? []) as DnaNode[]);
    const scene = nodes.find((n) => n.id === id);
    if (!scene || scene.kind !== "scene") {
      return { result: { type: "tool_result", tool_use_id: t.id, content: `No scene with id ${id} in this book.`, is_error: true } };
    }
    const proseText = ((scene.content as SceneContent).prose?.text ?? "").trim();
    if (!proseText) {
      return { result: { type: "tool_result", tool_use_id: t.id, content: `Scene ${id} has no prose yet — render or write it before checking continuity.`, is_error: true } };
    }
    const canon = ledgerBefore(nodes, id).map((f) => `- ${f.key}: ${f.value}`).join("\n") || "(nothing established yet — this is the opening)";
    const registry = entityRegistryBlock(nodes);
    const registryIds = new Set(registry.match(/n_[a-z0-9]+/gi) ?? []);
    const registryBlock = registry
      ? `ENTITY REGISTRY — the canonical cast/places/rules, with ids. When a fact is ABOUT one of these, set "entity" to its id and reuse a consistent key. Resolve names, titles, epithets, and pronouns to registry entries; do NOT mint a parallel entry for a new way of referring to a known entity:\n${registry}\n\n`
      : "";
    const { agent: model } = await getRoleModels();
    const meta = { fn: "book-agent-read-facts", bookId, nodeId: id, operation: "read-facts", taskTable: "book_agent_runs", taskId: null, userId: null };
    try {
      const resp = await callLLM({
        model, max_tokens: 1500, output_config: { effort: "medium" },
        system: [{
          type: "text",
          text: "You maintain a story's continuity ledger. Given the CANON established so far (key→value facts) and the NEW scene's prose, do two things: (1) EXTRACT the durable, trackable facts this scene asserts or changes — concise snake_case key + a short value (identities, roles, relationships, possessions, locations, physical/world facts). Reuse an existing canon key when the scene UPDATES it (that supersedes the old value); omit facts already in the canon and unchanged. Skip transient mood. (2) FLAG contradictions: any fact in the prose that conflicts with a canon value (was → now). A deliberate, narrated change is NOT a contradiction — only an unintended conflict is.",
          cache_control: { type: "ephemeral" },
        }],
        messages: [{
          role: "user",
          content: `${registryBlock}CANON (story so far):\n${canon}\n\nNEW SCENE — prose:\n${proseText.length > 8000 ? `${proseText.slice(0, 6000)}\n[…]\n${proseText.slice(-2000)}` : proseText}\n\nOutput ONLY this JSON (no prose, no fences):\n{ "facts": [ { "key": "<snake_case>", "value": "<short>", "note": "<optional>", "entity": "<a registry id when the fact is about one, else omit>" } ], "contradictions": [ { "key": "<canon key>", "was": "<canon value>", "now": "<what the prose says>", "note": "<optional>" } ] }`,
        }],
      }, meta, { signal: AbortSignal.timeout(90_000) });
      const parsed = JSON.parse(extractJsonBlock(textFromLLM(resp).trim())) as {
        facts?: { key: string; value: string; note?: string; entity?: string }[];
        contradictions?: { key: string; was: string; now: string; note?: string }[];
      };
      const facts = (Array.isArray(parsed.facts) ? parsed.facts : []).filter((f) => f?.key && f?.value);
      const contradictions = (Array.isArray(parsed.contradictions) ? parsed.contradictions : []).filter((c) => c?.key && c?.was && c?.now);
      const factLines = facts.map((f) => `+ ${f.key}: ${f.value}${f.entity && registryIds.has(f.entity) ? ` (${f.entity})` : ""}`);
      const flagLines = contradictions.map((c) => `⚠ ${c.key}: was "${c.was}", now "${c.now}"${c.note ? ` — ${c.note}` : ""}`);
      return {
        step: { t: "read", label: `Checked continuity for “${nodeHandle(scene.content as Record<string, unknown>)}”.` },
        result: {
          type: "tool_result", tool_use_id: t.id,
          content: [
            contradictions.length ? `CONTRADICTIONS:\n${flagLines.join("\n")}` : "No contradictions found.",
            facts.length ? `NEW/UPDATED FACTS:\n${factLines.join("\n")}` : "No new facts asserted.",
          ].join("\n\n"),
        },
      };
    } catch (e) {
      return { result: { type: "tool_result", tool_use_id: t.id, content: `Continuity check failed: ${String((e as Error)?.message ?? e)}`, is_error: true } };
    }
  }
  if (t.name === "read_confusion") {
    const { data: rows } = await service.from("book_nodes").select("id, parent_id, kind, position, content").eq("book_id", bookId);
    // liveNodes: chapters() over a dense tree would mint empty chapters for unwritten beats.
    const nodes = liveNodes((rows ?? []) as DnaNode[]);
    const byNodeId = new Map(nodes.map((n) => [n.id, n]));
    const hasProse = (id: string) => !!((byNodeId.get(id)?.content as SceneContent | undefined)?.prose?.text ?? "").trim();
    const eligible = chapters(nodes).filter((ch) => ch.sceneIds.some(hasProse));
    const MAX_PROSE_CHARS = 6000, MAX_PRIOR_CHARS = 3000, MAX_TOTAL_CHARS = 80_000, MAX_FLAGS_PER_SCENE = 5;
    const blocks: string[] = [];
    const sceneIds = new Set<string>();
    let total = 0, priorTail = "", chaptersRead = 0;
    // No client-built digest recap is available server-side, so the "what you know so far" prior context
    // is the tail of the raw prose already read — the same fallback confusionRead.ts uses when a scene has
    // no prose_digest yet.
    for (const ch of eligible) {
      const scenes = ch.sceneIds.map((id) => byNodeId.get(id)).filter((n): n is DnaNode => !!n && hasProse(n.id));
      const block =
        `=== CHAPTER ${ch.index + 1} ===\n` +
        `WHAT YOU KNOW SO FAR: ${priorTail.trim() || "(nothing — the book opens here)"}\n\n` +
        scenes.map((s) => `[scene=${s.id}]\n${((s.content as SceneContent).prose!.text as string).slice(0, MAX_PROSE_CHARS)}`).join("\n\n");
      if (blocks.length && total + block.length > MAX_TOTAL_CHARS) break;
      blocks.push(block); total += block.length; chaptersRead++;
      for (const s of scenes) sceneIds.add(s.id);
      priorTail = (priorTail + " " + scenes.map((s) => (s.content as SceneContent).prose!.text as string).join(" ")).slice(-MAX_PRIOR_CHARS);
    }
    const truncated = chaptersRead < eligible.length;
    if (!sceneIds.size) {
      return { result: { type: "tool_result", tool_use_id: t.id, content: "No scenes with prose yet — nothing to cold-read.", is_error: true } };
    }
    const { agent: model } = await getRoleModels();
    const meta = { fn: "book-agent-read-confusion", bookId, operation: "read-confusion", taskTable: "book_agent_runs", taskId: null, userId: null };
    try {
      const resp = await callLLM({
        model, max_tokens: 2500, output_config: { effort: "medium" },
        system: [{
          type: "text",
          text: "You are a first-time reader with NO access to the author's notes, outline, or character sheets. You know ONLY the PRIOR CONTEXT recap and what you read here, in order. For each scene, flag only GENUINE confusion — a moment where a reader who knows only this much loses the thread: who someone is (who), where the scene takes place (where), when it happens or how much time has passed (when), why a character acts or why events follow (why), or a callback to something never shown (reference). Each note is ONE concrete line quoting the confusing bit. Deliberate mystery the text clearly frames as a question to be answered later is NOT confusion. Skip scenes that read fine — most should.",
          cache_control: { type: "ephemeral" },
        }],
        messages: [{
          role: "user",
          content: `THE BOOK SO FAR, chapter by chapter (each with what you, the reader, know going in):\n\n${blocks.join("\n\n")}\n\nOutput ONLY this JSON (no prose, no fences):\n{ "flags": [ { "sceneId": "<a scene= id above>", "kind": "who|where|when|why|reference", "note": "<one line quoting the confusing bit>" } ] }`,
        }],
      }, meta, { signal: AbortSignal.timeout(120_000) });
      const parsed = JSON.parse(extractJsonBlock(textFromLLM(resp).trim())) as { flags?: { sceneId: string; kind: string; note: string }[] };
      const perScene = new Map<string, number>();
      const flags = (Array.isArray(parsed.flags) ? parsed.flags : [])
        .filter((f) => f?.sceneId && sceneIds.has(f.sceneId) && f?.note)
        .filter((f) => {
          const n = (perScene.get(f.sceneId) ?? 0) + 1;
          perScene.set(f.sceneId, n);
          return n <= MAX_FLAGS_PER_SCENE;
        });
      const lines = flags.map((f) => `[${f.sceneId}] ${f.kind}: ${f.note}`);
      return {
        step: { t: "read", label: `Cold-read ${chaptersRead} chapter${chaptersRead === 1 ? "" : "s"} for reader confusion.` },
        result: {
          type: "tool_result", tool_use_id: t.id,
          content: (lines.length ? lines.join("\n") : "No confusion found — the read chapters follow clearly.") +
            (truncated ? `\n\n(read ${chaptersRead} of ${eligible.length} chapters — book too long for one pass, run again to continue)` : ""),
        },
      };
    } catch (e) {
      return { result: { type: "tool_result", tool_use_id: t.id, content: `Cold read failed: ${String((e as Error)?.message ?? e)}`, is_error: true } };
    }
  }
  // The fulfillment leg of the vision contract (docs/vision-to-structure.md D5/D8): an LLM judge that
  // compares the captured vision section-by-section against a compact digest of the current foundations
  // + structure. Non-terminal, like check_against_contract — the agent reads the verdict and PROPOSES
  // fixes for real gaps through the normal channels. The rubric is the shared VISION_RUBRIC const.
  if (t.name === "audit_vision") {
    const focus = String((t.input as { focus?: string })?.focus ?? "").trim();
    const [{ data: book }, { data: rows }] = await Promise.all([
      service.from("books").select("brief").eq("id", bookId).maybeSingle(),
      service.from("book_nodes").select("id, parent_id, kind, content").eq("book_id", bookId),
    ]);
    const brief = ((book as { brief?: Brief } | null)?.brief ?? {}) as Brief;
    const vision = brief.vision;
    const filled = VISION_SECTIONS.filter(([k]) => typeof vision?.[k] === "string" && (vision[k] as string).trim());
    if (!filled.length) {
      return { result: { type: "tool_result", tool_use_id: t.id, content: "(no vision captured — run the interview or update_vision first)", is_error: true } };
    }
    const visionText = filled.map(([k, label]) => `- ${label}: ${(vision![k] as string).trim()}`).join("\n");
    // liveNodes: the audit asks what the book has COMMITTED to; a placeholder has committed to nothing.
    const nodes = liveNodes((rows ?? []) as { id: string; parent_id: string | null; kind: string; content: Record<string, unknown> | null }[]);
    const of = (k: string) => nodes.filter((n) => n.kind === k);
    const pick = (c: Record<string, unknown> | null, keys: string[]) =>
      JSON.stringify(Object.fromEntries(keys.flatMap((key) => c?.[key] != null && c[key] !== "" ? [[key, c[key]]] : [])));
    // A tentpole is PLACED when any beat/scene's plan references its id (realizes/realizes_tentpole refs).
    const structureJson = nodes.filter((n) => n.kind === "beat" || n.kind === "scene").map((n) => JSON.stringify(n.content ?? {})).join("\n");
    const digest = [
      `PILLAR: ${of("pillar").map((n) => pick(n.content, ["controlling_idea", "ending"])).join(" ") || "(none)"}`,
      `PREMISE: ${of("premise").map((n) => pick(n.content, ["dramatic_question", "shape"])).join(" ") || "(none)"}`,
      `CHARACTERS:\n${of("character").map((n) => `  ${pick(n.content, ["name", "role", "want", "need", "wound", "lie"])}`).join("\n") || "  (none)"}`,
      `RELATIONSHIPS:\n${of("relationship").map((n) => `  ${pick(n.content, ["a", "b", "bond", "arc"])}`).join("\n") || "  (none)"}`,
      `THREADS:\n${of("thread").map((n) => `  ${pick(n.content, ["name", "kind", "promise", "waived"])}`).join("\n") || "  (none)"}`,
      `TENTPOLES:\n${of("tentpole").map((n) => `  [${n.id}] ${pick(n.content, ["name", "summary", "source", "waived"])} — ${structureJson.includes(n.id) ? "PLACED (a beat/scene realizes it)" : "UNPLACED"}`).join("\n") || "  (none)"}`,
      `METERS:\n${of("meter").map((n) => `  ${pick(n.content, ["name", "kind"])} — target curve: ${Array.isArray((n.content as { target?: unknown[] } | null)?.target) && ((n.content as { target: unknown[] }).target.length) ? "set" : "none"}`).join("\n") || "  (none)"}`,
      `WORLD/LOCATIONS:\n${[...of("world_fact"), ...of("location")].map((n) => `  ${n.kind}: ${pick(n.content, ["name", "rule", "mood"])}`).join("\n") || "  (none)"}`,
      `ACTS/BEATS (one-liners):\n${nodes.filter((n) => n.kind === "act" || n.kind === "beat").map((n) => `  ${n.kind}: ${nodeHandle(n.content)}`).join("\n") || "  (none)"}`,
      `SCENES: ${of("scene").length} total, ${of("scene").filter((n) => ((n.content as { prose?: { words?: number } } | null)?.prose?.words ?? 0) > 0).length} with prose`,
    ].join("\n\n");
    const { agent: model } = await getRoleModels();
    const meta = { fn: "book-agent-audit-vision", bookId, operation: "audit-vision", taskTable: "book_agent_runs", taskId: null, userId: null };
    try {
      const resp = await callLLM({
        model, max_tokens: 2500, output_config: { effort: "medium" },
        system: [{ type: "text", text: `You are a story editor auditing whether a book's built structure FULFILLS the author's captured vision. Rubric — apply it section by section over the vision:\n${VISION_RUBRIC}\n\nOutput: one line per vision section — "SECTION: covered|partial|missing — gaps", then a GAPS list where every gap names its concrete fix (the tool and the node). Be terse and specific; cite node ids from the digest. No preamble.`, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: `THE AUTHOR'S VISION:\n${visionText}\n\nTHE CURRENT STRUCTURE (digest):\n${digest}${focus ? `\n\nFOCUS: audit only this — ${focus}` : ""}\n\nAudit.` }],
      }, meta, { signal: AbortSignal.timeout(120_000) });
      const verdict = textFromLLM(resp).trim() || "(the judge returned nothing — inspect by hand)";
      return {
        step: { t: "read", label: focus ? `Audited the structure against the vision (${focus.slice(0, 60)}).` : "Audited the structure against the vision." },
        result: { type: "tool_result", tool_use_id: t.id, content: verdict },
      };
    } catch (e) {
      return { result: { type: "tool_result", tool_use_id: t.id, content: `Vision audit failed: ${String((e as Error)?.message ?? e)}`, is_error: true } };
    }
  }
  // The inline research leg (option A): a live web_search-backed Claude call that returns a distilled
  // craft/genre brief AND persists it to books.craft_notes, so the same research the agent gathers mid-turn
  // becomes durable context for later turns and prose generation. Read-class like audit_vision — the model
  // reads the brief back and folds it into its next propose_* call. researchCraft pins to an Anthropic model
  // (web_search is an Anthropic server tool) even while the active tier is DeepSeek.
  if (t.name === "research_web") {
    const question = String((t.input as { question?: string })?.question ?? "").trim();
    if (!question) {
      return { result: { type: "tool_result", tool_use_id: t.id, content: "Provide a specific research question (not a bare keyword).", is_error: true } };
    }
    const topicIn = String((t.input as { topic?: string })?.topic ?? "").trim();
    const context = String((t.input as { context?: string })?.context ?? "").trim().slice(0, 4000);
    const key = ((topicIn || question).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60)) || "note";
    const meta = { fn: "book-agent-research", bookId, operation: "research", taskTable: "book_agent_runs", taskId: null, userId: null };
    try {
      const result = await researchCraft({ question: question.slice(0, 500), context: context || undefined }, meta, { signal: AbortSignal.timeout(120_000) });
      const note = renderResearch(result);
      // Best-effort persist: read current notes, merge this key, write back. A failed write still returns the
      // brief to the model — the research isn't lost, it just isn't saved for later.
      const { data: book } = await service.from("books").select("craft_notes").eq("id", bookId).maybeSingle();
      const notes = { ...(((book as { craft_notes?: Record<string, string> } | null)?.craft_notes) ?? {}), [key]: note };
      await service.from("books").update({ craft_notes: notes }).eq("id", bookId);
      return {
        step: { t: "read", label: `Researched the web: “${question.slice(0, 70)}”${result.sources.length ? ` (${result.sources.length} sources)` : ""}.` },
        result: { type: "tool_result", tool_use_id: t.id, content: `${note}\n\n(saved to craft notes as “${key}” — later turns and prose generation will see it)` },
      };
    } catch (e) {
      return { result: { type: "tool_result", tool_use_id: t.id, content: `Web research failed: ${String((e as Error)?.message ?? e)}`, is_error: true } };
    }
  }
  return { result: { type: "tool_result", tool_use_id: t.id, content: `Unknown tool ${t.name}.`, is_error: true } };
}

export { toolResults, execTool };
