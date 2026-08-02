import { aiEnabled, callModel } from "./llm";
import type { RunCtx, Section } from "./types";

// ②½ SELECT — the editorial cut.
//
// Until now the cut was `candidates.slice(0, max)`: whatever the feed happened to list first won, and 37 of
// 40 items were discarded without anyone looking at them. That is the standing "selection is not ranking"
// gap, and it is the thing that decides whether a digest is worth opening — the writer can only be as good
// as what it was handed.
//
// Deliberately NOT a recency filter. An older essay that is excellent beats a fresh one that is thin, and
// several of these feeds (Daily Stoic, James Clear) republish an evergreen archive on purpose. Age is not
// the axis; worth-the-reader's-time is.
//
// It runs on TITLES AND SUMMARIES ONLY, before article extraction — which is what makes it nearly free and
// is why the feed adapter is shaped the way it is (parse → interleave → cut → extract). Selecting after
// extraction would mean paying to fetch everything we were about to throw away.

export interface Candidate {
  title: string;
  source?: string;
  summary?: string;
  published_at?: string;
  /** A source's own score (HN points, upvotes) where it has one — a real signal, so pass it through. */
  score?: number;
}

const SYSTEM = `You are the editor of one section of a reading digest, choosing what makes the cut for a single named reader.

You are given candidate items — title, publication, and a short summary. Pick the ones most worth this reader's time.

WHAT MATTERS:
- Substance. A piece with a real argument, a specific finding, a concrete account, or something genuinely made. Prefer the specific over the general.
- Fit with what this reader has said they want, including the section's purpose.
- Variety across the picks. Two items making the same point is worth less than two different ones.

WHAT DOES NOT MATTER:
- AGE. Do not prefer recent items. An older piece that is excellent beats a new one that is thin, and some of these publications deliberately republish from an archive. Never use the date as a tiebreaker.
- Whether the headline sounds exciting. Listicles, "X things you need to know", engagement bait and SEO filler are worth LESS than a plainly-titled piece with something to say.
- Source prestige on its own.

Reply with ONLY the chosen item numbers, most valuable first, comma-separated. No words, no explanation, no formatting. Example: 7, 2, 11`;

/**
 * Choose the `keep` most valuable candidates. Returns them in editorial order.
 *
 * Falls back to the given order on any failure — a selection pass that breaks must degrade to today's
 * behaviour, never to an empty section.
 */
export async function selectValuable<T extends Candidate>(
  candidates: T[],
  keep: number,
  section: Section,
  ctx: RunCtx,
  issueId: number | null,
): Promise<T[]> {
  // Nothing to choose between: don't spend a call to confirm the obvious.
  if (candidates.length <= keep) return candidates;

  // No AI tier: same fallback as an actual model failure below — the pre-select behaviour, feed order.
  if (!aiEnabled(ctx.digest)) return candidates.slice(0, keep);

  const list = candidates
    .map((c, n) => {
      const head = [`[${n + 1}] ${c.title}`, c.source && `— ${c.source}`, c.score && `(score ${c.score})`]
        .filter(Boolean)
        .join(" ");
      // Summaries are trimmed hard: this call is a triage over many items, not a reading of any one.
      const gist = c.summary?.replace(/\s+/g, " ").trim().slice(0, 400);
      return gist ? `${head}\n${gist}` : head;
    })
    .join("\n\n");

  const voice = ctx.digest.voice?.trim();

  try {
    const { text } = await callModel(
      {
        system: voice ? `${SYSTEM}\n\nABOUT THIS READER (honor this):\n${voice}` : SYSTEM,
        prompt:
          `Section: ${section.title}\n` +
          (section.instructions ? `What this section is for: ${section.instructions}\n` : "") +
          `\nChoose the ${keep} most valuable of these ${candidates.length} items.\n\n${list}`,
        maxTokens: 200,
        effort: "low",
        signal: ctx.signal,
      },
      { fn: "digest-select", operation: "select_items", issueId, userId: ctx.digest.owner_id },
    );

    const chosen = parseIndices(text, candidates.length, keep);
    if (!chosen.length) return candidates.slice(0, keep);

    const picked = chosen.map((i) => candidates[i]);
    // If the model returned fewer than asked, top up in original order rather than shipping a thin section.
    for (const c of candidates) {
      if (picked.length >= keep) break;
      if (!picked.includes(c)) picked.push(c);
    }
    return picked;
  } catch (e) {
    console.error(`select ${section.id} failed, falling back to feed order:`, e);
    return candidates.slice(0, keep);
  }
}

// Tolerant on purpose: pull every integer out of whatever came back, drop the out-of-range and the
// duplicates, keep the first `keep`. A stray "Here are my picks:" must not cost the section its items.
function parseIndices(text: string, count: number, keep: number): number[] {
  const seen = new Set<number>();
  for (const m of text.matchAll(/\d+/g)) {
    const i = Number(m[0]) - 1; // the prompt is 1-based
    if (i >= 0 && i < count && !seen.has(i)) seen.add(i);
    if (seen.size >= keep) break;
  }
  return [...seen];
}
