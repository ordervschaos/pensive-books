import { decodeFeedText } from "./entities";

// A deliberately small RSS/Atom reader. Four adapters now parse feeds (feed, video, ranked/arxiv, and any
// future one), so the parsing lives here rather than being copied — the copies would drift, and this repo
// has been bitten by mirror drift before.
//
// Why not a library: the surface actually used is "give me entries with title/link/date/summary". A parser
// dependency would buy strictness this pipeline doesn't need — a malformed feed should degrade to fewer
// items, never to a thrown build.

const FEED_ITEM_RE = /<(item|entry)[\s\S]*?<\/\1>/gi;

export interface FeedEntry {
  title: string;
  url: string;
  summary: string;
  published_at?: string;
  /** Raw XML of the entry, for callers that need a namespaced tag we don't model (e.g. podcast:transcript). */
  raw: string;
}

export function tag(xml: string, name: string): string | undefined {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  if (!m) return undefined;
  return decodeFeedText(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")).trim() || undefined;
}

export function attr(xml: string, tagName: string, attrName: string): string | undefined {
  const m = xml.match(new RegExp(`<${tagName}[^>]*\\s${attrName}=["']([^"']+)["']`, "i"));
  return m?.[1];
}

export function feedLink(entry: string): string | undefined {
  const direct = tag(entry, "link");
  if (direct?.startsWith("http")) return direct;
  // Atom puts the URL in an attribute rather than the element body.
  return attr(entry, "link", "href");
}

/** The feed's own title — read from the head, before the first entry, so an entry title can't be mistaken for it. */
export function feedTitle(xml: string): string | undefined {
  return tag(xml.split(/<(item|entry)[\s>]/i)[0], "title");
}

export function parseFeed(xml: string): FeedEntry[] {
  const out: FeedEntry[] = [];
  for (const raw of xml.match(FEED_ITEM_RE) ?? []) {
    const url = feedLink(raw);
    const title = tag(raw, "title");
    if (!url || !title) continue;
    out.push({
      title,
      url,
      // media:description is where YouTube puts the blurb; the plain tags cover RSS and Atom.
      summary:
        tag(raw, "description") ??
        tag(raw, "summary") ??
        tag(raw, "content") ??
        tag(raw, "media:description") ??
        "",
      published_at: tag(raw, "pubDate") ?? tag(raw, "updated") ?? tag(raw, "published"),
      raw,
    });
  }
  return out;
}
