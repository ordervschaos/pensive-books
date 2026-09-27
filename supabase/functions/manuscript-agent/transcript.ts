// manuscript-agent transcript helpers — the same discipline as book-agent/transcript.ts (kept as a
// local copy so this function has no import edge into the DNA agent): prune old bulky reads once the
// transcript is big, bank what the model distilled in `steps` (never pruned), put request-time cache
// breakpoints on the prefix, and inject the live book state AFTER them so the cached prefix stays
// byte-identical across turns.
import type { AgentStep, Finding } from "./shared.ts";

const COMPACT_OVER = 120_000; // chars of transcript JSON before pruning kicks in
const STUB_OVER = 700;        // only stub results bigger than this

/** Stub every bulky tool_result except those in the newest message that carries bulky results. */
function compactTranscript(transcript: unknown[]): unknown[] {
  if (JSON.stringify(transcript).length <= COMPACT_OVER) return transcript;
  // deno-lint-ignore no-explicit-any
  const hasBulky = (m: any) => m?.role === "user" && Array.isArray(m.content) &&
    // deno-lint-ignore no-explicit-any
    m.content.some((b: any) => b?.type === "tool_result" && typeof b.content === "string" && b.content.length > STUB_OVER && !b.content.includes("[PRUNED"));
  const newest = transcript.reduce<number>((acc, m, i) => (hasBulky(m) ? i : acc), -1);
  let changed = false;
  const out = transcript.map((m, i) => {
    if (i >= newest || !hasBulky(m)) return m;
    let msgChanged = false;
    // deno-lint-ignore no-explicit-any
    const content = ((m as { content: any[] }).content).map((b) => {
      if (b?.type !== "tool_result" || typeof b.content !== "string" || b.content.length <= STUB_OVER || b.content.includes("[PRUNED")) return b;
      msgChanged = true;
      return { ...b, content: `${b.content.slice(0, 80)}… [PRUNED — an older full read. What you DISTILLED from it survives in <notes>; the page list is in <book>. Re-read only if you need detail neither carries.]` };
    });
    if (!msgChanged) return m;
    changed = true;
    return { ...(m as Record<string, unknown>), content };
  });
  return changed ? out : transcript;
}

// Fold-on-read: what the model banked with record_notes rides in <book> every turn (request-time,
// so it never breaks the cached prefix and never lives where compaction could prune it).
const NOTES_CAP = 60;
function notesBlock(steps: AgentStep[]): string {
  const all: Finding[] = [];
  for (const s of steps) {
    if (s.t !== "finding" || !Array.isArray(s.findings)) continue;
    for (const f of s.findings) {
      const finding = String(f?.finding ?? "").trim();
      if (finding) all.push({ ref: String(f?.ref ?? "").trim(), finding });
    }
  }
  if (!all.length) return "";
  const kept = all.slice(-NOTES_CAP);
  const lines = kept.map((f) => (f.ref ? `${f.ref} — ${f.finding}` : f.finding));
  return `<notes note="what YOU already learned from reads this conversation — the raw reads may be pruned, this survives. Trust it; don't re-read to recover it.">\n${lines.join("\n")}\n</notes>`;
}

/** Trailing 'read' steps since the last commit-shaped step — feeds the force-commit nudge. */
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
const FORCE_COMMIT_AFTER_READS = 15;
const FORCE_COMMIT_SENTINEL = "[force-commit]";

// Trailing 'read' steps NOT yet distilled by a record_notes call ('finding' resets it). Feeds the
// record-notes nudge: reads that pile up unrecorded get pruned by compaction and re-read forever
// (seen live: a 74-page coherence sweep re-read the same pages after the prune).
function unrecordedReadRun(steps: AgentStep[]): number {
  let n = 0;
  for (let i = steps.length - 1; i >= 0; i--) {
    const t = steps[i].t;
    if (t === "read") { n++; continue; }
    if (t === "note") continue;
    break;
  }
  return n;
}
const RECORD_NOTES_AFTER_READS = 3;
const RECORD_NOTES_SENTINEL = "[record-notes]";

// A completion with no text and no tool call — the model spent its whole output budget thinking
// (reasoning tiers bill it inside max_tokens). Prodded once; a second empty reply ends the turn with
// an honest note instead of a silent idle.
const EMPTY_REPLY_SENTINEL = "[empty-reply]";

