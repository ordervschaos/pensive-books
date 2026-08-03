// book-agent transcript helpers: pure functions over the stored message array — context compaction,
// the auto-continue / force-commit sentinels, and the request-time cache-breakpoint + book-state shaping.
import { type AgentStep, type Finding } from "./shared.ts";
import { VERIFY_SENTINEL } from "./verify.ts";

// ── Context compaction ──
// A long run's transcript accumulates every read_node/search_nodes result — 14 full scene reads is
// ~200k chars (~50k tokens) re-sent on EVERY subsequent call. Observed on book 1229: once the prompt
// crossed ~60k tokens, most MuleRouter calls blew the 140s timeout (uncached prefill + reasoning) and
// the loop crawled at one successful turn per ~4 attempts. Once the transcript outgrows COMPACT_OVER,
// stub the bulky tool_result bodies in every tool-results message EXCEPT the newest BULKY one — the
// model's current working set stays intact, older reads become a one-line pointer it can re-read on
// demand (the live tree digest is always in <book_state> anyway). Keyed to the newest BULKY message,
// not a trailing-message count and not just any tool_result: batched turns pack a whole read sweep
// into ONE huge message, so a count-based window protects everything or nothing (the v1 bug — a count
// of 6 protected the entire 7-message transcript); and the post-apply "✓ Applied" ACK is itself a tiny
// tool_result message, so "newest tool message" flipped to the ack right after every apply and pruned
// the read sweep the model still needed — it then re-read everything, fixed one thing, lost it again
// (the v2 bug, caught live as a search/read/apply/re-read loop). Only a message actually CARRYING big
// results claims protection. Blocks are REPLACED, never removed, so tool_use ↔ tool_result pairing
// survives. Deterministic, so a retried link re-derives the identical transcript.
const COMPACT_OVER = 120_000; // chars of transcript JSON (~30k tokens) before pruning kicks in
const STUB_OVER = 700;        // only stub results bigger than this (small acks/errors aren't worth it)

function compactTranscript(transcript: unknown[]): unknown[] {
  if (JSON.stringify(transcript).length <= COMPACT_OVER) return transcript;
  // deno-lint-ignore no-explicit-any
  const hasBulkyResults = (m: any) =>
    m?.role === "user" && Array.isArray(m.content) &&
    // deno-lint-ignore no-explicit-any
    m.content.some((b: any) => b?.type === "tool_result" && typeof b.content === "string" && b.content.length > STUB_OVER && !b.content.includes("[PRUNED"));
  const newestToolMsg = transcript.reduce<number>((acc, m, i) => (hasBulkyResults(m) ? i : acc), -1);
  let changed = false;
  const out = transcript.map((m, i) => {
    if (i >= newestToolMsg || !hasBulkyResults(m)) return m;
    let msgChanged = false;
    // deno-lint-ignore no-explicit-any
    const content = ((m as { content: any[] }).content).map((b) => {
      if (b?.type !== "tool_result" || typeof b.content !== "string" || b.content.length <= STUB_OVER) return b;
      if (b.content.includes("[PRUNED")) return b; // already stubbed on a prior pass
      msgChanged = true;
      return { ...b, content: `${b.content.slice(0, 80)}… [PRUNED — an older full read, removed to keep context small. What you DISTILLED from it survives in <findings>; the live tree is in <book_state>. Only read_node/search_nodes again if you need detail neither carries.]` };
    });
    if (!msgChanged) return m;
    changed = true;
    return { ...(m as Record<string, unknown>), content };
  });
  return changed ? out : transcript;
}

// Sentinel prefixing the one-shot "act or finish" prod injected when an AUTONOMOUS turn ends with
// prose and no tool call. Its presence in the previous user message means the model stalled twice
// in a row — then the run goes idle honestly instead of prodding forever.
const AUTO_CONTINUE_SENTINEL = "[auto-continue]";

