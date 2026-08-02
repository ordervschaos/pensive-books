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

/**
 * Every extractor caps a body at some length. Doing that with a bare `slice()` cuts mid-word — one real
 * issue ended an article on "…never to prostitute my press to the purposes of cor" — and, worse, says
 * nothing about it: the reader cannot tell a piece that stopped from a piece that ended.
 *
 * So cut on a PARAGRAPH boundary (falling back to a sentence, then a word) and leave a mark. The mark is
 * part of the stored text on purpose. `digest_posts.body` is a cache that outlives the run that filled it —
 * a truncation flag held only on the in-memory `Item` would be lost the moment a later issue reused the
 * cached body, which is exactly when the reader would still be looking at a half-article.
 */
/**
 * A Unicode private-use codepoint, not a readable token, because the sentinel has to be a character that
 * CANNOT occur in prose. The first attempt used `[…]` and collided immediately: that is the standard
 * editorial mark for elided text, and a Carl Jung quotation in a real issue contained one. A body ending in
 * a genuine elision would have been silently relabelled "Read the rest at …" — a fabricated claim about
 * where the article went, which is the one class of error this pipeline exists to avoid. Private-use
 * codepoints are reserved for exactly this: an in-band marker with no in-band meaning.
 */
export const TRUNCATED_MARK = "\uE000";

export function truncateAtBoundary(text: string, max: number): string {
  if (text.length <= max) return text;

  const head = text.slice(0, max);
  const cut =
    lastIndexBefore(head, /\n\s*\n/g) ??
    lastIndexBefore(head, /[.!?]["'”’)]?\s/g) ??
    head.lastIndexOf(" ");

  return `${head.slice(0, cut > 0 ? cut : head.length).trimEnd()}\n\n${TRUNCATED_MARK}`;
}

// `lastIndexOf` takes no regex, and scanning backwards by hand is worse than one forward pass. Returns the
// END of the last match, not its start, so that cutting there keeps the boundary itself — otherwise a
// sentence-boundary cut lands before the full stop and drops it ("One sentence here" instead of "…here.").
function lastIndexBefore(s: string, re: RegExp): number | null {
  let at: number | null = null;
  for (const m of s.matchAll(re)) at = m.index + m[0].length;
  return at;
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

// A block that is mostly links is a nav/footer list ("Home · About · Subscribe · Unsubscribe") even when it
// reads as grammatical sentences ("View it in full <url>. Unsubscribe <url>.") — real prose cites a source
// now and then, it doesn't run wall-to-wall links.
//
// The first version of this counted characters-per-link and called anything under 300 a nav row. That is far
// too blunt once whole article bodies pass through: a 200-character paragraph containing ONE inline citation
// scores 200 and was deleted. Two real paragraphs died that way in a single Daily Stoic piece, one of them
// only because the phrase "Amor Fati" happened to be linked.
//
// What actually distinguishes the two is not how often links appear but **how much of the block is anything
// else**. A nav row is links plus separators; a paragraph is the author's own sentences with a link inside
// one of them. So: measure the visible text that is NOT link label, both as a share and in absolute terms.
const MD_LINK = /\[([^\]]*)\]\((https?:\/\/[^)\s]*)\)/g;
const BARE_URL = /<?\bhttps?:\/\/[^\s>)]+>?/g;
const MIN_PROSE_OUTSIDE_LINKS = 80;
const MAX_LINK_SHARE = 0.5;

function isLinkHeavy(block: string): boolean {
  let links = 0;
  let linkTextLen = 0;

  // An EMPTY-label link — `[](https://…)` — is a permalink anchor: it renders nothing and the reader never
  // sees it. Counting it as a link is what deleted the `## [](url)How do we persevere?` headings out of the
  // middle of an article. Strip those first so they neither count nor contribute length.
  const withoutAnchors = block.replace(/\[\]\((?:https?:\/\/[^)\s]*)\)/g, "");

  const stripped = withoutAnchors
    .replace(MD_LINK, (_m, label: string) => {
      links++;
      linkTextLen += label.length;
      return " ";
    })
    // A bare URL has no label, but its own characters are what the reader sees, so they count as link text.
    .replace(BARE_URL, (m: string) => {
      links++;
      linkTextLen += m.length;
      return " ";
    });

  if (!links) return false;

  const prose = stripMarkdownSyntax(stripped).length;
  const visible = prose + linkTextLen;
  return prose < MIN_PROSE_OUTSIDE_LINKS && (visible === 0 || linkTextLen / visible >= MAX_LINK_SHARE);
}

