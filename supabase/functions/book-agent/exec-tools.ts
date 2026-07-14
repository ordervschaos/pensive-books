// book-agent tool execution: run a turn's non-terminal tool calls (read_node / search_nodes /
// get_schema / read_skill / check_against_contract / update_vision) and return their tool_result blocks.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { type Brief, type BriefVision, VISION_SECTIONS } from "../_shared/brief.ts";
import { getRoleModels } from "../_shared/model-config.ts";
import { AGENT_SKILLS } from "../_shared/agent-skills.ts";
import { type SceneContent } from "../_shared/novel-dna.ts";
import { judgeProse } from "../_shared/mandate-gate.ts";
import { callLLM, textFromLLM } from "../_shared/llm.ts";
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
    const childLines = kids.map((k) => `  - [${k.id}] ${k.kind}: ${nodeHandle(k.content)}`).join("\n");
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
    const nodes = (rows ?? []) as { id: string; parent_id: string | null; kind: string; content: Record<string, unknown> | null }[];
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
  return { result: { type: "tool_result", tool_use_id: t.id, content: `Unknown tool ${t.name}.`, is_error: true } };
}

export { toolResults, execTool };
