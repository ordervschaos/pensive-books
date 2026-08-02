import type { Adapter, Item, RunCtx, VideoSection } from "../types";
import { articleText, attachImages, fetchText, stripHtml } from "../fetch";
import { attr, feedTitle, parseFeed } from "../feedparse";
import { urlHash } from "../canonical";
import { truncateAtBoundary } from "../entities";

// video — YouTube channels and podcasts, read instead of watched.
//
// MEDIUM CONVERSION is the entire value: an hour of video becomes six minutes of reading. It is also the
// strongest answer to "why deliver this to a Kindle" — a device that cannot play video is exactly where a
// transcript belongs, and it converts content you would never make time for into content you consume
// passively.
//
// Both source types collapse to a feed:
//   YouTube — every channel publishes Atom at /feeds/videos.xml?channel_id=…, no API key, no quota.
//   Podcast — the RSS is the product. Many now ship <podcast:transcript url="…"> in the namespace.
//
// TRANSCRIPTS ARE BEST-EFFORT, and honestly so. YouTube's timedtext endpoint is unofficial and blocks
// datacenter IPs, so we ask r.jina.ai for the watch page (it renders JS and often returns the transcript
// panel); a podcast's declared transcript url is fetched directly. When neither yields anything, the item
// falls back to the description — which is still real, sourced text, just thinner. What never happens is a
// model being asked to describe a video it hasn't seen.

const DEFAULT_DAYS = 3;
const MAX_CHANNELS = 6;
const TRANSCRIPT_FLOOR = 500; // characters — below this it's a description, not a transcript

/** Anything a user might paste → an Atom/RSS url. Channel ids and @handles both appear in the wild. */
function toFeedUrl(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^UC[\w-]{20,}$/.test(s)) return `https://www.youtube.com/feeds/videos.xml?channel_id=${s}`;
  if (s.startsWith("@")) return `https://www.youtube.com/feeds/videos.xml?user=${s.slice(1)}`;
  if (!s.startsWith("http")) return null;

  try {
    const u = new URL(s);
    if (!/(^|\.)youtube\.com$/.test(u.hostname)) return s; // any other http url is assumed to be a podcast feed
    if (u.pathname.startsWith("/feeds/")) return s;
    const channel = u.pathname.match(/\/channel\/(UC[\w-]+)/)?.[1];
    if (channel) return `https://www.youtube.com/feeds/videos.xml?channel_id=${channel}`;
    // A /@handle or /c/name url carries no channel id; the id is in the page. One extra fetch, once per run.
    return `resolve:${s}`;
  } catch {
    return null;
  }
}