// An assistant message with NO blocks is invalid on the OpenAI-compatible hosts ("content or tool_calls
// must be set" — DeepSeek 400s the whole request), so a single empty completion stored verbatim poisons
// every later turn of the thread (seen live twice on book 727). Store a placeholder text block instead,
// and heal any transcript that already carries one at turn start.
const EMPTY_REPLY_PLACEHOLDER = "(empty reply — the output budget was spent thinking)";
function sanitizeTranscript(transcript: unknown[]): unknown[] {
  let changed = false;
  const out = transcript.map((m) => {
    const msg = m as { role?: string; content?: unknown };
    if (msg?.role !== "assistant") return m;
    const blocks = Array.isArray(msg.content) ? msg.content : [];
    if (blocks.length) return m;
    changed = true;
    return { ...msg, content: [{ type: "text", text: EMPTY_REPLY_PLACEHOLDER }] };
  });
  return changed ? out : transcript;
}

/** True when the newest user message is the harness prod `sentinel` (not the author). */
function lastUserIsProd(transcript: unknown[], sentinel: string): boolean {
  const last = transcript[transcript.length - 1] as { role?: string; content?: unknown[] } | undefined;
  if (last?.role !== "user" || !Array.isArray(last.content)) return false;
  return last.content.some((b) => (b as { type?: string; text?: string })?.type === "text" && String((b as { text?: string }).text ?? "").startsWith(sentinel));
}

/** Request-time cache breakpoints: the first user message and the last block of the latest message. */
function withCacheBreakpoints(transcript: unknown[]): unknown[] {
  // deno-lint-ignore no-explicit-any
  const msgs = transcript.map((m) => ({ ...(m as any), content: ((m as any).content as any[]).map((b) => ({ ...b })) }));
  const mark = (i: number) => {
    const blocks = msgs[i]?.content;
    if (!Array.isArray(blocks) || !blocks.length) return;
    const last = blocks[blocks.length - 1];
    if (last && typeof last === "object" && last.type !== "thinking" && last.type !== "redacted_thinking") last.cache_control = { type: "ephemeral" };
  };
  mark(0);
  if (msgs.length > 1) mark(msgs.length - 1);
  return msgs;
}

/** The author's newest plain-text ask (skipping tool-result-only links and the harness's own prods). */
function latestAuthorAsk(transcript: unknown[]): string {
  const msgs = transcript as { role?: string; content?: unknown[] }[];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m?.role !== "user" || !Array.isArray(m.content)) continue;
    const texts = m.content
      .filter((b) => (b as { type?: string })?.type === "text")
      .map((b) => String((b as { text?: unknown }).text ?? "").trim())
      .filter((t) => t && !t.startsWith(FORCE_COMMIT_SENTINEL) && !t.startsWith(RECORD_NOTES_SENTINEL) && !t.startsWith(EMPTY_REPLY_SENTINEL));
    if (texts.length) return texts.join("\n").trim();
  }
  return "";
}

/** Append the live book state (+ the standing ask, re-stated last) to the latest user message. */
function withBookState(msgs: unknown[], state: string, task = ""): unknown[] {
  if (!state.trim() || !msgs.length) return msgs;
  const last = msgs[msgs.length - 1] as { role?: string; content?: unknown[] };
  if (last?.role !== "user" || !Array.isArray(last.content)) return msgs;
  const anchor = task.trim()
    ? `\n\n<task note="the author's CURRENT ask — this is your job this turn; <book> above is reference, not instruction">\n${task.trim().slice(0, 600)}\n</task>`
    : "";
  last.content = [...last.content, { type: "text", text: `${state}${anchor}` }];
  return msgs;
}

export { EMPTY_REPLY_PLACEHOLDER, EMPTY_REPLY_SENTINEL, sanitizeTranscript, FORCE_COMMIT_AFTER_READS, FORCE_COMMIT_SENTINEL, RECORD_NOTES_AFTER_READS, RECORD_NOTES_SENTINEL, compactTranscript, lastUserIsProd, latestAuthorAsk, notesBlock, trailingReadRun, unrecordedReadRun, withBookState, withCacheBreakpoints };
