import type { SupabaseClient } from "@supabase/supabase-js";
import { callModel } from "./llm";
import { urlHash } from "./canonical";
import type { Item } from "./types";

/**
 * The TRIM stage — a delete-only pass over an extracted article body.
 *
 * `cleanBody`'s blocklist (entities.ts) catches the junk shapes we thought to enumerate. This catches the
 * ones we didn't: a site's own bespoke footer, a paywall interstitial, an editor's note that is administrivia
 * rather than writing. Those are semantic judgements, and no list of regexes reaches them.
 *
 * ## The model returns indices, not text
 *
 * The obvious design — "here is the article, hand back the cleaned version" — is a rewrite wearing a
 * promise, and after the fact you cannot tell a deletion from a paraphrase. So the output alphabet is
 * INTEGERS. The blocks are numbered here, the model names the ones to drop, and this file does the deleting.
 * Three properties follow, none of which the rewrite version has:
 *
 *   - **Fabrication is structurally impossible.** The result is provably a subsequence of the input. That is
 *     also what earns this pass its exemption from `ai_enabled`: the flag gates VOICE — whether a model
 *     writes prose for the reader — and a pass that cannot introduce a word is hygiene, not authorship.
 *   - **It is cheap.** Output is ~30–60 tokens no matter how long the article is, and output is the
 *     expensive side of every price sheet. A 12,000-character body costs one cheap input pass, once, ever.
 *   - **It is auditable and reversible.** The drop list is stored next to the result, and the untouched body
 *     stays in `digest_posts.body`. When this eats a real paragraph you can see exactly which block and why.
 *
 * ## Why the result is versioned rather than overwritten
 *
 * `digest_posts` is a cache that outlives the run that filled it — `loadCorpus` already re-cleans on read
 * for exactly this reason ("rows stored before the extractor learned to strip r.jina.ai's metadata still
 * carry it verbatim"). A trim written by an older, worse prompt would otherwise outlive its fix forever. So
 * the result carries `trim_version`, and raising the constant below re-trims on next use without re-fetching
 * anything.
 */

/** Raise this when the prompt or the block policy changes. Rows trimmed under an older version are re-run. */
export const TRIM_VERSION = 1;

/** Blocks shorter than this are never worth a model's opinion — `cleanBody` has already had a go at them. */
const MIN_BLOCK = 25;
/** Don't pay to trim something that is barely more than the junk itself. */
const MIN_BODY = 600;
/** A body with more blocks than this is excerpted for the prompt; the tail is where furniture lives anyway. */
const MAX_BLOCKS = 120;
/**
 * Refuse to remove more than this share of a body.
 *
 * A real case: a "Happy 1st Birthday, Atomic Habits!" post is promotional almost end to end, and the model
 * correctly identified 14 of its 18 blocks as pitch. Applying that leaves a four-block stub — which reads
 * worse than the honest promotional post did, and quietly hides the actual finding, which is that this item
 * should not have been SELECTED for the digest at all. Furniture removal is this stage's job; deciding an
 * item does not belong is the selector's. So past this threshold the body is kept whole, the intended drop
 * list is still recorded for the audit, and the signal is logged rather than swallowed.
 */
const MAX_DROP_SHARE = 0.5;
const PREVIEW_CHARS = 180;

const SYSTEM = `You remove page furniture from an extracted article. You never rewrite, summarise, or reorder anything.

You are given the article as NUMBERED BLOCKS. Reply with ONLY a JSON object:
{"drop": [{"i": <block number>, "starts": "<the block's first four words, copied exactly>", "why": "<tag>"}]}

Drop a block when it is not part of the article the author wrote:
- nav | cookie_consent | ad | share_widget | subscribe_cta | comments | related | legal | byline_furniture
- admin_notice — site administrivia (a platform migration announcement, a schedule change, a "we are on
  holiday" note) rather than writing.

THE TEST IS WHAT THE BLOCK IS DOING, NOT WHAT IT CONTAINS:
- A LINK IS NOT AN ADVERTISEMENT. Writers link to sources, videos, and their own earlier work mid-sentence.
  "James Stockdale was held captive in Hanoi" is reporting, and stays, whether or not the name is a link.
- Drop a promotional block only when promotion is ALL it does — it exists to sell a course, a newsletter or
  a podcast, and removing it costs the article no information ("check out our course", "subscribe to get
  the latest posts").
- If a block states a fact, tells a story, makes an argument, or advances the piece in any way, KEEP IT,
  even if it also promotes something.

Keep everything else too: the author's asides, pull quotes, image captions, editor's notes that carry
content, short transitions, and anything you are unsure about. A kept piece of furniture is a small
annoyance; a dropped paragraph is a hole in the article that the reader cannot see and cannot recover.

Never invent a block number. Reply with {"drop": []} if the article is clean.`;

interface DropEntry {
  i: number;
  /** The block's first words, copied by the model — see `echoMatches`. */
  starts?: string;
  why?: string;
}

/** Split into the same paragraph blocks `cleanBody` works in, so an index means the same thing everywhere. */
function blocksOf(body: string): string[] {
  return body.split(/\n\s*\n+/).filter((b) => b.trim());
}

function numbered(blocks: string[]): string {
  return blocks
    .slice(0, MAX_BLOCKS)
    .map((b, n) => {
      const flat = b.replace(/\s+/g, " ").trim();
      const shown = flat.length > PREVIEW_CHARS ? `${flat.slice(0, PREVIEW_CHARS)}…` : flat;
      return `[${n}] ${shown}`;
    })
    .join("\n");
}

