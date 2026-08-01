import type { Adapter, Item, RankedSection, RunCtx } from "../types";
import { articleText, attachImages, fetchJson, fetchText, UA } from "../fetch";
import { attr, parseFeed } from "../feedparse";
import { urlHash } from "../canonical";

// ranked — sources that ship their OWN ranking signal.
//
// The pipeline's sharpest gap is that selection is not ranking: a feed hands you 40 items in publication
// order and the section takes the first 5. Building a ranker is a real project. Borrowing one is a file.
// Every source here answers "what did the world think of this?" with a number — HN points, reddit score,
// Lobsters hotness — or with an editorial prior strong enough to stand in for one (arXiv's category, a
// maintainer cutting a release). We rank on that number BEFORE paying for article extraction, which is the
// same discipline the feed adapter uses: cut first, then fetch.
//
// All five are keyless public endpoints. That is deliberate — a source that needs a credential is a source
// that silently stops working, and the digest has enough of those already.

interface Candidate extends Item {
  score: number;
}

const DEFAULT_DAYS = 2;

// ---------------------------------------------------------------------------------------------------
// Hacker News — Algolia's search API
// ---------------------------------------------------------------------------------------------------
// search_by_date + a points floor is the useful shape: "everything above the bar since yesterday", not
// "today's front page", which is a popularity contest already in progress.
interface AlgoliaHit {
  title: string;
  url: string | null;
  points: number;
  objectID: string;
  created_at: string;
  story_text?: string | null;
  num_comments?: number;
}

async function hn(s: RankedSection, since: number, signal?: AbortSignal): Promise<Candidate[]> {
  const filters = [`points>${s.min_score ?? 100}`, `created_at_i>${since}`].join(",");
  const q = new URLSearchParams({ tags: "story", numericFilters: filters, hitsPerPage: "50" });
  if (s.query) q.set("query", s.query);
  const { hits } = await fetchJson<{ hits: AlgoliaHit[] }>(
    `https://hn.algolia.com/api/v1/search_by_date?${q}`,
    signal,
  );
  return (hits ?? []).map((h) => ({
    title: h.title,
    // An Ask HN post has no external url; the discussion IS the item.
    url: h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`,
    text: h.story_text ?? "",
    source: "Hacker News",
    published_at: h.created_at,
    score: h.points ?? 0,
  }));
}

// ---------------------------------------------------------------------------------------------------
// Lobsters
// ---------------------------------------------------------------------------------------------------
interface LobsterStory {
  title: string;
  url: string;
  short_id_url: string;
  score: number;
  created_at: string;
  description_plain?: string;
}

async function lobsters(s: RankedSection, signal?: AbortSignal): Promise<Candidate[]> {
  const stories = await fetchJson<LobsterStory[]>("https://lobste.rs/hottest.json", signal);
  return (stories ?? []).map((st) => ({
    title: st.title,
    url: st.url || st.short_id_url,
    text: st.description_plain ?? "",
    source: "Lobsters",
    published_at: st.created_at,
    score: st.score ?? 0,
  }));
}

// ---------------------------------------------------------------------------------------------------
// Reddit
// ---------------------------------------------------------------------------------------------------
// Reddit blocks a lot of datacenter traffic and answers 403 to anything it dislikes. One subreddit failing
// must not empty the section, so each is fetched independently and failures are logged, not thrown.
interface RedditListing {
  data: {
    children: Array<{
      data: {
        title: string;
        url: string;
        permalink: string;
        score: number;
        created_utc: number;
        selftext?: string;
        subreddit: string;
        stickied?: boolean;
      };
    }>;
  };
}

async function reddit(s: RankedSection, signal?: AbortSignal): Promise<Candidate[]> {
  const subs = (s.targets ?? []).map((t) => t.replace(/^\/?r\//, "").trim()).filter(Boolean);
  const perSub = await Promise.all(
    subs.map(async (sub) => {
      try {
        const listing = await fetchJson<RedditListing>(
          `https://www.reddit.com/r/${encodeURIComponent(sub)}/top.json?t=day&limit=25`,
          signal,
        );
        return (listing.data?.children ?? [])
          .map((c) => c.data)
          .filter((p) => !p.stickied)
          .map(
            (p): Candidate => ({
              title: p.title,
              // A self-post's content is the post; a link post's is elsewhere. Either way the permalink is
              // the stable identity, so link posts keep the outbound url and self-posts keep the thread.
              url: p.selftext ? `https://www.reddit.com${p.permalink}` : p.url,
              text: p.selftext ?? "",
              source: `r/${p.subreddit}`,
              published_at: new Date(p.created_utc * 1000).toISOString(),
              score: p.score ?? 0,
            }),
          );
      } catch (e) {
        console.error(`reddit r/${sub} failed:`, e);
        return [];
      }
    }),
  );
  return perSub.flat();
}

