// Text normalization for fetched content. Zero imports so it can be exercised directly — `adapters.ts`
// pulls in the Supabase client, which makes it awkward to test outside Next.
//
// A fixed list of named entities is not enough: real feed titles arrive double-encoded, e.g.
// `&#8220;That Epictetus is a Trip!&#8221;` and `Blackie &#038; Co.`. Numeric forms have to be handled
// generically, and `&amp;` must be unescaped LAST — otherwise `&amp;#8220;` becomes a literal `&#8220;`
// instead of a quote mark.
const NAMED: Record<string, string> = {
  lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…",
  mdash: "—", ndash: "–", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
};

function safeChar(code: number): string {
  return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
}

/** Strip tags, resolve entities, and collapse whitespace — for feed titles and summaries. */
export function decodeFeedText(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => safeChar(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => safeChar(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (m: string, name: string) => NAMED[name.toLowerCase()] ?? m)
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

// r.jina.ai prefixes every extraction with a metadata block:
//
//   Title: ...
//   URL Source: https://...
//   Published Time: 2023-08-23T16:48:46+00:00
//   Markdown Content:
//   <the actual article>
//
// That block was being stored verbatim AND handed to the writer as source material, so every feed article
// arrived wearing a little machine-generated hat. Strip it — and hand back the published time, which is
// often better than what the feed claims.
const PREAMBLE_MARKER = /^Markdown Content:\s*$/m;
const PUBLISHED_LINE = /^Published Time:\s*(.+)$/m;

export function stripReaderPreamble(raw: string): { text: string; publishedAt?: string } {
  if (!raw) return { text: "" };

  const published = raw.slice(0, 600).match(PUBLISHED_LINE)?.[1]?.trim();

  // Only treat it as a preamble if the marker sits near the top; a article that happens to contain the
  // phrase further down must not be truncated.
  const marker = raw.match(PREAMBLE_MARKER);
  const at = marker?.index;
  const text = at !== undefined && at < 600 ? raw.slice(at + marker![0].length).trimStart() : raw;

  return { text, publishedAt: published };
}

// A page's reader-extraction doesn't always start where the article does — nav menus, logo/social-share
// image stacks, and (for the inbox source) a mail client's own forward header all land in the same text
// field the article body does. Excerpting from character 0, as the non-AI raw list originally did, surfaces
// whichever of those happens to sit on top rather than the story. The AI writer never showed this because a
// model reads past chrome on its own; a plain excerpt can't, so it has to skip explicitly.
const FORWARD_MARKER = /^-{3,}\s*forwarded message\s*-{3,}/i;
const MIN_PARAGRAPH_LEN = 100;

function stripMarkdownSyntax(block: string): string {
  return block
    .replace(/^#{1,6}\s*/gm, "") // heading markers
    .replace(/^>\s?/gm, "") // blockquote markers
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // markdown images
    .replace(/\[image:[^\]]*\]/gi, "") // plain-text email image placeholders
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // markdown links -> visible text
    .replace(/<https?:\/\/[^>]*>/g, "") // plain-text email bare links
    .replace(/[*_]+/g, "") // emphasis markers
    .replace(/\s+/g, " ")
    .trim();
}

// A block that is mostly links, by character count, is a nav/footer list ("Home · About · Subscribe ·
// Unsubscribe") even when it reads as grammatical sentences ("View it in full <url>. Unsubscribe <url>.") —
// real prose cites a source now and then, it doesn't run wall-to-wall links.
function isLinkHeavy(block: string): boolean {
  const links = block.match(/https?:\/\//g)?.length ?? 0;
  return links > 0 && block.length / links < 300;
}

/**
 * Extracted text, in full, markdown-stripped for plain display and with leading chrome removed — nav
 * menus, a forward header, a link-heavy disclaimer block. Walks paragraph-sized blocks (blank-line
 * separated): while still hunting for where the real content starts, a block has to clear the same bar
 * `firstParagraph` used to (not a forward header, not link-heavy, not too short); once that bar is cleared
 * once, every later block is kept as long as it isn't link-heavy or empty after stripping — a short
 * transition or a one-line blockquote mid-article is legitimate even though it wouldn't have been a good
 * OPENING paragraph. Falls back to a plain-stripped copy of the whole thing if nothing ever clears the bar.
 */
export function cleanBody(raw: string): string {
  if (!raw) return "";

  const blocks = raw.split(/\n\s*\n+/);
  const kept: string[] = [];
  let started = false;
  for (const block of blocks) {
    if (FORWARD_MARKER.test(block.trimStart())) continue;
    if (isLinkHeavy(block)) continue;
    const plain = stripMarkdownSyntax(block);
    if (!plain) continue;
    if (!started && plain.length < MIN_PARAGRAPH_LEN) continue;
    started = true;
    kept.push(plain);
  }

  return kept.length ? kept.join("\n\n") : stripMarkdownSyntax(raw);
}
