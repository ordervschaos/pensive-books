// autoAccept — the DECISION half of auto-accept mode, split out of useAutoAccept so it has exactly one
// implementation with two drivers: the React watcher (hooks/useAutoAccept.ts) in the browser, and the
// headless build harness (scripts/agent-build-dryrun.mts) in Node.
//
// Why split at all: the agent's autonomous build loop is split-brain — the edge fn proposes ONE change and
// idles; whoever is watching applies it and resumes the run. That watcher was React-only, so an automated
// build required a browser tab. Porting the *apply* engine to Node would mint a third twin of write logic;
// porting the ~40 lines of "what should happen next" costs nothing and is the only part that would have been
// duplicated. So: this file decides, the caller acts.
//
// PURE. No side effects, no I/O, no React, and every import is `import type` (erased at compile time) — so
// tsx/esbuild can load it from a plain Node script without resolving the `@/` alias at runtime.
import type { AgentProposal, AgentThreadRow } from "@/features/dna/lib/agentThread";
import type { DnaNode } from "@/features/dna/lib/novelDna";

export const AUTO_ANSWER =
  "I'm away — auto-accept mode is on, so I can't answer. Make the strongest creative call yourself and keep going.";

// What the watcher should do next. `key` is the exactly-once claim token: the caller records it BEFORE acting
// so a stale row snapshot can't re-present an already-applied proposal (which would re-run an `add` op and
// duplicate nodes), and a poison item can't hot-loop.
export type AutoAction =
  | { kind: "answer"; key: string; question: string }
  | { kind: "apply"; key: string; proposal: AgentProposal; all: AgentProposal[] }
  | { kind: "choose"; key: string; node: DnaNode; proposalId: string }
  // The next real action was deliberately not taken because its layer is in `haltLayers`. Distinct from
  // "none" (nothing to do) so a harness can stop and say WHY it stopped rather than reporting completion.
  | { kind: "halt"; key: string; reason: string; proposal: AgentProposal }
  | { kind: "none" };

// Options staged ON a node are keyed by the staged set's FIRST proposal id (fresh on every regeneration),
// not by node id — so a later regenerate on the same node isn't permanently skipped by an old claim.
export function optionKey(node: DnaNode): string {
  return `opt:${node.id}:${node.proposals![0].id}`;
}

export function nextAutoAction(
  row: AgentThreadRow | null | undefined,
  nodes: DnaNode[],
  claimed: ReadonlySet<string>,
  opts: { haltLayers?: AgentProposal["layer"][] } = {},
): AutoAction {
  if (!row) return { kind: "none" };
  if (row.status === "running") return { kind: "none" }; // the edge fn owns the row — keep hands off

  const proposals = (Array.isArray(row.proposals) ? row.proposals : []).filter((p) => !claimed.has(p.id));
  const optionNode = nodes.find(
    (n) => Array.isArray(n.proposals) && n.proposals.length > 0 && !claimed.has(optionKey(n)),
  );

  if (row.status === "awaiting_input" && row.pending) {
    // A parked question: unblock it. (In true auto mode the agent never asks; this catches a run already
    // parked when auto was armed, or a model that ignored the no-ask instruction.)
    const key = `ask:${row.id}:${row.pending.question}`;
    if (claimed.has(key)) return { kind: "none" };
    return { kind: "answer", key, question: row.pending.question };
  }

  if (row.status === "idle" && proposals.length) {
    const proposal = proposals[0];
    if (opts.haltLayers?.includes(proposal.layer)) {
      return { kind: "halt", key: proposal.id, reason: `layer '${proposal.layer}' is halted`, proposal };
    }
    return { kind: "apply", key: proposal.id, proposal, all: (row.proposals ?? []) as AgentProposal[] };
  }

  if (row.status === "idle" && optionNode) {
    return { kind: "choose", key: optionKey(optionNode), node: optionNode, proposalId: optionNode.proposals![0].id };
  }

  return { kind: "none" };
}
