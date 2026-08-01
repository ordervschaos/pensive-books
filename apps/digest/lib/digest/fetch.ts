import type { Item } from "./types";
import { stripReaderPreamble } from "./entities";

// Network primitives shared by every source adapter: fetch with a timeout, pull an article body, discover a
// lead image. Extracted out of adapters.ts once there were more adapters than one file should hold — the
// adapters now live in ./sources/*, and both they and adapters.ts import from here rather than from each
// other (which would be a cycle).

export const FETCH_TIMEOUT_MS = 20_000;
export const UA = "PensiveDigest/0.1 (+https://digest.pensive.me)";

export async function fetchText(url: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch(url, {
    signal: signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { "user-agent": UA },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.text();
}

export async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    signal: signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { "user-agent": UA, accept: "application/json" },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

// Lead image for a page, read straight out of its own metadata. Deterministic on purpose: the model picks
// WHETHER a section gets a picture, never WHICH url — same rule as citations. og:image is what publishers
// curate for sharing, so on an art or museum page it is usually the work itself rather than a logo.
const OG_IMAGE_RE =
  /<meta[^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image)["'][^>]+content=["']([^"']+)["']/i;
const OG_IMAGE_REVERSED_RE =
  /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image)["']/i;

export async function leadImage(pageUrl: string, signal?: AbortSignal): Promise<string | undefined> {
  try {
    const html = await fetchText(pageUrl, signal);
    const raw = (html.match(OG_IMAGE_RE) ?? html.match(OG_IMAGE_REVERSED_RE))?.[1];
    if (!raw) return undefined;
    const abs = new URL(decodeHtmlEntities(raw), pageUrl);
    if (abs.protocol !== "https:") return undefined; // a mixed-content image just fails silently later
    return abs.toString();
  } catch {
    return undefined;
  }
}

export function decodeHtmlEntities(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&#38;/g, "&").replace(/&quot;/g, '"');
}

export function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

// Attach images to the first few items only. Each one costs a page fetch, and a digest needs one or two
// pictures, not a gallery.
export const MAX_IMAGE_LOOKUPS = 3;

export async function attachImages(items: Item[], signal?: AbortSignal): Promise<Item[]> {
  const targets = items.filter((i) => i.url).slice(0, MAX_IMAGE_LOOKUPS);
  await Promise.all(
    targets.map(async (item) => {
      item.image_url = await leadImage(item.url!, signal);
    }),
  );
  return items;
}

// Article body. Extraction goes through r.jina.ai (URL → markdown): zero dependencies, and it handles
// JS-rendered pages. Tradeoff worth knowing: article URLs are sent to a third party. Swapping in a
// self-hosted @mozilla/readability later touches only this function — every adapter goes through it.
export async function articleText(
  url: string,
  signal?: AbortSignal,
): Promise<{ text: string; publishedAt?: string }> {
  try {
    const md = await fetchText(`https://r.jina.ai/${url}`, signal);
    const { text, publishedAt } = stripReaderPreamble(md);
    return { text: text.slice(0, 12_000), publishedAt };
  } catch {
    return { text: "" }; // fall back to whatever summary the caller already has, rather than dropping the item
  }
}
