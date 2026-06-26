// dnaSchema — the SINGLE SOURCE OF TRUTH for what each node kind's content looks like. One `NODE_SCHEMA`
// object declares every editable/validatable field (its type, whether it's required, its enum, the kind it
// references) and three consumers derive from it instead of re-asserting the shape:
//   • the tree editor    — renders a typed editor per field (DnaTreePage)
//   • the content lints   — validateContent() checks a node against its schema (generation boundary + score)
//   • the completeness    — requiredMissing()/contentCompleteness() count filled vs required fields
// This replaces the old drift where EDIT_FIELDS (editor), the dna-chat prompt, and the TS NodeContent types
// each hand-described the same shape. The TS interfaces in novelDna stay the COMPILE-TIME view; this is the
// RUNTIME view. Structure (parent kind, singletons) lives in novelDna (PARENT_KIND); this owns content.
import { isEntityKind, type DnaIssue, type DnaNode, type NodeKind } from "@/lib/novelDna";

// ── Field spec ────────────────────────────────────────────────────────────────
// text/list (comma) for free text, ref/refs for id pointers (a dropdown/chip-picker of the right kind),
// select for enums, percent for 0–1 floats, object for nested groups (value_shift, premise shape).
export type FieldType = "text" | "list" | "ref" | "refs" | "select" | "percent" | "object";
export interface EditSpec {
  key: string; label: string; type?: FieldType; multiline?: boolean;
  refKind?: NodeKind; options?: string[]; fields?: EditSpec[];
  required?: boolean; // load-bearing — a node missing this reads as incomplete (and is rejected at generation)
}

const ROLES = ["protagonist", "antagonist", "ally", "love_interest", "minor"];
const POLARITY = ["up", "down"];

// ── The schema (formerly DnaTreePage.EDIT_FIELDS) — now the one place the field shape lives ───────────────
export const NODE_SCHEMA: Partial<Record<NodeKind, EditSpec[]>> = {
  seed: [{ key: "logline", label: "logline", multiline: true, required: true }],
  premise: [
    { key: "dramatic_question", label: "question", multiline: true, required: true }, { key: "genre", label: "genre", type: "list" }, { key: "tone", label: "tone", type: "list" },
    { key: "shape", label: "shape", type: "object", fields: [
      { key: "setup", label: "setup", multiline: true }, { key: "turn1", label: "turn 1", multiline: true }, { key: "turn2", label: "turn 2", multiline: true },
      { key: "turn3", label: "turn 3", multiline: true }, { key: "resolution", label: "resolution", multiline: true },
    ] },
  ],
  pillar: [{ key: "controlling_idea", label: "idea", multiline: true, required: true }, { key: "ending", label: "ending", multiline: true }],
  character: [
    { key: "name", label: "name", required: true }, { key: "role", label: "role", type: "select", options: ROLES }, { key: "want", label: "want", multiline: true },
    { key: "need", label: "need", multiline: true }, { key: "wound", label: "wound", multiline: true }, { key: "lie", label: "lie", multiline: true },
    { key: "truth", label: "truth", multiline: true }, { key: "idiolect", label: "idiolect", multiline: true }, { key: "tag", label: "tag" },
  ],
  relationship: [
    { key: "a", label: "a", type: "ref", refKind: "character", required: true }, { key: "b", label: "b", type: "ref", refKind: "character", required: true },
    { key: "bond", label: "bond", multiline: true, required: true }, { key: "charge", label: "charge", multiline: true },
  ],
  world_fact: [{ key: "name", label: "name", required: true }, { key: "rule", label: "rule", multiline: true, required: true }, { key: "mechanism", label: "mechanism", multiline: true }, { key: "category", label: "category" }],
  thread: [{ key: "name", label: "name", required: true }, { key: "kind", label: "kind", type: "select", options: ["mystery", "foreshadow", "setup_payoff", "arc"] }, { key: "promise", label: "promise", multiline: true, required: true }, { key: "payoff", label: "payoff", multiline: true }],
  game: [
    { key: "name", label: "name", required: true }, { key: "players", label: "players", type: "refs", refKind: "character" },
    { key: "win_condition", label: "win", multiline: true, required: true }, { key: "lose_condition", label: "lose", multiline: true, required: true }, { key: "stake", label: "stake", multiline: true },
    { key: "governing_rules", label: "rules", type: "refs", refKind: "world_fact" },
  ],
  tentpole: [{ key: "summary", label: "summary", multiline: true, required: true }],
  voice_profile: [
    { key: "pov", label: "pov", type: "select", options: ["first-person", "third-person-limited", "third-person-omniscient", "second-person"] },
    { key: "tense", label: "tense", type: "select", options: ["past", "present"] }, { key: "style", label: "style", multiline: true, required: true },
    { key: "constraints", label: "constraints", type: "list" }, { key: "sample", label: "sample", multiline: true },
  ],
  movement: [
    { key: "title", label: "title" }, { key: "goal", label: "goal", multiline: true, required: true }, { key: "turning_point", label: "turning point", multiline: true },
    { key: "target_pct", label: "target %", type: "percent" },
    { key: "value", label: "value", type: "object", fields: [{ key: "name", label: "name" }, { key: "from", label: "from" }, { key: "to", label: "to" }] },
  ],
  beat: [
    { key: "summary", label: "summary", multiline: true, required: true }, { key: "connector", label: "connector", type: "select", options: ["therefore", "but"] },
    { key: "polarity", label: "polarity", type: "select", options: POLARITY },
  ],
  scene: [
    { key: "pov", label: "pov", type: "ref", refKind: "character" }, { key: "loc", label: "loc" },
    { key: "goal", label: "goal", multiline: true, required: true }, { key: "conflict", label: "conflict", multiline: true }, { key: "outcome", label: "outcome", multiline: true },
    { key: "value_shift", label: "value", type: "object", fields: [
      { key: "value", label: "value" }, { key: "from", label: "from" }, { key: "to", label: "to" }, { key: "polarity", label: "polarity", type: "select", options: POLARITY },
    ] },
  ],
};
export const editSpecs = (kind: NodeKind): EditSpec[] => NODE_SCHEMA[kind] ?? [];

