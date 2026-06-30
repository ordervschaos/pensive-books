import { describe, expect, it } from "vitest";
import { validateOps, type NodeOp } from "@/lib/dnaChat";
import type { DnaNode, NodeKind } from "@/lib/novelDna";

const mk = (kind: NodeKind, over: Partial<DnaNode> = {}): DnaNode => ({
  id: over.id ?? "n", book_id: 1, parent_id: over.parent_id ?? null, level: 0, kind, position: 0,
  content: over.content ?? {}, authoring: over.authoring ?? { source: "ai", locked: false, status: "accepted" },
});

// A minimal valid spine: seed → premise → pillar (so entity adds have somewhere to attach).
const spine = (): DnaNode[] => [
  mk("seed", { id: "seed", content: { logline: "x" } }),
  mk("premise", { id: "prem", parent_id: "seed", content: { dramatic_question: "q?" } }),
  mk("pillar", { id: "pil", parent_id: "prem", content: { controlling_idea: "idea" } }),
];

describe("validateOps — the fail-closed boundary", () => {
  it("accepts a well-formed entity add", () => {
    const op: NodeOp = { op: "add", kind: "character", parentId: "pil", content: { name: "Finn" } };
    const { ok, rejected } = validateOps([op], spine());
    expect(ok).toHaveLength(1); expect(rejected).toHaveLength(0);
  });

  it("rejects an add missing a required field", () => {
    const op: NodeOp = { op: "add", kind: "character", parentId: "pil", content: { want: "freedom" } }; // no name
    const { ok, rejected } = validateOps([op], spine());
    expect(ok).toHaveLength(0);
    expect(rejected[0].reasons.join(" ")).toMatch(/required "name"/);
  });

  it("rejects an entity add when no pillar exists (no silent orphaning)", () => {
    const noPillar = [mk("seed", { id: "seed", content: { logline: "x" } }), mk("premise", { id: "prem", parent_id: "seed", content: { dramatic_question: "q?" } })];
    const op: NodeOp = { op: "add", kind: "character", parentId: "prem", content: { name: "Finn" } };
    const { ok, rejected } = validateOps([op], noPillar);
    expect(ok).toHaveLength(0);
    expect(rejected[0].reasons.join(" ")).toMatch(/no pillar/);
  });

  it("rejects edits to a locked node; a bad-enum patch is sanitized (not rejected), not a hard fault", () => {
    const nodes = [...spine(), mk("beat", { id: "b", parent_id: "pil", content: { summary: "s" }, authoring: { source: "ai", locked: true, status: "accepted" } })];
    expect(validateOps([{ op: "edit", id: "b", content: { summary: "new" } }], nodes).rejected[0].reasons.join(" ")).toMatch(/pinned/);
    const free = [...spine(), mk("beat", { id: "b2", parent_id: "pil", content: { summary: "s" } })];
    // an unknown enum is soft → sanitize strips it; the op still applies (no hard reject)
    expect(validateOps([{ op: "edit", id: "b2", content: { connector: "and-then" } }], free).ok).toHaveLength(1);
    expect(validateOps([{ op: "edit", id: "b2", content: { connector: "therefore" } }], free).ok).toHaveLength(1);
  });

  it("a capitalized role does NOT get a character rejected (the cast-ignored bug)", () => {
    const op: NodeOp = { op: "add", kind: "character", parentId: "pil", content: { name: "Finn", role: "Protagonist" } };
    expect(validateOps([op], spine()).ok).toHaveLength(1);
  });

  it("splits a mixed batch into ok + rejected", () => {
    const ops: NodeOp[] = [
      { op: "add", kind: "world_fact", parentId: "pil", content: { name: "Sea", rule: "tides" } }, // ok
      { op: "add", kind: "tentpole", parentId: "pil", content: {} },                                 // missing summary
    ];
    const { ok, rejected } = validateOps(ops, spine());
    expect(ok).toHaveLength(1); expect(rejected).toHaveLength(1);
  });

  // Acts are pillar-parented like entities — naming the premise is tolerated (re-homed onto the pillar
  // at apply), but the pillar must exist. This is the bug that put the spine's acts under the premise.
  it("accepts a act add/rebuild that names the premise (re-homed onto the pillar)", () => {
    const add: NodeOp = { op: "add", kind: "act", parentId: "prem", content: { title: "The Salt and the Leaving", goal: "Finn stows away" } };
    expect(validateOps([add], spine()).ok).toHaveLength(1);
    const rebuild: NodeOp = { op: "replace_children", parentId: "prem", childKind: "act", children: [{ content: { title: "Lowest Hand", goal: "Finn earns a place" } }] };
    expect(validateOps([rebuild], spine()).ok).toHaveLength(1);
  });

  it("rejects a act add when no pillar exists (no silent orphaning onto the premise)", () => {
    const noPillar = [mk("seed", { id: "seed", content: { logline: "x" } }), mk("premise", { id: "prem", parent_id: "seed", content: { dramatic_question: "q?" } })];
    const op: NodeOp = { op: "add", kind: "act", parentId: "prem", content: { title: "x" } };
    expect(validateOps([op], noPillar).rejected[0].reasons.join(" ")).toMatch(/no pillar/);
  });

  it("rejects a contextual rung attached to the wrong kind (beat must hang off a act, not the pillar)", () => {
    const op: NodeOp = { op: "add", kind: "beat", parentId: "pil", content: { summary: "s" } };
    expect(validateOps([op], spine()).rejected[0].reasons.join(" ")).toMatch(/must hang off act/);
  });
});