// ---------------------------------------------------------------------------------------------------
// arXiv — the primary-source answer to the content-farm problem
// ---------------------------------------------------------------------------------------------------
// No votes here, and that is fine: the ranking prior is the category plus recency, and every item is the
// paper itself rather than someone's write-up of it. The abstract is real grounding text, so no article
// extraction is needed at all — this is the cheapest good source in the whole app.
async function arxiv(s: RankedSection, signal?: AbortSignal): Promise<Candidate[]> {
  const cats = (s.targets ?? []).filter(Boolean).map((c) => `cat:${c}`);
  const terms = s.query ? [`all:"${s.query.replace(/"/g, "")}"`] : [];
  const search = [cats.length ? `(${cats.join(" OR ")})` : "", terms.join(" AND ")]
    .filter(Boolean)
    .join(" AND ");
  if (!search) return [];

  const q = new URLSearchParams({
    search_query: search,
    sortBy: "submittedDate",
    sortOrder: "descending",
    max_results: "30",
  });
  const xml = await fetchText(`https://export.arxiv.org/api/query?${q}`, signal);

  return parseFeed(xml).map((e, n) => ({
    title: e.title.replace(/\s+/g, " "),
    // The abstract IS the grounding. Nothing else to fetch.
    text: e.summary.replace(/\s+/g, " "),
    url: e.url,
    // The category is an attribute (<arxiv:primary_category term="cs.CL"/>), not an element body.
    source: ["arXiv", attr(e.raw, "arxiv:primary_category", "term")].filter(Boolean).join(" · "),
    published_at: e.published_at,
    // No score exists; preserve the feed's own ordering (newest first) as the rank.
    score: 1000 - n,
  }));
}

// ---------------------------------------------------------------------------------------------------
// GitHub releases — "what changed in the tools I use"
// ---------------------------------------------------------------------------------------------------
// Unauthenticated (60 req/hr, ample for a handful of repos per morning). The release notes are the body,
// which makes this another zero-extraction source.
interface GhRelease {
  name: string | null;
  tag_name: string;
  html_url: string;
  body: string | null;
  published_at: string;
  draft: boolean;
  prerelease: boolean;
}

