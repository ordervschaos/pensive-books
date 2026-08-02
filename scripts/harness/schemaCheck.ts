// schemaCheck — does the tree the agent produced actually CONFORM to the content schema?
//
// Why this is a grader family and not a footnote: a schema violation shows up in the judge scores as a
// LOW SCORE, which reads as "the writing got worse" and sends you hunting the wrong thing. It happened —
// `premise.shape.movements` changed from `["She arrives at the tower…"]` to
// `[{description: "She arrives…"}]`, and `read-premise` dropped from 4.86 to 2.29 with four axes pinned at
// 1. Nothing was wrong with the prose; the judge simply could not read the field. Diagnosing that took
// twenty minutes of hand-querying. A grader that prints
//   premise.shape.movements: expected a list of strings, got objects
// turns that into one line.
//
// Two layers:
//   1. The app's own `validateContent` — missing required fields, bad enums, list-vs-scalar.
//   2. LIST ELEMENT types, which validateContent does NOT check: `checkSpecs` verifies a list IS an array
//      but never inspects what's inside, so a `string[]` field silently accepts objects. The rule used here
//      is structural, not hardcoded per field: a spec of `type:"list"` with no `fields[]` declares a list of
//      PRIMITIVES, so object elements are a violation. That generalises to every list in NODE_SCHEMA
//      rather than special-casing `movements`.
import { editSpecs, validateContent, type EditSpec } from "@/features/dna/lib/dnaSchema";
import type { DnaNode, NodeKind } from "@/features/dna/lib/novelDna";

export interface SchemaViolation {
  nodeId: string;
  kind: string;
  path: string;
  rule: string;
  message: string;
}

/** Walk specs alongside content, collecting list-element-type violations at any depth. */
function walkLists(specs: EditSpec[], content: Record<string, unknown>, prefix: string, out: Omit<SchemaViolation, "nodeId" | "kind">[]): void {
  for (const spec of specs) {
    const raw = content?.[spec.key];
    const path = prefix ? `${prefix}.${spec.key}` : spec.key;
    if (spec.type === "object") {
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        walkLists(spec.fields ?? [], raw as Record<string, unknown>, path, out);
      }
      continue;
    }
    if (spec.type !== "list" || !Array.isArray(raw) || raw.length === 0) continue;
    // A list WITH declared sub-fields is a list of objects by design — leave it alone.
    if (spec.fields?.length) continue;
    const objectEls = raw.filter((el) => el !== null && typeof el === "object");
    if (objectEls.length) {
      const sample = JSON.stringify(objectEls[0]).slice(0, 120);
      out.push({
        path,
        rule: "list_element_type",
        message: `expected a list of strings, got ${objectEls.length}/${raw.length} object(s) — e.g. ${sample}`,
      });
    }
  }
}

/**
 * Every schema violation in a book's tree. Deterministic and free — it should run on every graded run, not
 * only when something looks wrong, because the whole point is that a violation does NOT look like a
 * violation from the scores alone.
 */
export function schemaViolations(nodes: DnaNode[]): SchemaViolation[] {
  const out: SchemaViolation[] = [];
  for (const n of nodes) {
    const content = (n.content ?? {}) as Record<string, unknown>;
    // An untouched placeholder is not a violation — the tree is deliberately dense with empty slots.
    if (!Object.keys(content).length) continue;
    const specs = editSpecs(n.kind as NodeKind);
    if (!specs.length) continue;

    for (const issue of validateContent(n.kind as NodeKind, content, { nodeId: n.id })) {
      // `missing_field` on a partially-built tree is progress, not corruption — the journey gate already
      // measures completeness, and double-reporting it here would drown the shape faults that matter.
      if (issue.rule === "missing_field") continue;
      out.push({ nodeId: n.id, kind: n.kind, path: n.kind, rule: issue.rule, message: issue.message });
    }

    const listIssues: Omit<SchemaViolation, "nodeId" | "kind">[] = [];
    walkLists(specs, content, "", listIssues);
    for (const li of listIssues) out.push({ nodeId: n.id, kind: n.kind, ...li });
  }
  return out;
}
