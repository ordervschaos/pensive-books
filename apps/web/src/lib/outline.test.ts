import { describe, expect, it } from "vitest";
import {
  buildOutlineFromProposal, withNodeAdded, withNodeMoved, withNodePatch, withNodesRemoved,
  type Outline,
} from "@/lib/outline";

const base = (): Outline =>
  buildOutlineFromProposal(
    "Three-act",
    [
      { type: "section", title: "Act I" },
      { type: "scene", title: "Open", objective: "Hook" },
      { type: "scene", title: "Inciting", objective: "Disturb" },
    ],
    [{ name: "Locket", description: "setup→payoff", setupNodeIndex: 1, payoffNodeIndex: 2, targetDistance: 1000 }],
    "the spine",
  );

describe("buildOutlineFromProposal", () => {
  it("mints stable ids, starts rev at 1, compiled_rev 0, and resolves thread anchors by index", () => {
    const o = base();
    expect(o.rev).toBe(1);
    expect(o.compiled_rev).toBe(0);
    expect(o.nodes).toHaveLength(3);
    expect(o.nodes.every((n) => n.id.startsWith("n_"))).toBe(true);
    expect(o.threads[0].setupNodeId).toBe(o.nodes[1].id);
    expect(o.threads[0].payoffNodeId).toBe(o.nodes[2].id);
    expect(o.spine_hash).toBeTruthy();
  });
});

describe("pure node edits", () => {
  it("withNodePatch updates only the targeted node", () => {
    const o = base();
    const id = o.nodes[1].id;
    const next = withNodePatch(o, id, { objective: "Bigger hook" });
    expect(next.nodes[1].objective).toBe("Bigger hook");
    expect(next.nodes[2].objective).toBe("Disturb");
  });

  it("withNodeAdded inserts after the given node and returns the new id", () => {
    const o = base();
    const [next, newId] = withNodeAdded(o, { type: "scene", title: "Beat", objective: "x" }, o.nodes[1].id);
    expect(next.nodes).toHaveLength(4);
    expect(next.nodes[2].id).toBe(newId);
    expect(next.nodes[2].title).toBe("Beat");
  });

  it("withNodesRemoved drops nodes AND nulls thread anchors that pointed at them", () => {
    const o = base();
    const payoffId = o.nodes[2].id;
    const next = withNodesRemoved(o, [payoffId]);
    expect(next.nodes).toHaveLength(2);
    expect(next.threads[0].setupNodeId).toBe(o.nodes[1].id); // survives
    expect(next.threads[0].payoffNodeId).toBeNull(); // cleared
  });

  it("withNodeMoved reorders without losing nodes", () => {
    const o = base();
    const moved = withNodeMoved(o, o.nodes[2].id, 0);
    expect(moved.nodes[0].id).toBe(o.nodes[2].id);
    expect(moved.nodes).toHaveLength(3);
  });
});
