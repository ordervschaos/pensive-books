// agent-build-run — the headless APPLY driver for the DNA agent's build loop.
//
// The autonomous loop is split-brain: the book-agent edge fn proposes ONE change and idles; a watcher
// applies it and resumes. That watcher was React-only, so an automated build needed a browser tab. This
// is the Node driver, and it reuses BOTH halves of the real thing:
//   • the decision  — features/dna/lib/autoAccept.ts `nextAutoAction`, shared verbatim with the browser
//   • the apply     — features/dna/lib/agentThread.ts `applyAgentProposal`, imported as-is via the
//                     tsconfig paths swap of the supabase client (scripts/harness/tsconfig.json)
// so there is no Node twin of write logic to keep in sync.
//
// It authenticates as a REAL user (magic-link mint), not the service role, so RLS is exercised.
//
// HALT: the run stops at `stageComplete(nodes).premise` — the product's OWN gate (seed logline +
// premise accepted with a dramatic question). Prose is additionally halted at the layer level as a
// backstop. Nothing here writes prose.
//
//   pnpm dna:run --book 1339                          # drive an existing book to the premise gate
//   pnpm dna:run --task haunted-chatbot               # fresh scratch book from the fixture suite
//   pnpm dna:run --task haunted-chatbot --dry         # decide + log only, no writes
//   pnpm dna:run --book 1339 --max-steps 40
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { nextAutoAction } from "@/features/dna/lib/autoAccept";
import { answerAgent, applyAgentProposal, continueAgent, discardAgentProposal, sendAgentMessage, type AgentProposal } from "@/features/dna/lib/agentThread";
import { chooseNodeProposal } from "@/features/dna/lib/dnaProposals";
import { Author, type ScriptedAuthor } from "./harness/author.ts";
import { LlmAuthor, factsFrom } from "./harness/llmAuthor.ts";
import { OWNER, rest } from "./harness/env.ts";
import { describe, errText, ladder, loadBrief, loadNodes, loadThread, premiseProgress, variantReachedModel, waitForQuiescent } from "./harness/thread.ts";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const argVal = (f: string, d?: string) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : d; };
const DRY = args.includes("--dry");
const KEEP = args.includes("--keep");
// Auto mode means "the author is AWAY" — the agent picks its own options and is told not to ask. That is
// exactly the wrong mode for evaluating the premise rung, whose first sub-step is an INTERVIEW: with the
// author away there is no one to interview, so every variant scores the same. Default is author-present
// (a scripted author answers); pass --auto to evaluate the away path instead.
const AUTO = args.includes("--auto");
// The agent often asks its interview questions as plain prose rather than via the ask_author tool, which
// leaves the thread idle with nothing staged — a human would simply reply. The driver does the same, but
// bounded: an agent that keeps talking without ever staging a change must not loop forever.
const MAX_CHAT_REPLIES = Number(argVal("--max-chat", "8"));
// The author defaults to the LLM implementation: regex rules are coupled to how an agent PHRASES its
// questions, so they are not variant-neutral (a variant can win by matching patterns better). `--author
// regex` keeps the deterministic implementation for debugging a fixture.
const AUTHOR_KIND = argVal("--author", "llm");
// The A/B arm (book-agent/variants.ts). Set on the thread ROW rather than passed through the client, so
// the seam is entirely server-side and the browser path is untouched. Unset = production behaviour.
const VARIANT = argVal("--variant") ?? null;
const MAX_STEPS = Number(argVal("--max-steps", "60"));
const TASK_ID = argVal("--task");
const BOOK_ARG = Number(argVal("--book", "0"));

const stamp = () => new Date().toISOString().slice(11, 19);
const log = (m: string) => console.log(`[${stamp()}] ${m}`);

// Prose is out of scope: the premise gate should fire long before this, but keep it as a backstop so a
// misbehaving agent can never burn budget writing prose inside a premise-rung eval.
const HALT_LAYERS: AgentProposal["layer"][] = ["prose-render"];

interface Task { id: string; brief: Record<string, unknown>; author: ScriptedAuthor; opening?: string }

function loadTask(id: string): Task {
  const suite = JSON.parse(readFileSync(join(here, "eval-premise-tasks.json"), "utf8")) as { tasks: Task[] };
  const task = suite.tasks.find((t) => t.id === id);
  if (!task) throw new Error(`no task '${id}' — have: ${suite.tasks.map((t) => t.id).join(", ")}`);
  return task;
}

