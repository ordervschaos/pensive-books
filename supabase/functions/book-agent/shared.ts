// book-agent shared kernel: row/proposal/op types and the pure leaf helpers (nodeHandle, the
// on-demand content-schema lookup) that every book-agent module imports.
// The content schema is GENERATED from the web app's NODE_SCHEMA (dnaSchema.artifact.test.ts) — never
// hand-edit; edit NODE_SCHEMA + regen.
import dnaSchema from "../_shared/dna-schema.json" with { type: "json" };

// ── Row shapes ──
// 'decision' = an auto-mode creative fork the agent journaled via ask_author (question in `label`,
// its stated options in `options`, `at` = when) — kept in the feed so the author can revisit forks
// after an autonomous run (state change, not erasure — NORTH_STAR §6 rule 8).
// 'finding' = fold-on-read: what the model DISTILLED from reads it has done, in `findings` (the label
// is just the feed line). This is the run's durable memory — `steps` is never pruned, whereas the raw
// read results in `transcript` are (compactTranscript). See findingsBlock in transcript.ts.
interface Finding { ref: string; finding: string }
// `nodeId` rides on the 'plan' step propose_options writes (advance.ts) — the client's mirror of this
// interface has always declared it; this one hadn't, so that write was a standing type error.
interface AgentStep { t: "user" | "note" | "read" | "ask" | "answer" | "plan" | "done" | "decision" | "finding"; label: string; options?: string[]; at?: string; nodeId?: string; findings?: Finding[] }
interface Pending {
  tool_use_id: string;
  question: string;
  options?: string[];
  // tool_results for read tool calls (read_node/search_nodes/…) issued in the SAME assistant turn as the
  // ask — the answer message must carry results for every tool_use of that turn, so these ride along.
  preResults?: unknown[];
}
// A node op over book_nodes — the DNA substrate's edit/add/delete/replace_children (mirrors lib/dnaChat.ts).
interface NewSubtree { content: Record<string, unknown>; children?: NewSubtree[] }
type NodeOp =
  | { op: "edit"; id: string; content: Record<string, unknown> }
  | { op: "add"; kind: string; parentId: string; content: Record<string, unknown> }
  | { op: "delete"; id: string }
  // Rebuild a level: delete the parent's existing non-locked `childKind` children (cascade), add `children` fresh.
  | { op: "replace_children"; parentId: string; childKind: string; children: NewSubtree[] }
  // Surgical prose patch: replace the FIRST occurrence of `find` in a scene's content.prose.text. The
  // whole-text `edit` alternative made prose fixes unbatchable (each edit re-sends ~2.6k tokens of prose,
  // so 8k max_tokens fit ~2 scenes — observed: the agent fixed ONE echo per turn). find/replace is the
  // Claude Code Edit-tool shape: a dozen echo fixes now fit in one small proposal.
  | { op: "replace_text"; id: string; find: string; replace: string };

// A reviewable change the agent proposes against the DNA tree; the author applies it (applyNodeOps)
// through the existing book_nodes write path (docs/agent-rail.md). One layer now: the DNA tree.
// layer 'dna' = node ops the author applies to book_nodes. layer 'prose-render' = a request to (re)generate
// scene prose; ops is empty and sceneIds names the scenes — the AUTHOR applies it and the prose streams in
// their browser via the v2 pipeline (docs/agent-context-model.md). The agent never generates prose itself.
interface RenderBrief { focus: string; mustHonor?: string[]; avoid?: string[] }
interface AgentProposal { id: string; layer: "dna" | "prose-render" | "expansion"; summary: string; ops: NodeOp[]; sceneIds?: string[]; brief?: RenderBrief; nodeId?: string; target?: string }