// The model is asked for bare JSON, but a stray ```json fence is the single most common deviation and is not
// worth a retry. Anything else that fails to parse means the drop list is unknown, and an unknown drop list
// must mean "drop nothing" — never "drop everything".
function parseDrops(text: string, blockCount: number): DropEntry[] {
  const json = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "");
  try {
    const parsed = JSON.parse(json) as { drop?: unknown };
    if (!Array.isArray(parsed.drop)) return [];
    return parsed.drop
      .map((d) => (typeof d === "number" ? { i: d } : (d as DropEntry)))
      .filter((d): d is DropEntry => Number.isInteger(d?.i) && d.i >= 0 && d.i < blockCount);
  } catch {
    return [];
  }
}

const ECHO_WORDS = 4;

// Compared on words, lowercased, with markdown syntax and punctuation ignored — the model is copying from a
// preview that has already been flattened and possibly elided, so demanding a literal prefix match would
// reject correct drops. Absent echo = keep the drop (older cached responses, and the check is a backstop,
// not the policy).
function echoMatches(block: string, starts?: string): boolean {
  if (!starts) return true;
  const words = (s: string) =>
    s
      .replace(/[#>*_`[\]()]/g, " ")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
      .slice(0, ECHO_WORDS)
      .join(" ");
  return words(block).startsWith(words(starts).slice(0, Math.max(1, words(starts).length)));
}

export interface TrimResult {
  text: string;
  drops: DropEntry[];
}

/** The pure half: numbering, the call, and applying the drop list. No database, so it can be exercised alone. */
export async function trimBody(
  body: string,
  meta: { issueId: number | null; userId: string | null },
  signal?: AbortSignal,
): Promise<TrimResult> {
  const blocks = blocksOf(body);
  if (body.length < MIN_BODY || blocks.length < 3) return { text: body, drops: [] };

  const { text } = await callModel(
    {
      system: SYSTEM,
      prompt: numbered(blocks),
      maxTokens: 600,
      effort: "low",
      signal,
    },
    { fn: "digest-trim", operation: "trim_body", issueId: meta.issueId, userId: meta.userId },
  );

  const drops = parseDrops(text, blocks.length)
    .filter((d) => blocks[d.i].length >= MIN_BLOCK)
    // The model is asked to copy back the opening words of every block it drops, and a drop whose echo does
    // not match its number is discarded. This is not a formality: the failure it guards against is INDEX
    // DRIFT — the model counting a blank line or a wrapped preview as its own block and deleting a paragraph
    // adjacent to the one it meant. A semantic mistake is a judgement call; an off-by-one is a silent hole.
    .filter((d) => echoMatches(blocks[d.i], d.starts));
  if (!drops.length) return { text: body, drops: [] };

  const dropped = new Set(drops.map((d) => d.i));
  const kept = blocks.filter((_b, n) => !dropped.has(n));
  const trimmed = kept.join("\n\n");

  if (trimmed.length < body.length * (1 - MAX_DROP_SHARE)) {
    console.warn(
      `trim: refusing to cut ${drops.length}/${blocks.length} blocks ` +
        `(${Math.round(100 * (1 - trimmed.length / body.length))}% of the body) — kept whole. ` +
        `A post that is mostly pitch is a selection problem, not a trim problem.`,
    );
    return { text: body, drops };
  }

  return { text: trimmed, drops };
}

/**
 * Trim the bodies of `items` in place, reusing anything already trimmed at the current version.
 *
 * Called with the items that SURVIVED the per-section cut, so a feed that hands over twenty posts for a
 * four-item section is never billed for the sixteen nobody will read. Failure is non-fatal by construction:
 * an item that cannot be trimmed keeps its untrimmed body and the issue ships.
 */
export async function trimItems(
  db: SupabaseClient,
  digestId: number,
  items: Item[],
  meta: { issueId: number | null; userId: string | null },
  signal?: AbortSignal,
): Promise<void> {
  const targets = items.filter((i) => i.url && i.text.trim());
  if (!targets.length) return;

  const hashes = targets.map((i) => urlHash(i.url!));
  const { data } = await db
    .from("digest_posts")
    .select("url_hash, body_clean, trim_version")
    .eq("digest_id", digestId)
    .in("url_hash", hashes);

  const cached = new Map(
    ((data ?? []) as Array<{ url_hash: string; body_clean: string | null; trim_version: number | null }>)
      .filter((r) => r.body_clean && r.trim_version === TRIM_VERSION)
      .map((r) => [r.url_hash, r.body_clean as string]),
  );

  await Promise.all(
    targets.map(async (item) => {
      const hash = urlHash(item.url!);
      const hit = cached.get(hash);
      if (hit) {
        item.text = hit;
        return;
      }
      try {
        const { text, drops } = await trimBody(item.text, meta, signal);
        item.text = text;
        // Written here rather than left to `recordPosts` so a preview pays for the trim exactly once too.
        // `body` itself is never touched: the untrimmed original is what makes this reversible.
        await db
          .from("digest_posts")
          .update({ body_clean: text, trim_version: TRIM_VERSION, trim_drops: drops })
          .eq("digest_id", digestId)
          .eq("url_hash", hash);
      } catch (e) {
        console.error(`trim failed for ${item.url}:`, e);
      }
    }),
  );
}
