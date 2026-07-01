import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { NODE_SCHEMA } from "@/features/dna/lib/dnaSchema";

// DIGEST_FIELDS in book-agent/index.ts is a THIRD hand-maintained mirror of the node schema (the other
// two: novelDna.ts's content interfaces, and the generated dna-schema.json checked by
// dnaSchema.artifact.test.ts). It picks which fields of each node kind show in the agent's per-turn tree
// digest. Unlike the generated artifact, nothing enforced it stayed in sync — it once listed a field
// ("title") that doesn't exist on tentpole at all, and omitted required fields (world_fact.rule,
// voice_profile.style, game.win_condition/lose_condition) that the digest exists to surface. This test
// is the lock: every DIGEST_FIELDS entry must reference real fields, and must cover every REQUIRED field
// of that kind, so the digest can never silently go stale on a schema change again.
//
// Validated against NODE_SCHEMA directly (not the editSpecs-derived artifact `kinds[].fields`), because
// that derived list drops `genOnly` fields (causality/meter data the AI sets but the manual tree editor
// doesn't render a form for) — and DIGEST_FIELDS deliberately DOES surface those (a beat's `needs`/
// `establishes`/etc ARE the "causal + meter spine" the digest exists to show).
const BOOK_AGENT_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../../supabase/functions/book-agent/index.ts");

function parseDigestFields(source: string): Record<string, string[]> {
  const m = source.match(/const DIGEST_FIELDS: Record<string, string\[\]> = \{([\s\S]*?)\n\};/);
  if (!m) throw new Error("DIGEST_FIELDS block not found in book-agent/index.ts — did it get renamed or restructured?");
  const out: Record<string, string[]> = {};
  const lineRe = /^\s*(\w+):\s*\[(.*)\],?\s*$/gm;
  let line: RegExpExecArray | null;
  while ((line = lineRe.exec(m[1]))) {
    const [, kind, list] = line;
    out[kind] = [...list.matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  }
  return out;
}

// A required field the digest covers through a mechanism OTHER than DIGEST_FIELDS's pickFields — so its
// absence from DIGEST_FIELDS[kind] is fine. Only one today: digestNode() special-cases "beat" to prepend
// gistLine(content) — the first sentence of content.summary — ahead of the picked spine fields.
const REQUIRED_COVERED_ELSEWHERE: Record<string, string[]> = { beat: ["summary"] };

// Fields DIGEST_FIELDS legitimately shows that NODE_SCHEMA doesn't declare for that kind — because
// NODE_SCHEMA is the WRITE contract (what the AI independently authors / the tree editor renders a form
// for), while these are READ-ONLY, mechanically INHERITED from the parent beat (never independently set
// via propose_node_ops — see realizeScenesFromBeat in dnaExpand.ts). DIGEST_FIELDS's job is to surface
// whatever's useful to REASON about, which correctly includes inherited relational data NODE_SCHEMA has
// no reason to list. See SceneContent in novelDna.ts ("inherited from its beat").
const INHERITED_NOT_IN_SCHEMA: Record<string, string[]> = { scene: ["needs", "establishes", "grounds_in"] };

describe("book-agent DIGEST_FIELDS ↔ NODE_SCHEMA", () => {
  const source = readFileSync(BOOK_AGENT_PATH, "utf8");
  const digestFields = parseDigestFields(source);

  it("every DIGEST_FIELDS kind exists in NODE_SCHEMA", () => {
    for (const kind of Object.keys(digestFields)) {
      expect(NODE_SCHEMA, `DIGEST_FIELDS has an unknown kind "${kind}"`).toHaveProperty(kind);
    }
  });

  it("every DIGEST_FIELDS entry names only real (or documented-inherited) fields on that kind", () => {
    for (const [kind, fields] of Object.entries(digestFields)) {
      const spec = NODE_SCHEMA[kind as keyof typeof NODE_SCHEMA] ?? [];
      const real = new Set([...spec.map((s) => s.key), ...(INHERITED_NOT_IN_SCHEMA[kind] ?? [])]);
      for (const field of fields) {
        expect(real.has(field), `DIGEST_FIELDS.${kind} names "${field}", which isn't a field on ${kind} (schema fields: ${[...real].join(", ")})`).toBe(true);
      }
    }
  });

  it("every DIGEST_FIELDS entry covers that kind's REQUIRED fields (or a documented exception)", () => {
    for (const [kind, spec] of Object.entries(NODE_SCHEMA)) {
      const shown = new Set([...(digestFields[kind] ?? []), ...(REQUIRED_COVERED_ELSEWHERE[kind] ?? [])]);
      for (const field of spec ?? []) {
        if (!field.required) continue;
        expect(shown.has(field.key), `DIGEST_FIELDS.${kind} is missing required field "${field.key}" — the agent's standing tree view omits it`).toBe(true);
      }
    }
  });
});
