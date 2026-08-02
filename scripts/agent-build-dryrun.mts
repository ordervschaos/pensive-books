// agent-build-dryrun — the OBSERVE-ONLY view of the agent's build loop.
//
// Answers "what would the auto-accept watcher do right now?" without touching anything. Shares both the
// decision function (features/dna/lib/autoAccept.ts) and the reads (scripts/harness/thread.ts) with the
// applying driver (agent-build-run.mts), so all three agree on what the thread looks like.
//
// Use this to inspect a live thread — including one a browser is actively driving — since it is
// read-only by construction. To actually drive a build, use `pnpm dna:run`.
//
//   pnpm dna:dryrun 1339              # what would the watcher do right now?
//   pnpm dna:dryrun 1339 --queue      # enumerate everything it would do over this snapshot
//   pnpm dna:dryrun 1339 --watch      # poll every 5s, print when the decision changes
import { nextAutoAction } from "@/features/dna/lib/autoAccept";
import type { AgentProposal } from "@/features/dna/lib/agentThread";
import { describe, ladder, loadBrief, loadNodes, loadThread, premiseProgress } from "./harness/thread.ts";

const args = process.argv.slice(2);
const bookId = Number(args.find((a) => /^\d+$/.test(a)));
if (!bookId) throw new Error("usage: pnpm dna:dryrun <bookId> [--queue] [--watch[=seconds]]");
const mode = args.includes("--queue") ? "queue" : args.find((a) => a.startsWith("--watch")) ? "watch" : "once";
const watchSecs = Number(args.find((a) => a.startsWith("--watch="))?.split("=")[1] ?? 5);

// Prose is out of scope for this harness — stop at the structural ceiling.
const HALT_LAYERS: AgentProposal["layer"][] = ["prose-render"];

async function snapshot() {
  const [row, nodes, brief] = await Promise.all([loadThread(bookId), loadNodes(bookId), loadBrief(bookId)]);
  return { row, nodes, progress: premiseProgress(nodes, brief) };
}

async function decideOnce() {
  const { row, nodes, progress } = await snapshot();
  if (!row) { console.log(`book ${bookId}: no agent thread yet`); return null; }
  console.log(`thread ${row.id} · status=${row.status} · auto=${row.context_auto ?? false} · staged=${(row.proposals ?? []).length}`);
  console.log(`tree: ${ladder(nodes)}`);
  console.log(`premise: ${progress.line}${progress.complete ? "  → COMPLETE" : ""}`);
  const action = nextAutoAction(row, nodes, new Set(), { haltLayers: HALT_LAYERS });
  console.log(`→ ${describe(action)}`);
  return { row, action };
}

// Walk the CURRENT snapshot, claiming each decision in turn — enumerates queued work without touching
// anything. It cannot see past this snapshot (each real apply changes what the agent proposes next), so
// this is depth-now, not the whole build.
async function decideQueue() {
  const { row, nodes, progress } = await snapshot();
  if (!row) { console.log(`book ${bookId}: no agent thread yet`); return; }
  console.log(`thread ${row.id} · status=${row.status} · auto=${row.context_auto ?? false}`);
  console.log(`tree: ${ladder(nodes)}`);
  console.log(`premise: ${progress.line}\n`);
  const claimed = new Set<string>();
  for (let i = 1; ; i++) {
    const action = nextAutoAction(row, nodes, claimed, { haltLayers: HALT_LAYERS });
    console.log(`${String(i).padStart(2)}. ${describe(action)}`);
    if (action.kind === "none" || action.kind === "halt") break;
    claimed.add(action.key);
  }
}

if (mode === "queue") {
  await decideQueue();
} else if (mode === "watch") {
  console.log(`watching book ${bookId} every ${watchSecs}s — read-only, Ctrl-C to stop\n`);
  let last = "";
  for (;;) {
    const out = await decideOnce().catch((e) => { console.error(String(e)); return null; });
    const sig = out ? `${out.row.status}:${describe(out.action)}` : "none";
    if (sig !== last) { console.log(`   [${new Date().toISOString()}]\n`); last = sig; }
    await new Promise((r) => setTimeout(r, watchSecs * 1000));
  }
} else {
  await decideOnce();
}
