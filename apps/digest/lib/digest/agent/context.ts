import type { Turn } from "../llm";

// WHAT TO SEND — as distinct from what the chat keeps.
//
// The transcript grows forever; the prompt must not. Without this, turn 40 costs eight times turn 5 and
// buys nothing extra, because most of what has accumulated is not the kind of thing that stays useful.
//
// The whole policy rests on one distinction:
//
//   STATE  — "there are four sections; the second is a feed on three urls"
//            Lives in the DATABASE. Re-read into <digest_state> every turn.
//            Replaying it as conversation is not merely wasteful, it is WRONG: the reader may have deleted
//            that section in another tab two minutes later. So it is never carried in history at all.
//
//   INTENT — "nothing older than six months"; "I said no to a search section, too expensive"
//            Lives in the CONVERSATION and must survive. This is the only thing worth folding.
//
// Everything below follows from that. Tool results are state, so they elide to receipts. Old assistant
// prose is mostly narration of state changes, so it folds. Preferences and refusals are intent, so the fold
// is instructed to keep exactly those and nothing else.

/** Exchanges kept verbatim, tool calls and all. Enough for "no, the other one" to still make sense. */
export const WINDOW = 3;
/** Fold once this many exchanges have scrolled out — amortises the summariser call across many turns. */
export const FOLD_AFTER = 3;
/** A tool result outside the window collapses to this much. Its full text is a query away. */
const RECEIPT_CHARS = 120;

/** One thing the reader said and everything it caused, as an index range into the message list. */
interface Exchange {
  start: number;
  end: number;
}

/** Split a transcript on user turns. Anything before the first user turn is not an exchange. */
export function exchanges(messages: Turn[]): Exchange[] {
  const out: Exchange[] = [];
  messages.forEach((turn, i) => {
    if (turn.role !== "user") return;
    if (out.length) out[out.length - 1].end = i;
    out.push({ start: i, end: messages.length });
  });
  return out;
}

export interface BuiltContext {
  /** What to hand the model this turn. */
  messages: Turn[];
  /** How many messages the fold should now cover, if one is due. Null when no fold is needed. */
  foldThrough: number | null;
  /** The slice to summarise, when `foldThrough` is set. */
  toFold: Turn[];
}

/**
 * Assemble the turn's message list.
 *
 * Three things happen, in order of how much they save:
 *
 *   1. Anything already folded is replaced by the fold — one short block instead of N exchanges.
 *   2. Exchanges outside the window keep their prose and LOSE their tool calls. Calls and results are
 *      dropped together, never separately: a tool result whose call is missing is a malformed conversation,
 *      and providers reject it.
 *   3. Inside the window, tool results are kept but truncated. This is where the tokens actually are — one
 *      `read_posts` is worth more characters than everything the reader has typed all week — and it is only
 *      safe because every elided payload has a tool that fetches it back. Elision without retrieval is not
 *      compaction, it is amnesia.
 */
export function buildContext(opts: {
  messages: Turn[];
  fold: string | null;
  foldedThrough: number;
}): BuiltContext {
  const all = exchanges(opts.messages);
  const foldedCount = all.filter((e) => e.end <= opts.foldedThrough).length;
  const live = all.slice(foldedCount);

  const sent: Turn[] = [];
  if (opts.fold) {
    // Carried as a user turn because that is the only role every provider accepts as free-standing context,
    // and it is honest about whose words these are a summary of.
    sent.push({
      role: "user",
      content: `<earlier_in_this_conversation>\n${opts.fold}\n</earlier_in_this_conversation>`,
    });
  }

  const windowStart = Math.max(0, live.length - WINDOW);
  live.forEach((exchange, i) => {
    const inWindow = i >= windowStart;
    for (let j = exchange.start; j < exchange.end; j += 1) {
      const turn = opts.messages[j];
      if (inWindow) {
        sent.push(turn.role === "tool" ? { ...turn, content: receipt(turn.content) } : turn);
        continue;
      }
      // Outside the window: prose only. Dropping the calls is what lets us drop the results.
      if (turn.role === "user") sent.push(turn);
      else if (turn.role === "assistant" && turn.content) sent.push({ role: "assistant", content: turn.content });
    }
  });

  const overflow = live.length - WINDOW;
  const shouldFold = overflow >= FOLD_AFTER;
  const foldThrough = shouldFold ? live[overflow - 1].end : null;

  return {
    messages: sent,
    foldThrough,
    toFold: shouldFold ? opts.messages.slice(opts.foldedThrough, foldThrough as number) : [],
  };
}

function receipt(content: string): string {
  if (content.length <= RECEIPT_CHARS) return content;
  return `${content.slice(0, RECEIPT_CHARS)}… [truncated — call the tool again if you need the rest]`;
}

/**
 * The summariser's instructions.
 *
 * Note what it is NOT asked to do: summarise. It is asked to EXTRACT one category and discard another, which
 * is a question a small model answers reliably where "summarise this" is an invitation to keep a bit of
 * everything. Rejections carry their reason because a rejection without one gets re-proposed next week.
 */
export function foldPrompt(previous: string | null, slice: Turn[]): string {
  const transcript = slice
    .filter((t) => t.role !== "tool")
    .map((t) => `${t.role}: ${t.content}`.trim())
    .filter((line) => line.length > "assistant:".length)
    .join("\n\n");

  return `${previous ? `Notes so far:\n${previous}\n\n---\n\n` : ""}New part of the conversation:

${transcript}

---

Rewrite the notes to include anything new from that transcript. Keep it under 120 words.

KEEP, as terse bullets:
- what this reader wants and dislikes, in their own words where possible
- anything they turned down, AND why they turned it down
- questions they have asked that are still unanswered

DROP entirely:
- what the digest is currently configured as — sections, urls, settings, counts. That is read fresh from the
  database every turn, and a remembered version of it is a claim that has had time to become false.
- anything that was done. "Added a feed" is not a preference.
- pleasantries, and your own explanations.

Output the notes and nothing else. If there is nothing worth keeping, output NOTHING.`;
}

/**
 * The staleness fence.
 *
 * One line, emitted only when someone ELSE moved the configuration since this conversation last looked.
 * Comparing against the version the previous turn *finished* on is what excludes the agent's own writes —
 * it already knows about those, and a warning it can't act on is noise that teaches it to ignore warnings.
 */
export function stalenessNote(lastVersion: number | null, currentVersion: number): string | null {
  if (lastVersion === null || currentVersion === lastVersion) return null;
  return (
    `<note>The digest was edited elsewhere since your last turn. Anything said earlier in this ` +
    `conversation about how it is configured may no longer be true; <digest_state> above is authoritative.</note>`
  );
}
