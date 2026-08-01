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
