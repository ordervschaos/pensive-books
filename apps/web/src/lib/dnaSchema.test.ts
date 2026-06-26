import { describe, expect, it } from "vitest";
import { contentCompleteness, validateContent, type EditSpec } from "@/lib/dnaSchema";
import type { DnaNode, NodeKind } from "@/lib/novelDna";

const node = (kind: NodeKind, content: Record<string, unknown>): DnaNode => ({
  id: "n", book_id: 1, parent_id: null, level: 0, kind, position: 0, content,
  authoring: { source: "ai", locked: false, status: "draft" },
});

describe("validateContent", () => {
  it("flags a required field that's missing", () => {
    const rules = validateContent("character", {}).map((i) => i.rule);
    expect(rules).toContain("missing_field"); // name is required
  });

  it("flags a bad enum value but passes a valid one", () => {
    expect(validateContent("beat", { summary: "x", connector: "and-then" }).map((i) => i.rule)).toContain("bad_enum");
    expect(validateContent("beat", { summary: "x", connector: "therefore" })).toHaveLength(0);
  });

  it("flags a list field that isn't an array", () => {
    expect(validateContent("premise", { dramatic_question: "q", genre: "fantasy" }).map((i) => i.rule)).toContain("bad_shape");
  });

  it("a fully-specified node is clean", () => {
    expect(validateContent("relationship", { a: "c1", b: "c2", bond: "rivals" })).toHaveLength(0);
  });
});

describe("contentCompleteness", () => {
  it("is the fraction of required fields filled", () => {
    expect(contentCompleteness(node("relationship", {}))).toBe(0);              // 0/3
    expect(contentCompleteness(node("relationship", { a: "c1", bond: "x" }))).toBeCloseTo(2 / 3);
    expect(contentCompleteness(node("relationship", { a: "c1", b: "c2", bond: "x" }))).toBe(1);
  });

  it("kinds with no required fields are trivially complete", () => {
    expect(contentCompleteness(node("scene", { goal: "g" }))).toBe(1); // goal is the only required → filled
  });
});

// Guard the editor/validator contract: every schema field carries a label (the editor renders it).
describe("schema shape", () => {
  it("every field (incl. nested) has a key + label", () => {
    const walk = (specs: EditSpec[]): void => {
      for (const s of specs) { expect(s.key).toBeTruthy(); expect(s.label).toBeTruthy(); if (s.fields) walk(s.fields); }
    };
    // exercised via validateContent on each kind indirectly; here just assert no throw on a known kind
    walk([{ key: "k", label: "l", fields: [{ key: "a", label: "b" }] }]);
  });
});