interface RunRow {
  id: number;
  book_id: number;
  created_by: string | null;
  kind: string; // 'thread' (the persistent omni-rail conversation) — the only kind created today
  status: string;
  transcript: unknown[];
  steps: AgentStep[];
  pending: Pending | null;
  proposals: AgentProposal[] | null;
  context_analysis: string | null; // latest client-computed story analysis (backstop)
  context_objective: string | null; // latest client-computed current journey objective (guided-flow anchor)
  context_attached_ids: string[] | null; // the context tray: node ids the author attached as anchors
  context_effort: "low" | "high" | null; // null = high (default)
  context_auto: boolean | null; // auto-accept mode: run autonomously, never park on ask_author
  context_follow_objective: boolean | null; // true only when this arc was started by the explicit "Next" nudge — gates the objective-driven skill fallback
  context_variant: string | null; // eval A/B arm (variants.ts); NULL = production behaviour, unchanged
  // The DECLARED focus (docs/agent-focus.md). NULL mode = no declaration ⇒ derived/wide ⇒ the prompt is
  // byte-identical to pre-focus behaviour. A stored value is by definition author-declared, which is why
  // there is no set_by column. `focus_target` is the node the mode operates ON — NOT the pinned tray
  // (context_attached_ids), which is author-owned and outlives any mode.
  context_focus_mode: string | null;
  context_focus_target: string | null;
  context_focus_at: string | null;
  turns: number;
  cancel_requested: boolean;
  title: string | null; // short label generated from the chat's first message (history rail); null = not yet named
}
// NB context_variant is load-bearing for the A/B seam: advance.ts reads it off THIS row to pick the arm.
// Omitting it here made variantSuffix() receive undefined, so every arm silently ran the control prompt —
// invisible, because a no-op variant looks exactly like "the change had no effect".
const ROW_COLS = "id, book_id, created_by, kind, status, transcript, steps, pending, proposals, context_analysis, context_objective, context_attached_ids, context_effort, context_auto, context_follow_objective, context_variant, context_focus_mode, context_focus_target, context_focus_at, turns, cancel_requested, title";

const ALL_NODE_KINDS = ["seed", "premise", "pillar", "act", "beat", "scene", "character", "relationship", "tentpole", "world_fact", "location", "thread", "game", "meter", "voice_profile"];

interface DnaNodeRow { id: string; parent_id: string | null; kind: string; level: number; position: number; content: Record<string, unknown>; authoring: { locked?: boolean; status?: string } | null; proposals?: { id: string; content: Record<string, unknown>; note?: string }[] | null }

// A short human handle for a node (mirror of lib/dnaChat nodeLabel) for read summaries + step labels.
function nodeHandle(content: Record<string, unknown> | null | undefined): string {
  const c = content ?? {};
  const h = c.name ?? c.title ?? c.logline ?? c.summary ?? c.goal;
  return typeof h === "string" && h.trim() ? h.trim().slice(0, 60) : "(untitled)";
}

const CONTENT_SCHEMAS = dnaSchema.promptGuide;

// Schema-on-demand: the full CONTENT_SCHEMAS block is ~2k chars of every kind's field list. Rather than
// ship it every turn, we serve the relevant kind's schema when the agent reads or writes a node
// (read_node result + the get_schema tool). promptGuide is a legend line followed by one `- <kind> → …`
// bullet per kind; split it so we can hand back just the kinds in play.
const SCHEMA_LINES = CONTENT_SCHEMAS.split("\n");
const SCHEMA_HEADER = SCHEMA_LINES[0];
const SCHEMA_BY_KIND: Record<string, string> = {};
for (const line of SCHEMA_LINES) {
  const m = line.match(/^- (\w+) →/);
  if (m) SCHEMA_BY_KIND[m[1]] = line;
}
// The exact field schema for one or more kinds (legend + the matching bullets), or "" if none match.
function schemaFor(kinds: string[]): string {
  const lines = [...new Set(kinds)].map((k) => SCHEMA_BY_KIND[k]).filter(Boolean);
  return lines.length ? `${SCHEMA_HEADER}\n${lines.join("\n")}` : "";
}

export { ROW_COLS, ALL_NODE_KINDS, nodeHandle, CONTENT_SCHEMAS, SCHEMA_BY_KIND, schemaFor };
export type { AgentStep, Finding, Pending, NewSubtree, NodeOp, RenderBrief, AgentProposal, RunRow, DnaNodeRow };