// /@handle pages embed the canonical channel id in a meta tag. Resolving it here means the user can paste
// the url from their address bar rather than hunting for a UC… string.
async function resolveChannelFeed(pageUrl: string, signal?: AbortSignal): Promise<string | null> {
  try {
    const html = await fetchText(pageUrl, signal);
    const id =
      html.match(/"channelId":"(UC[\w-]+)"/)?.[1] ??
      html.match(/<meta[^>]+itemprop=["']channelId["'][^>]+content=["'](UC[\w-]+)["']/i)?.[1];
    return id ? `https://www.youtube.com/feeds/videos.xml?channel_id=${id}` : null;
  } catch {
    return null;
  }
}

// YouTube's own player payload lists caption tracks; the track url returns the transcript. VERIFIED
// BEHAVIOUR, and it is why this doesn't go through the normal extractor: r.jina.ai on a watch page returns
// the page CHROME ("Skip navigation", "Sign in", the sidebar) — four thousand characters of navigation that
// look exactly like grounding to the writer stage. Junk material is worse than none, because the section
// then gets written from it.
//
// The track fetch frequently answers 200 with an EMPTY body (YouTube gates it by request context, and a
// serverless IP is not the context it wants). That is treated as "no transcript" and the item falls back to
// the video description, which is thin but true. Nothing here ever asks a model to describe a video.
const CHROME_MARKERS = /skip navigation|sign in|about press copyright|keyboard shortcuts/i;

async function youtubeCaptions(watchUrl: string, signal?: AbortSignal): Promise<string> {
  try {
    const html = await fetchText(watchUrl, signal);
    const raw = html.match(/"captionTracks":(\[.*?\])/)?.[1];
    if (!raw) return "";
    const tracks = JSON.parse(raw.replace(/\\u0026/g, "&")) as Array<{
      baseUrl: string;
      languageCode?: string;
    }>;
    const track = tracks.find((t) => t.languageCode?.startsWith("en")) ?? tracks[0];
    if (!track?.baseUrl) return "";

    const body = await fetchText(`${track.baseUrl}&fmt=json3`, signal);
    if (!body.trim()) return ""; // the common case off a datacenter IP — not an error, just no transcript
    const parsed = JSON.parse(body) as { events?: Array<{ segs?: Array<{ utf8?: string }> }> };
    return (parsed.events ?? [])
      .flatMap((e) => (e.segs ?? []).map((s) => s.utf8 ?? ""))
      .join("")
      .replace(/\n+/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
  } catch (e) {
    console.error(`youtube captions failed for ${watchUrl}:`, e);
    return "";
  }
}

async function transcriptFor(entry: { url: string; raw: string }, signal?: AbortSignal): Promise<string> {
  // A podcast that declares its own transcript is the best case: fetch it straight, no third party at all.
  const declared = attr(entry.raw, "podcast:transcript", "url");
  if (declared) {
    try {
      const body = await fetchText(declared, signal);
      const text = declared.endsWith(".html") || body.trimStart().startsWith("<") ? stripHtml(body) : body;
      if (text.trim().length >= TRANSCRIPT_FLOOR) return text.slice(0, 12_000);
    } catch (e) {
      console.error(`transcript fetch failed for ${declared}:`, e);
    }
  }

  if (/youtube\.com|youtu\.be/.test(entry.url)) return youtubeCaptions(entry.url, signal);

  // Any other episode page is an ordinary article as far as extraction is concerned.
  const { text } = await articleText(entry.url, signal);
  return CHROME_MARKERS.test(text.slice(0, 400)) ? "" : text;
}

export const videoAdapter: Adapter = async (section, ctx: RunCtx) => {
  const s = section as VideoSection;
  const max = s.max_items ?? 3;
  const days = s.days ?? DEFAULT_DAYS;
  const cutoff = Date.now() - days * 86_400_000;

  const feedUrls = (
    await Promise.all(
      (s.channels ?? []).slice(0, MAX_CHANNELS).map(async (raw) => {
        const resolved = toFeedUrl(raw);
        if (!resolved) return null;
        return resolved.startsWith("resolve:")
          ? resolveChannelFeed(resolved.slice("resolve:".length), ctx.signal)
          : resolved;
      }),
    )
  ).filter((u): u is string => !!u);

  const perFeed = await Promise.all(
    feedUrls.map(async (feedUrl) => {
      try {
        const xml = await fetchText(feedUrl, ctx.signal);
        const source = feedTitle(xml);
        return parseFeed(xml)
          .filter((e) => !ctx.seen(urlHash(e.url)))
          .filter((e) => {
            if (!e.published_at) return true;
            const t = new Date(e.published_at).getTime();
            return Number.isNaN(t) || t >= cutoff;
          })
          .map((e) => ({ ...e, source }));
      } catch (err) {
        console.error(`video feed ${feedUrl} failed:`, err);
        return []; // one dead channel must not silence the section
      }
    }),
  );

  // Round-robin across channels, same fairness rule the feed adapter uses: a channel that posts daily must
  // not crowd out one that posts monthly.
  const ordered: Array<{ title: string; url: string; summary: string; published_at?: string; raw: string; source?: string }> = [];
  for (let rank = 0; ordered.length < max; rank++) {
    const row = perFeed.map((f) => f[rank]).filter(Boolean);
    if (!row.length) break;
    ordered.push(...row.slice(0, max - ordered.length));
  }

  // Transcription is the expensive step, so — as everywhere else in this pipeline — it happens after the cut.
  const items = await Promise.all(
    ordered.map(async (e): Promise<Item> => {
      const cached = ctx.cachedBody?.(urlHash(e.url));
      const text = cached ?? (await transcriptFor(e, ctx.signal));
      const body = text.trim().length >= TRANSCRIPT_FLOOR ? text : stripHtml(e.summary) || text;
      return {
        title: e.title,
        text: truncateAtBoundary(body, 12_000),
        url: e.url,
        source: e.source,
        published_at: e.published_at,
      };
    }),
  );

  return attachImages(
    items.filter((i) => i.text.trim()),
    ctx.signal,
  );
};

export { toFeedUrl };