// ── Structural constants (single copy; were duplicated across DnaTreePage + dnaChat) ─────────────────────
export const KIND_LEVEL: Record<NodeKind, number> = {
  seed: 0, premise: 1, pillar: 2, character: 2, relationship: 2, tentpole: 2, world_fact: 2, voice_profile: 2, thread: 2, game: 2, movement: 3, beat: 4, scene: 5,
};
// The ladder's next kind down — drives the nested adds of a replace_children subtree.
export const LADDER_NEXT: Partial<Record<NodeKind, NodeKind>> = { movement: "beat", beat: "scene" };

// ── Content validation (the runtime shape check) ─────────────────────────────────────────────────────────
const isEmpty = (v: unknown): boolean => v == null || v === "" || (Array.isArray(v) && v.length === 0);
// Walk one node's content against its schema: required fields present, enums valid, list/refs really arrays.
// Recurses into object sub-fields. REF RESOLUTION is intentionally NOT here — that's relational (needs the
// whole tree) and already covered by novelDna's dangling_ref. `nodeId` lets callers attribute the issues.
function checkSpecs(specs: EditSpec[], content: Record<string, unknown>, kind: NodeKind, nodeId: string | undefined, partial: boolean): DnaIssue[] {
  const issues: DnaIssue[] = [];
  for (const spec of specs) {
    const raw = content?.[spec.key];
    if (spec.type === "object") {
      issues.push(...checkSpecs(spec.fields ?? [], (raw as Record<string, unknown>) ?? {}, kind, nodeId, partial));
      continue;
    }
    // partial = an edit PATCH: a field simply absent isn't "missing", it's "untouched" — only check what's set.
    if (spec.required && isEmpty(raw)) {
      if (!partial) issues.push({ rule: "missing_field", severity: "error", message: `${kind} is missing required "${spec.key}"`, nodeId });
      continue;
    }
    if (isEmpty(raw)) continue;
    if (spec.options && typeof raw === "string" && !spec.options.includes(raw)) {
      issues.push({ rule: "bad_enum", severity: "error", message: `${kind}.${spec.key} = "${raw}" is not one of ${spec.options.join(" | ")}`, nodeId });
    }
    if ((spec.type === "list" || spec.type === "refs") && !Array.isArray(raw)) {
      issues.push({ rule: "bad_shape", severity: "error", message: `${kind}.${spec.key} must be a list`, nodeId });
    }
  }
  return issues;
}

/** Validate a node's content against its kind's schema. Pure, tree-independent — safe at the generation
 *  boundary (reject malformed AI output) and for the completeness score. `partial` treats the content as an
 *  edit PATCH (absent required fields are untouched, not missing). Unknown kinds (no schema) pass. */
export function validateContent(kind: NodeKind, content: Record<string, unknown>, opts: { nodeId?: string; partial?: boolean } = {}): DnaIssue[] {
  return checkSpecs(NODE_SCHEMA[kind] ?? [], content ?? {}, kind, opts.nodeId, opts.partial ?? false);
}

/** The required field keys for a kind (top-level only — the load-bearing minimum). Drives the score. */
export const requiredKeys = (kind: NodeKind): string[] => (NODE_SCHEMA[kind] ?? []).filter((s) => s.required).map((s) => s.key);

/** A node's content completeness in [0,1]: required fields filled ÷ required fields. Kinds with no required
 *  fields are trivially complete (1). The atom the DNA strength/completeness score sums over. */
export function contentCompleteness(node: DnaNode): number {
  const keys = requiredKeys(node.kind);
  if (!keys.length) return 1;
  const filled = keys.filter((k) => !isEmpty((node.content as Record<string, unknown>)[k])).length;
  return filled / keys.length;
}

/** Whether a node carries every required field (used to gate "accept" and to detect placeholder nodes). */
export const isContentComplete = (node: DnaNode): boolean => validateContent(node.kind, node.content as Record<string, unknown>, { nodeId: node.id }).every((i) => i.rule !== "missing_field");

export const VALID_KINDS = new Set<string>(Object.keys(KIND_LEVEL));
export { isEntityKind };