// Hard backstop for the gather-forever failure mode observed live on book 1229 (2026-07-09): a lint
// with hits scattered across a dozen+ scenes made the agent try to build a "complete inventory"
// before proposing anything — the compaction window prunes earlier reads before they're ever used,
// so it re-reads forever (one run hit 125 steps / 15 turns / 0 applies). Prompt guidance alone
// ("batch, don't sweep") cut the rate but didn't stop it — this forces a commit once reads run too
// long uninterrupted by any propose_*/finish.
const FORCE_COMMIT_AFTER_READS = 15;
const FORCE_COMMIT_SENTINEL = "[force-commit]";

// ── Fold-on-read (doc_1785773301000.md) ──
// The backstop above treats the symptom; the CAUSE is that the transcript is the run's only working
// memory and also the one buffer we must prune — so a read's content has nowhere durable to live and
// compaction is amnesia. record_findings gives it a home: the model distills a read WHILE the content
// is still in context, and the distillation lands in `steps` (never pruned) as a 'finding' step.
// Compaction then costs nothing it needed. Same move as node.authoring.prose_digest on the continuity
// axis: fold, don't accumulate.
//
// The ledger rides in <book_state> (request-time, never persisted), so it does NOT break the cached
// prefix — that block is already paid uncached every turn. Capped so a very long run can't turn the
// cure into the disease; the newest findings win because they describe the part of the book in play.
const FINDINGS_CAP = 60;

// Every finding recorded this run, oldest first, as a <findings> block for withBookState — or "" when
// nothing has been recorded yet (so an unused ledger costs zero prompt bytes).
function findingsBlock(steps: AgentStep[]): string {
  const all: Finding[] = [];
  for (const s of steps) {
    if (s.t !== "finding" || !Array.isArray(s.findings)) continue;
    for (const f of s.findings) {
      const ref = String(f?.ref ?? "").trim();
      const finding = String(f?.finding ?? "").trim();
      if (finding) all.push({ ref, finding });
    }
  }
  if (!all.length) return "";
  const kept = all.slice(-FINDINGS_CAP);
  const dropped = all.length - kept.length;
  const lines = kept.map((f) => (f.ref ? `${f.ref} — ${f.finding}` : f.finding));
  const note = dropped ? ` (${dropped} older finding${dropped === 1 ? "" : "s"} dropped)` : "";
  return `<findings note="what YOU already learned from reads this run${note} — the raw reads behind these may have been pruned from the messages above, but this survives. TRUST IT: do not re-read a node just to recover something recorded here.">\n${lines.join("\n")}\n</findings>`;
}

// Trailing 'read' steps since the last commit-shaped step (plan/done/decision/answer/ask/user) — this
// feeds the force-commit watchdog, so 'finding' must NOT reset it: recording what you read is not
// committing a change, and treating it as one would let a run read→record→read→record forever with the
// watchdog permanently re-armed. 'note' (a turn's own narration) doesn't reset it either.
function trailingReadRun(steps: AgentStep[]): number {
  let n = 0;
  for (let i = steps.length - 1; i >= 0; i--) {
    const t = steps[i].t;
    if (t === "read") { n++; continue; }
    if (t === "note" || t === "finding") continue;
    break;
  }
  return n;
}

// Trailing 'read' steps whose content has NOT been distilled yet — same walk, but a 'finding' step
// resets it. Deliberately a SEPARATE counter from trailingReadRun (which only commits reset), so the
// record nudge and the force-commit watchdog can't cancel each other out.
function unrecordedReadRun(steps: AgentStep[]): number {
  let n = 0;
  for (let i = steps.length - 1; i >= 0; i--) {
    const t = steps[i].t;
    if (t === "read") { n++; continue; }
    if (t === "note") continue;
    break; // 'finding' included: everything before it is already distilled
  }
  return n;
}

// Nudge threshold for the ledger. Well under FORCE_COMMIT_AFTER_READS so the sequence is
// read…→ "record what you learned" → read…→ forced commit: the run banks its findings BEFORE the
// watchdog makes it commit under amnesia.
const RECORD_FINDINGS_AFTER_READS = 6;
const RECORD_FINDINGS_SENTINEL = "[record-findings]";

