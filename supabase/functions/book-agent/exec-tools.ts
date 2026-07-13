// book-agent tool execution: run a turn's non-terminal tool calls (read_node / search_nodes /
// get_schema / read_skill / check_against_contract) and return their tool_result blocks.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { type Brief } from "../_shared/brief.ts";
import { getRoleModels } from "../_shared/model-config.ts";
import { AGENT_SKILLS } from "../_shared/agent-skills.ts";
import { type SceneContent } from "../_shared/novel-dna.ts";
import { judgeProse } from "../_shared/mandate-gate.ts";
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
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      return { result: { type: "tool_result", tool_use_id: t.id, content: "Contract check unavailable: ANTHROPIC_API_KEY not configured.", is_error: true } };
    }
    const check = ((t.input as { check?: string })?.check ?? "both");
    const doPlan = check !== "mandate", doMandate = check !== "plan";
    const { agent: model } = await getRoleModels();
    const meta = { fn: "book-agent-contract", bookId, nodeId: n.id, operation: "check-contract", taskTable: "book_agent_runs", taskId: null, userId: null };
    try {
      // The two judges are independent LLM calls — run them together.
      const [planRes, mandateBody] = await Promise.all([
        doPlan ? planConformanceSummary(service, apiKey, model, n.id, n.content, "book-agent-contract", bookId) : Promise.resolve(null),
        doMandate
          ? (async () => {
            const { data: book } = await service.from("books").select("brief").eq("id", bookId).maybeSingle();
            const brief = ((book as { brief?: Brief } | null)?.brief ?? {}) as Brief;
            const axes = await judgeProse(apiKey, model, brief, proseText, meta);
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
  return { result: { type: "tool_result", tool_use_id: t.id, content: `Unknown tool ${t.name}.`, is_error: true } };
}

export { toolResults, execTool };
