import { describe, expect, it } from "vitest";
import { humanizeNodeRefs, validateOps, type NodeOp } from "@/features/dna/lib/dnaChat";
import { byId, type DnaNode, type NodeKind } from "@/features/dna/lib/novelDna";

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

  // The nested-seed deviation: a SEED is a root, never added under another node.
  it("rejects adding a SEED under another node (roots can't be nested)", () => {
    const op: NodeOp = { op: "add", kind: "seed", parentId: "seed", content: { logline: "dupe" } };
    expect(validateOps([op], spine()).rejected[0].reasons.join(" ")).toMatch(/tree root/);
  });

  // The duplicate-premise half of the deviation: singleton spine kinds are unique per book.
  it("rejects adding a second premise/pillar/voice_profile (singletons)", () => {
    const dupePremise: NodeOp = { op: "add", kind: "premise", parentId: "seed", content: { dramatic_question: "q2?" } };
    expect(validateOps([dupePremise], spine()).rejected[0].reasons.join(" ")).toMatch(/already exists/);
    const dupePillar: NodeOp = { op: "add", kind: "pillar", parentId: "prem", content: { controlling_idea: "i2" } };
    expect(validateOps([dupePillar], spine()).rejected[0].reasons.join(" ")).toMatch(/already exists/);
  });

  // But the FIRST of a singleton kind still lands (bootstrapping a bare tree).
  it("accepts the first premise when none exists yet", () => {
    const seedOnly = [mk("seed", { id: "seed", content: { logline: "x" } })];
    const op: NodeOp = { op: "add", kind: "premise", parentId: "seed", content: { dramatic_question: "q?" } };
    expect(validateOps([op], seedOnly).ok).toHaveLength(1);
  });

  it("rejects a contextual rung attached to the wrong kind (beat must hang off a act, not the pillar)", () => {
    const op: NodeOp = { op: "add", kind: "beat", parentId: "pil", content: { summary: "s" } };
    expect(validateOps([op], spine()).rejected[0].reasons.join(" ")).toMatch(/must hang off act/);
  });
});

describe("humanizeNodeRefs — rehydrate bare node-ids into human labels", () => {
  const index = byId([
    mk("scene", { id: "n_abc123", content: { title: "Bram's door" } }),
    mk("character", { id: "n_finn01", content: { name: "Finn" } }),
  ]);

  it("replaces a bare id with the node's label", () => {
    expect(humanizeNodeRefs("Rendered [n_abc123].", index)).toBe("Rendered Bram's door.");
  });

  it("drops a trailing parenthetical that just repeats the label", () => {
    expect(humanizeNodeRefs("Rendered Scene [n_abc123] (Bram's door).", index)).toBe("Rendered Scene Bram's door.");
  });

  it("keeps a genuine side-note parenthetical", () => {
    expect(humanizeNodeRefs("Edited [n_finn01] (added a wound).", index)).toBe("Edited Finn (added a wound).");
  });

  it("falls back to the parenthetical for an unknown/deleted id", () => {
    expect(humanizeNodeRefs("Removed [n_gone99] (old scene).", index)).toBe("Removed old scene.");
  });

  it("leaves an unknown id with no parenthetical untouched", () => {
    expect(humanizeNodeRefs("Removed [n_gone99].", index)).toBe("Removed [n_gone99].");
  });

  it("resolves multiple refs in one string", () => {
    expect(humanizeNodeRefs("[n_finn01] enters [n_abc123].", index)).toBe("Finn enters Bram's door.");
  });
});