// Request-time cache breakpoints (never stored in the row, so they don't accumulate past the API's
// limit of 4): one on the big first user message, one on the last block of the latest message —
// each link re-reads the whole prefix from cache and only pays for the newest turn.
function withCacheBreakpoints(transcript: unknown[]): unknown[] {
  // deno-lint-ignore no-explicit-any
  const msgs = transcript.map((m) => ({ ...(m as any), content: ((m as any).content as any[]).map((b) => ({ ...b })) }));
  const mark = (msgIdx: number) => {
    const blocks = msgs[msgIdx]?.content;
    if (!Array.isArray(blocks) || !blocks.length) return;
    const last = blocks[blocks.length - 1];
    // cache_control is only valid on standard block types; text/tool_result/tool_use all qualify.
    if (last && typeof last === "object" && last.type !== "thinking" && last.type !== "redacted_thinking") {
      last.cache_control = { type: "ephemeral" };
    }
  };
  mark(0);
  if (msgs.length > 1) mark(msgs.length - 1);
  return msgs;
}

// The author's standing ask this turn: the newest user message carrying PLAIN human text — skipping
// tool_result-only messages (mid-loop chain links) and the harness's own injected prods (the
// auto-continue / force-commit / auto-verify sentinels), which are role:"user" but not the author.
// Grounds the <task> anchor + the intent hydration in threadSystem. Deterministic over the stored
// transcript, so a retried link re-derives the identical prompt.
function latestAuthorAsk(transcript: unknown[]): string {
  const msgs = transcript as { role?: string; content?: unknown[] }[];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m?.role !== "user" || !Array.isArray(m.content)) continue;
    const texts = m.content
      .filter((b) => (b as { type?: string })?.type === "text")
      .map((b) => String((b as { text?: unknown }).text ?? "").trim())
      .filter((t) => t && !t.startsWith(AUTO_CONTINUE_SENTINEL) && !t.startsWith(FORCE_COMMIT_SENTINEL) && !t.startsWith(RECORD_FINDINGS_SENTINEL) && !t.startsWith(VERIFY_SENTINEL));
    if (texts.length) return texts.join("\n").trim();
  }
  return "";
}

// Request-time state injection (never persisted): the live book state rides as the FINAL block of the
// latest user message, AFTER withCacheBreakpoints' marks — so the cached prefix (stable system prompt +
// the whole stored transcript) stays byte-identical across turns and only the fresh digest is paid
// uncached. Because it's never stored, the transcript holds exactly ONE current <book_state> per call —
// older turns carry none, so the model can't ground on a stale tree. Call AFTER withCacheBreakpoints
// (which deep-copies, making the append safe).
//
// `task` (the author's standing ask) is RE-STATED after the state dump: without it, the last thing the
// model reads before replying is the tree + lints, not the ask — the salience inversion behind "asked to
// render a scene, went and fixed lints" (long-context guidance: the query belongs AFTER the documents).
function withBookState(msgs: unknown[], state: string, task = ""): unknown[] {
  if (!state.trim() || !msgs.length) return msgs;
  const last = msgs[msgs.length - 1] as { role?: string; content?: unknown[] };
  if (last?.role !== "user" || !Array.isArray(last.content)) return msgs; // every call follows a user message; anything else, skip
  const anchor = task.trim()
    ? `\n\n<task note="the author's CURRENT ask — THIS is your job this turn; everything in <book_state> above is reference, not instruction">\n${task.trim().slice(0, 600)}\n</task>`
    : "";
  last.content = [...last.content, {
    type: "text",
    text: `<book_state note="the CURRENT live book — system-refreshed this turn; this is the tree/objective/analysis your instructions reference">\n${state}\n</book_state>${anchor}`,
  }];
  return msgs;
}

export { AUTO_CONTINUE_SENTINEL, FORCE_COMMIT_AFTER_READS, FORCE_COMMIT_SENTINEL, RECORD_FINDINGS_AFTER_READS, RECORD_FINDINGS_SENTINEL, compactTranscript, findingsBlock, latestAuthorAsk, trailingReadRun, unrecordedReadRun, withBookState, withCacheBreakpoints };