// Page furniture that carries no links, and therefore sails straight past `isLinkHeavy`: a cookie-consent
// panel, a share widget, a subscribe box. One real issue ran ~3,000 unbroken characters of Cookiebot copy
// ("Manage Consent Preferences", "Switch Label label", "checkbox label label") as the tail of an art
// section, because the extractor's markdown had stripped the links out of it.
//
// Kept as two DATA lists, not code: adding a newly-observed junk phrase should be one line here, and the
// two tiers exist because the false-positive risk is completely different between them.

// Tier 1 — strings that are only ever furniture, matched anywhere in a block of any length. No essay
// contains "Manage Consent Preferences" except as a banner.
const CHROME_PHRASES: RegExp[] = [
  /manage consent preferences/i,
  /consent leg\.?\s*interest/i,
  /switch label label/i,
  /checkbox label/i,
  /confirm my choices/i,
  /privacy\/terms of use policy/i,
  /\bthese cookies (are|allow|may be|enable|collect|do not|help)/i,
  /^(strictly necessary|performance|functional|targeting|social media|advertising) cookies$/i,
  /enter your email address to (subscribe|follow)/i,
  /subscribe to get the latest posts/i,
  /\d[\d,]* other subscribers/i,
  // Footers that survive `isLinkHeavy` because their link is a bare "here" or "Go here" — almost all text,
  // one tiny anchor, which is the exact shape the relaxed link rule is designed NOT to delete.
  /need to cancel a recurring donation/i,
  /^see more on (instagram|twitter|facebook|threads|bluesky|x)\b/i,
  /^\|?\s*posted:.*\|\s*\d+\s*comments?\s*$/i,
  /your privacy choices/i,
  /by providing my details/i,
  /^type your email/i,
];

// Tier 2 — words that are furniture as a STANDALONE label but ordinary English inside a sentence ("the
// gallery ran an advertisement in 1912"). So these only fire on a short block that is nothing BUT the
// label, which is exactly what a stripped widget collapses to.
const WIDGET_LABEL =
  /^(advertisements?|share this:?|like this:?|sponsored|related( posts?| articles?| reading| tags)?|tags|read more|comments? (are )?closed\.?|leave a (comment|reply)|subscribe( to .{0,40})?|sign ?up|log ?in|follow us( on .{0,20})?|newsletter|newswire|join us( today)?!?|previous|next|home|menu|search|skip to content|discover more from .{0,40}|other articles from .{0,40}|support (independent|our) .{0,40}|like loading\.{0,3}|(first |last |full )?name ?\*?|e-?mail( address)? ?\*?|phone( number)? ?\*?|message ?\*?|submit|send|continue reading)$/i;
const WIDGET_LABEL_MAX = 60;

function isChrome(plain: string): boolean {
  if (plain.length <= WIDGET_LABEL_MAX && WIDGET_LABEL.test(plain.replace(/[.·|—–-]+$/, "").trim())) {
    return true;
  }
  return CHROME_PHRASES.some((re) => re.test(plain));
}

/**
 * Extracted body with chrome removed — nav menus, a forward header, a link-heavy disclaimer block, and
 * (anywhere in the body) a blocklisted cookie/share/subscribe widget. Walks paragraph-sized blocks
 * (blank-line separated): while still hunting for where the real content starts, a block has to clear the
 * same bar `firstParagraph` used to (not a forward header, not link-heavy, not too short); once that bar is
 * cleared once, every later block is kept as long as it isn't link-heavy or empty after stripping — a short
 * transition or a one-line blockquote mid-article is legitimate even though it wouldn't have been a good
 * OPENING paragraph. Falls back to a plain-stripped copy of the whole thing if nothing ever clears the bar.
 *
 * **The markdown survives.** `stripMarkdownSyntax` is used to JUDGE a block (is it chrome? is it long
 * enough?) but never to produce the output, because judging and rendering want opposite things: the
 * decisions are easier on flat text, and the reader wants the structure. Returning flat text was defensible
 * while this fed a one-paragraph teaser; it stopped being defensible when `renderRawList` began emitting
 * whole articles, at which point it was silently demolishing every heading, blockquote and emphasis the
 * author wrote — a sub-head, its pull-quote and the paragraph under it all landing as three identical
 * undifferentiated paragraphs. `markdownToHtml` can render all of it; it just never got the chance.
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
    // Checked regardless of `started`: unlike the leading-chrome rules above, furniture mostly arrives at
    // the END (consent panel, share row, subscribe box), long after the bar has been cleared.
    if (isChrome(plain)) continue;
    if (!started && plain.length < MIN_PARAGRAPH_LEN) continue;
    started = true;
    // The ORIGINAL block, not `plain` — see the note above. Empty permalink anchors go, though: they render
    // as nothing and would otherwise leave `[]()` debris at the head of every extracted sub-head.
    kept.push(block.replace(/\[\]\((?:https?:\/\/[^)\s]*)\)/g, "").trim());
  }

  return kept.length ? kept.join("\n\n") : stripMarkdownSyntax(raw);
}
