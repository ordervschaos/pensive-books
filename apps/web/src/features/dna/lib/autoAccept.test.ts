// Locks the decision tree that useAutoAccept used to inline. Two drivers now share it (the React watcher
// and scripts/agent-build-dryrun.mts), so a silent change here would desync the browser from the harness.
import { describe, expect, it } from "vitest";
import { nextAutoAction, optionKey } from "@/features/dna/lib/autoAccept";
import type { AgentProposal, AgentThreadRow } from "@/features/dna/lib/agentThread";
import type { DnaNode } from "@/features/dna/lib/novelDna";

const NONE = new Set<string>();

function row(over: Partial<AgentThreadRow>): AgentThreadRow {
  return { id: 7, status: "idle", pending: null, proposals: [], ...over } as unknown as AgentThreadRow;
}
function prop(id: string, layer: AgentProposal["layer"] = "dna"): AgentProposal {
  return { id, layer, summary: id, ops: [] };
}
function optNode(id: string, propId: string): DnaNode {
  return { id, proposals: [{ id: propId, content: {} }] } as unknown as DnaNode;
}

describe("nextAutoAction", () => {
  it("does nothing without a row", () => {
    expect(nextAutoAction(null, [], NONE).kind).toBe("none");
  });

  it("keeps hands off while the edge fn owns the row", () => {
    const r = row({ status: "running", proposals: [prop("p1")] });
    expect(nextAutoAction(r, [], NONE).kind).toBe("none");
  });

  it("answers a parked question before anything else", () => {
    const r = row({ status: "awaiting_input", pending: { question: "which ending?" }, proposals: [prop("p1")] });
    const a = nextAutoAction(r, [], NONE);
    expect(a).toMatchObject({ kind: "answer", key: "ask:7:which ending?", question: "which ending?" });
  });

  it("stops rather than falling through when the parked question is already claimed", () => {
    const r = row({ status: "awaiting_input", pending: { question: "q" }, proposals: [prop("p1")] });
    // Regression guard: the original code `return`ed here — it must NOT slide down to the apply branch,
    // which would apply a proposal while the run is still parked.
    expect(nextAutoAction(r, [], new Set(["ask:7:q"])).kind).toBe("none");
  });

  it("applies the first unclaimed proposal and carries the full list", () => {
    const all = [prop("p1"), prop("p2")];
    const a = nextAutoAction(row({ proposals: all }), [], new Set(["p1"]));
    expect(a).toMatchObject({ kind: "apply", key: "p2" });
    if (a.kind !== "apply") throw new Error("expected apply");
    expect(a.proposal.id).toBe("p2");
    expect(a.all).toHaveLength(2); // resolveProposal needs the unfiltered set
  });

  it("falls back to staged node options once proposals are exhausted", () => {
    const n = optNode("n1", "o1");
    const a = nextAutoAction(row({ proposals: [prop("p1")] }), [n], new Set(["p1"]));
    expect(a).toMatchObject({ kind: "choose", key: "opt:n1:o1", proposalId: "o1" });
  });

  it("keys options by the staged set's first id, so a regenerate isn't permanently skipped", () => {
    const n = optNode("n1", "o2"); // same node, freshly regenerated options
    expect(optionKey(n)).toBe("opt:n1:o2");
    expect(nextAutoAction(row({}), [n], new Set(["opt:n1:o1"])).kind).toBe("choose");
  });

  it("does nothing when idle with nothing staged", () => {
    expect(nextAutoAction(row({}), [], NONE).kind).toBe("none");
  });

  it("halts instead of applying a proposal in a halted layer", () => {
    const a = nextAutoAction(row({ proposals: [prop("p1", "prose-render")] }), [], NONE, { haltLayers: ["prose-render"] });
    expect(a).toMatchObject({ kind: "halt", key: "p1" });
  });

  it("still applies structural layers when prose is halted", () => {
    const opts = { haltLayers: ["prose-render"] as AgentProposal["layer"][] };
    expect(nextAutoAction(row({ proposals: [prop("p1", "dna")] }), [], NONE, opts).kind).toBe("apply");
    // sketch rides the expansion layer — it is structural and must survive the prose halt.
    expect(nextAutoAction(row({ proposals: [prop("p2", "expansion")] }), [], NONE, opts).kind).toBe("apply");
  });

  it("applies prose normally when no halt is configured (the browser watcher's behaviour)", () => {
    expect(nextAutoAction(row({ proposals: [prop("p1", "prose-render")] }), [], NONE).kind).toBe("apply");
  });
});