async function createScratchBook(task: Task): Promise<number> {
  const [book] = await rest<{ id: number }[]>("books", {
    method: "POST",
    body: JSON.stringify({ name: `[eval] premise — ${task.id}`, owner_id: OWNER, brief: task.brief, is_public: false }),
  });
  // A fresh book is minted with just a seed node (same shape as eval-logline.mjs's setupBook).
  await rest("book_nodes", {
    method: "POST",
    body: JSON.stringify([{ id: randomUUID(), book_id: book.id, parent_id: null, level: 0, kind: "seed", position: 0, content: {}, authoring: { source: "user" } }]),
  });
  log(`created scratch book ${book.id}`);
  return book.id;
}

async function main() {
  const task = TASK_ID ? loadTask(TASK_ID) : null;
  const bookId = BOOK_ARG || (task ? await createScratchBook(task) : 0);
  if (!bookId) throw new Error("need --book <id> or --task <id>");

  const script: ScriptedAuthor = task?.author ?? { default: "Use your judgement and keep going." };
  const author = AUTHOR_KIND === "regex"
    ? new Author(script)
    // Facts are derived from the SAME keyed answers the regex author uses — one source of truth for what
    // the author knows, so the two implementations can never disagree about the fixture.
    : new LlmAuthor({ facts: factsFrom(script), pushAfter: script.pushAfter, push: script.push });
  const startedAt = Date.now();
  const actions: { step: number; kind: string; detail: string }[] = [];

  let brief = await loadBrief(bookId);
  let nodes = await loadNodes(bookId);
  let progress = premiseProgress(nodes, brief);
  log(`book ${bookId} · author=${AUTHOR_KIND}${VARIANT ? ` · variant=${VARIANT}` : ""} · ${ladder(nodes)}`);
  log(`premise: ${progress.line}`);

  // Kick the thread off if there isn't one yet. `auto: true` arms autonomous mode server-side (the agent
  // makes ONE change per turn and idles) — this driver is the other half of that contract.
  let row = await loadThread(bookId);
  if (!row) {
    if (DRY) { log("no thread yet — dry run has nothing to observe"); return; }
    // Pre-create the thread row so it carries the variant BEFORE the first turn runs. sendAgentMessage
    // would otherwise create the row and chain immediately, and setting the arm afterwards would race —
    // turn 1 would run on the control prompt while the report claimed the variant. index.ts's
    // existing-thread branch appends the message without touching context_variant, so this sticks.
    if (VARIANT) {
      await rest("book_agent_runs", {
        method: "POST",
        body: JSON.stringify({ book_id: bookId, created_by: OWNER, kind: "thread", status: "idle", context_variant: VARIANT, transcript: [], steps: [] }),
      });
      log(`pre-created thread on arm '${VARIANT}'`);
    }
    const opening = task?.opening ?? "Let's build this book. Start at the beginning and work to a finished premise.";
    log(`starting thread — "${opening}" (auto=${AUTO})`);
    await sendAgentMessage(bookId, opening, undefined, undefined, AUTO);
    row = await waitForQuiescent(bookId);
  }

  // Stamp the arm on an EXISTING thread (the --book path, or a pre-create that raced). Idempotent: on the
  // pre-created path this just re-writes the same value. Kept outside the branch above so `--book <id>
  // --variant X` works too, which it did not when this only ran for brand-new threads.
  if (VARIANT && row && (row as { context_variant?: string | null }).context_variant !== VARIANT) {
    await rest(`book_agent_runs?id=eq.${row.id}`, { method: "PATCH", body: JSON.stringify({ context_variant: VARIANT }) });
    log(`stamped existing thread onto arm '${VARIANT}'`);
  }

  const claimed = new Set<string>();
  let step = 0;
  let chatReplies = 0;
  let stopReason = "max-steps";

  for (; step < MAX_STEPS; step++) {
    row = await waitForQuiescent(bookId);
    nodes = await loadNodes(bookId);
    brief = await loadBrief(bookId);
    progress = premiseProgress(nodes, brief);

    // The product's own gate — checked BEFORE acting, so the run stops the moment premise is complete
    // rather than one wasted turn later.
    if (progress.complete) { stopReason = "premise-complete"; break; }
    if (row.status === "error") { stopReason = `thread-error: ${row.error ?? "unknown"}`; break; }

    const action = nextAutoAction(row, nodes, claimed, { haltLayers: HALT_LAYERS });

    // "Nothing staged" while idle usually means the agent SPOKE — it asked its interview questions as
    // prose instead of calling ask_author, so there is no `pending` for the watcher to answer and the
    // thread simply waits for the next user message. A human replies; so does the scripted author. This
    // is harness-only behaviour and deliberately NOT in nextAutoAction: in the browser a person answers,
    // and the shared decision function must keep describing what the WATCHER does.
    if (action.kind === "none" && row.status === "idle") {
      const spoke = [...(row.steps ?? [])].reverse().find((s) => s.t === "note")?.label ?? "";
      if (spoke && chatReplies < MAX_CHAT_REPLIES) {
        chatReplies++;
        const reply = await author.answer(spoke);
        log(`${String(step + 1).padStart(2)}. agent spoke — replying as author (${chatReplies}/${MAX_CHAT_REPLIES})   [${progress.line}]`);
        log(`    ↳ agent: ${spoke.replace(/\s+/g, " ").slice(0, 140)}`);
        log(`    ↳ author: ${reply.slice(0, 140)}`);
        actions.push({ step: step + 1, kind: "reply", detail: `author replied to prose question` });
        await sendAgentMessage(bookId, reply, undefined, undefined, AUTO);
        continue;
      }
      if (spoke) { stopReason = `chat-reply-cap (${MAX_CHAT_REPLIES} replies, agent never staged a change)`; break; }
    }

    log(`${String(step + 1).padStart(2)}. ${describe(action)}   [${progress.line}]`);
    actions.push({ step: step + 1, kind: action.kind, detail: describe(action) });

    if (action.kind === "none") { stopReason = "agent-idle-nothing-staged"; break; }
    if (action.kind === "halt") { stopReason = `halted: ${action.reason}`; break; }
    if (DRY) { stopReason = "dry-run"; break; }

    claimed.add(action.key);
    if (action.kind === "answer") {
      const reply = await author.answer(action.question);
      log(`    ↳ author: ${reply.slice(0, 120)}`);
      await answerAgent(row.id, reply);
    } else if (action.kind === "apply") {
      // Mirror the browser watcher's contract exactly: a failed apply is DISCARDED (so the agent isn't
      // re-confronted with the same bad change) and the run is ALWAYS resumed — otherwise one un-appliable
      // proposal leaves the thread idle-stuck forever, since the watchdog only revives 'running'.
      try {
        await applyAgentProposal(bookId, row.id, action.proposal, action.all, nodes);
      } catch (e) {
        log(`    ↳ apply FAILED (${errText(e).slice(0, 200)}) — discarding`);
        await discardAgentProposal(row.id, action.proposal.id, action.all).catch(() => {});
      } finally {
        await continueAgent(row.id).catch(() => {});
      }
    } else {
      try { await chooseNodeProposal(action.node, action.proposalId, nodes); }
      catch (e) { log(`    ↳ choose FAILED (${errText(e).slice(0, 200)})`); }
      finally { await continueAgent(row.id).catch(() => {}); }
    }
  }

  nodes = await loadNodes(bookId);
  progress = premiseProgress(nodes, await loadBrief(bookId));
  const finalRow = await loadThread(bookId);
  const result = {
    bookId, taskId: task?.id ?? null, dry: DRY, auto: AUTO,
    // `authorKind`, not `author` — the latter is the author's METRICS object below, and declaring both
    // silently dropped which implementation was used (last key wins). An A/B report has to record that.
    authorKind: AUTHOR_KIND,
    // Read the arm BACK from the row rather than echoing the flag. If it failed to stick, the report must
    // say so — a mislabelled arm silently invalidates the entire comparison, which is the one error this
    // whole seam exists to prevent.
    variantRequested: VARIANT,
    variantApplied: (finalRow as { context_variant?: string | null } | null)?.context_variant ?? null,
    // Proof the arm reached the MODEL, not just the row. null = nothing to check.
    variantVerified: VARIANT ? await variantReachedModel(bookId, VARIANT) : null,
    stopReason, steps: step, chatReplies, wallClockMs: Date.now() - startedAt,
    turns: finalRow?.turns ?? null,
    premise: { complete: progress.complete, substeps: progress.substeps },
    ladder: ladder(nodes),
    author: { questions: author.questionCount, fallbackUses: author.fallbackUses, repeats: author.repeats, ambiguous: author.ambiguous, nudges: author.nudges, pushes: author.pushes, log: author.log },
    actions,
  };

  console.log("");
  log(`stop: ${stopReason} · ${step} steps · ${Math.round(result.wallClockMs / 1000)}s · turns=${result.turns}`);
  log(`premise: ${progress.line}  →  ${progress.complete ? "COMPLETE" : "incomplete"}`);
  if (author.questionCount) log(`author answered ${author.questionCount} question(s) (${chatReplies} in prose) · ${author.fallbackUses} fallback · ${author.nudges} nudge · ${author.pushes} push · ${author.repeats} repeat · ${author.ambiguous} ambiguous`);

  const out = join(here, `.agent-run-${bookId}.json`);
  writeFileSync(out, JSON.stringify(result, null, 2));
  log(`wrote ${out}`);
  // Machine-readable handoff for the suite runner (scripts/eval-suite.mts) — parsing human log lines for
  // the book id would break the first time the wording changed.
  console.log(`RESULT_JSON=${out}`);

  if (task && !KEEP && !DRY) log(`scratch book ${bookId} kept for grading — delete manually or re-run with a fresh --task`);
}

await main();