async function github(s: RankedSection, signal?: AbortSignal): Promise<Candidate[]> {
  const repos = (s.targets ?? []).map((r) => r.replace(/^https?:\/\/github\.com\//, "").trim()).filter(Boolean);
  // Unauthenticated is 60 requests/hour PER IP, and a serverless function shares its IP with strangers —
  // measured empty from a shared host. GITHUB_TOKEN (any read-only PAT) lifts it to 5,000 and is optional:
  // without it the section still works, it just fails on a busy hour.
  const token = process.env.GITHUB_TOKEN;
  const perRepo = await Promise.all(
    repos.map(async (repo) => {
      try {
        const res = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=3`, {
          signal,
          headers: {
            accept: "application/vnd.github+json",
            "user-agent": UA,
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
        });
        const body: unknown = await res.json();
        // A rate-limit or 404 answers with an OBJECT, not an array. Branching on the shape rather than
        // trusting the type parameter is what stops `.filter is not a function` from eating the section.
        if (!Array.isArray(body)) {
          console.error(`github ${repo}: ${(body as { message?: string })?.message ?? res.status}`);
          return [];
        }
        const releases = body as GhRelease[];
        return releases
          .filter((r) => !r.draft && !r.prerelease)
          .map(
            (r): Candidate => ({
              title: `${repo} ${r.name || r.tag_name}`,
              text: (r.body ?? "").slice(0, 6000),
              url: r.html_url,
              source: repo,
              published_at: r.published_at,
              // Recency is the only ranking that means anything for a release.
              score: Math.floor(new Date(r.published_at).getTime() / 1000),
            }),
          );
      } catch (e) {
        console.error(`github ${repo} failed:`, e);
        return [];
      }
    }),
  );
  return perRepo.flat();
}

// ---------------------------------------------------------------------------------------------------

const FETCHERS: Record<
  RankedSection["source"],
  (s: RankedSection, since: number, signal?: AbortSignal) => Promise<Candidate[]>
> = {
  hn,
  lobsters: (s, _since, signal) => lobsters(s, signal),
  reddit: (s, _since, signal) => reddit(s, signal),
  arxiv: (s, _since, signal) => arxiv(s, signal),
  github: (s, _since, signal) => github(s, signal),
};

export const rankedAdapter: Adapter = async (section, ctx: RunCtx) => {
  const s = section as RankedSection;
  const max = s.max_items ?? 5;
  const days = s.days ?? DEFAULT_DAYS;
  const since = Math.floor((Date.now() - days * 86_400_000) / 1000);

  const fetcher = FETCHERS[s.source];
  if (!fetcher) return [];

  const candidates = await fetcher(s, since, ctx.signal);

  // THE CUT, in this order and for this reason: drop what's already been delivered, drop what's below the
  // bar or outside the window, rank on the source's own number, and only then cap. Extraction comes after
  // the cap so we never pay r.jina.ai for an item the cap was going to throw away.
  const cutoffMs = Date.now() - days * 86_400_000;
  const survivors = candidates
    .filter((c) => c.url && !ctx.seen(urlHash(c.url)))
    .filter((c) => (s.min_score ? c.score >= s.min_score : true))
    .filter((c) => {
      if (!c.published_at) return true;
      const t = new Date(c.published_at).getTime();
      return Number.isNaN(t) || t >= cutoffMs;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, max);

  // arXiv abstracts, release notes and self-posts ARE the grounding — nothing to fetch. Link-out sources
  // (HN, reddit, Lobsters) hand over a headline and a number, which is not something to write from, so they
  // default to fetching the article. Explicit `fetch_body` overrides either way.
  const linkOut = s.source === "hn" || s.source === "reddit" || s.source === "lobsters";
  const needsBody = s.fetch_body ?? linkOut;

  const withBodies = await Promise.all(
    survivors.map(async (c) => {
      if (c.text.trim()) return c;
      if (!needsBody) return { ...c, text: groundingLine(c) };
      const cached = ctx.cachedBody?.(urlHash(c.url!));
      if (cached) return { ...c, text: cached };
      const { text } = await articleText(c.url!, ctx.signal);
      // Never hand back an empty body: writeSection drops text-less items, so a failed extraction would
      // silently shrink the section rather than visibly degrade it. The headline and the score are true
      // things the source said, which is the floor this pipeline requires.
      return { ...c, text: text || groundingLine(c) };
    }),
  );

  return attachImages(withBodies, ctx.signal);
};

// The minimum honest grounding for an item whose body we couldn't (or shouldn't) fetch: what the source
// said, and how the source ranked it. The writer can say "X was posted and got 340 points" without
// inventing anything.
function groundingLine(c: Candidate): string {
  return `${c.title} — posted to ${c.source ?? "the source"}${c.score ? `, score ${c.score}` : ""}. ${c.url}`;
}
