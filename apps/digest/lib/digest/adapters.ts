import type {
  Adapter,
  FeedSection,
  Item,
  PromptSection,
  ReadwiseSection,
  RunCtx,
  SearchSection,
  Section,
  SerialSection,
} from "./types";
import { aiEnabled, callModel, MODEL_GATHER, WEB_SEARCH_TOOL } from "./llm";
import { urlHash } from "./canonical";
import { createServiceClient } from "@/lib/supabase/server";
import { dailyReview, randomHighlights, type Highlight } from "./readwise";
import { articleText, attachImages, fetchText, stripHtml } from "./fetch";
import { feedTitle, parseFeed } from "./feedparse";
import { rankedAdapter } from "./sources/ranked";
import { selectValuable } from "./select";
import { inboxAdapter } from "./sources/inbox";
import { unreadAdapter } from "./sources/unread";
import { sitewatchAdapter } from "./sources/sitewatch";
import { videoAdapter } from "./sources/video";

// Source adapters. Each kind implements ONE contract — (section, ctx) => Item[] — so adding "Hacker News"
// or "my newsletter inbox" is a new function plus a registry line, never a new branch in the pipeline.
//
// The writer stage downstream never learns where an Item came from; it only sees text it was handed. That
// is the structural guarantee that a "fact" can't come from model memory.

// Network primitives (fetchText, articleText, attachImages) moved to ./fetch, and feed parsing to
// ./feedparse, once the adapters outgrew one file. Both are imported above; nothing here re-implements them.

// ---------------------------------------------------------------------------------------------------
// search — Anthropic's web_search server tool
// ---------------------------------------------------------------------------------------------------
// The one adapter where retrieval is model-mediated: web_search runs server-side and returns results in
// the same call, so there's no separate search API. It still ends at grounded Items with real URLs, and the
// WRITE stage still only sees the text those Items carry — the contract holds.
const searchAdapter: Adapter = async (section, ctx) => {
  const s = section as SearchSection;
  // Two kill-switches, both checked here rather than at the call site so every future caller inherits them
  // — a paid path should be impossible to reach by accident, not merely discouraged. `ai_enabled` is the
  // umbrella (this digest's AI tier at all); `web_search_enabled` is the narrower opt-in for the one gather
  // path that bills every run even within that tier.
  if (!aiEnabled(ctx.digest)) {
    console.info(`section ${s.id}: AI is off for this digest — skipping search`);
    return [];
  }
  if (!ctx.digest.web_search_enabled) {
    console.info(`section ${s.id}: web search is off for this digest — skipping`);
    return [];
  }
  const { text, sources } = await callModel(
    {
      system:
        "You are a research assistant gathering source material for a daily reading digest. " +
        "Search the web and report what you actually found, with a short factual note per item. " +
        "Report only what the sources say — never fill gaps from memory. " +
        "Output findings ONLY. No narration of your process ('I'll run three searches', 'one more attempt'), " +
        "no caveats about your search allowance, no preamble about what you're about to do — a downstream " +
        "writer reads this verbatim as source material, and your commentary reads to it as the story. " +
        "If nothing turned up, say exactly that in one line rather than padding.\n\n" +
        // Source quality is the whole ballgame on contemplative and cultural beats, where the top search
        // results are almost always SEO content farms. Ranking has to happen HERE, before the writer sees
        // anything — a writer handed listicles can only produce a well-written listicle.
        "SOURCE QUALITY — rank hard, and prefer fewer good items to more mediocre ones:\n" +
        "- PREFER: primary sources (the paper, the museum, the artist, the author's own site), established " +
        "publications and criticism, university and institutional pages, practitioners writing in their own voice.\n" +
        "- DISCARD SILENTLY: SEO listicles ('10 best X', 'X you need to know'), content farms, affiliate " +
        "roundups, AI-generated aggregator blogs, and anything recycling a press release without adding to it. " +
        "Do not report these even to say you found them.\n" +
        "- If the only thing you can find is content-farm material, report that the search came up empty. " +
        "An empty section is a fine outcome; a section built on slop is not.",
      prompt:
        `Today is ${ctx.issueDate}. Search for: ${s.query}\n\n` +
        `Run at most 3 distinct searches, and never repeat a query you have already run — your search ` +
        `allowance is limited and exhausting it means this section ships empty.\n` +
        `Focus on things published or meaningfully updated in the last few days. ` +
        `Return up to ${s.max_items ?? 6} items, each as: a headline, the source, and 2-3 sentences of what it actually says.`,
      model: MODEL_GATHER,
      tools: [WEB_SEARCH_TOOL],
      maxTokens: 4000,
      effort: "medium",
      signal: ctx.signal,
    },
    { fn: "digest-gather", operation: "search", issueId: null, userId: ctx.digest.owner_id },
  );

  if (!text) return [];
  // The whole result is one grounding blob; the citations become the item list the reader UI shows.
  const items: Item[] = [{ title: s.query, text, source: "web search", url: sources[0]?.url }].concat(
    sources.slice(1).map((src) => ({ title: src.title, text: "", url: src.url, source: "web search" })),
  );
  return attachImages(items, ctx.signal);
};

// ---------------------------------------------------------------------------------------------------
// feed — RSS/Atom, then full article text
// ---------------------------------------------------------------------------------------------------
// A feed gives you a title and a ~200-char teaser. Summarizing teasers produces content-free mush, so the
// article body is fetched too (articleText, in ./fetch — one extraction path for every adapter).
const MAX_FEEDS_PER_SECTION = 6;

// How many candidates to line up per slot before choosing. 4× gives the cut something real to work with
// while keeping the triage prompt small — the candidates carry titles and summaries, not article bodies.
const OVERFETCH = 4;

// Read every feed first, THEN interleave, THEN cap, and only fetch article bodies for the survivors.
//
// The obvious loop — walk feed 1 to the cap, then feed 2 — is wrong in two ways once a section has several
// feeds, which is now the normal case. It never reaches the later feeds at all (a 3-item cap means feed 1
// answers every morning and Colossal is never read), and it pays for full article extraction on candidates
// that the cap then throws away. Round-robin fixes the fairness; deferring extraction until after the cut
// means N article fetches instead of one per candidate across every feed.
const feedAdapter: Adapter = async (section, ctx) => {
  const s = section as FeedSection;
  const max = s.max_items ?? 5;

  const perFeed = await Promise.all(
    s.urls.slice(0, MAX_FEEDS_PER_SECTION).map(async (feedUrl) => {
      try {
        const xml = await fetchText(feedUrl, ctx.signal);
        const source = feedTitle(xml);
        return parseFeed(xml)
          .filter((e) => !ctx.seen(urlHash(e.url))) // already delivered — the point of the dedupe layer
          .map(
            (e): Item & { summary: string } => ({
              title: e.title,
              url: e.url,
              source,
              text: "",
              summary: e.summary,
              published_at: e.published_at,
            }),
          );
      } catch (e) {
        console.error(`feed ${feedUrl} failed:`, e);
        return []; // one dead feed must not silence the section
      }
    }),
  );

  // Interleave: first item of every feed, then second of every feed, … so a busy publisher can't crowd out
  // a quiet one just by posting more often.
  //
  // Build a POOL several times the cap, not the cap itself — a cut can only be as good as what it chooses
  // between, and taking exactly `max` here would leave nothing to choose. Still free at this point: these
  // are titles and feed summaries, no article has been fetched.
  const pool: Array<Item & { summary: string }> = [];
  const poolSize = max * OVERFETCH;
  for (let rank = 0; pool.length < poolSize; rank++) {
    const row = perFeed.map((f) => f[rank]).filter(Boolean);
    if (!row.length) break;
    pool.push(...row.slice(0, poolSize - pool.length));
  }

  // ②½ SELECT — pick by worth, not by feed position. One cheap call over titles + summaries.
  const ordered = await selectValuable(pool, max, section, ctx, null);

  // Now — and only now — pay for article extraction, on exactly the items that will be used, and only for
  // the ones whose body we don't already hold from a previous run.
  const items = await Promise.all(
    ordered.map(async ({ summary, ...item }) => {
      const cached = ctx.cachedBody?.(urlHash(item.url!));
      if (cached) return { ...item, text: cached };
      const { text, publishedAt } = await articleText(item.url!, ctx.signal);
      // The extractor's date beats the feed's when the feed didn't give one.
      return { ...item, text: text || summary, published_at: item.published_at ?? publishedAt };
    }),
  );

  return attachImages(items, ctx.signal);
};

// ---------------------------------------------------------------------------------------------------
// serial — N pages a day out of a book you already have in Pensive
// ---------------------------------------------------------------------------------------------------
// This is "predetermined content fed into the pipeline": a course, a re-read, your own notes. No LLM and no
// network. The cursor rides books.digest_bookmarked_page_index, which has been sitting unused in the schema.
//
// The service-role client bypasses RLS, so ownership is checked here by hand — the digest owner must own the
// book. (Collaborator access via book_access is a deliberate later step, not an oversight.)
const serialAdapter: Adapter = async (section, ctx) => {
  const s = section as SerialSection;
  const db = createServiceClient();
  const perDay = Math.max(1, Math.min(s.pages_per_day ?? 1, 10));

  const { data: book } = await db
    .from("books")
    .select("id, name, owner_id, digest_bookmarked_page_index")
    .eq("id", s.book_id)
    .maybeSingle();
  if (!book || book.owner_id !== ctx.digest.owner_id) return [];

  const from = book.digest_bookmarked_page_index ?? 0;
  const { data: pages } = await db
    .from("pages")
    .select("id, title, content, html_content, page_index")
    .eq("book_id", s.book_id)
    .eq("archived", false)
    .gte("page_index", from)
    .order("page_index", { ascending: true })
    .limit(perDay);

  if (!pages?.length) return [];

  // Advance the cursor only after a successful read, and let it wrap so a finished book restarts rather
  // than going silent forever.
  const last = pages[pages.length - 1] as { page_index: number };
  await db.from("books").update({ digest_bookmarked_page_index: last.page_index + 1 }).eq("id", s.book_id);

  return (pages as Array<Record<string, unknown>>).map((p) => ({
    title: (p.title as string) || `${book.name} — page ${(p.page_index as number) + 1}`,
    text: plainText(p.content) || stripHtml((p.html_content as string) ?? ""),
    source: book.name as string,
  }));
};

// pages.content is TipTap JSON. A tiny recursive text walk beats importing the web app's converter across an
// app boundary — this only needs readable prose, not fidelity.
function plainText(node: unknown): string {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(plainText).join("");
  const n = node as Record<string, unknown>;
  if (n.type === "text" && typeof n.text === "string") return n.text;
  const inner = plainText(n.content);
  return typeof n.type === "string" && /paragraph|heading|listItem/.test(n.type) ? `${inner}\n\n` : inner;
}

// ---------------------------------------------------------------------------------------------------
// prompt — no retrieval at all
// ---------------------------------------------------------------------------------------------------
// A reflection, a question of the day. There is nothing to gather; the WRITE stage generates from the
// instructions alone. Returning one empty-text Item keeps the section non-empty so it isn't dropped in ④.
const promptAdapter: Adapter = async (section) => [
  { title: section.title, text: "", source: "generated" },
];

// ---------------------------------------------------------------------------------------------------
// readwise — quotes out of the reader's own highlight vault
// ---------------------------------------------------------------------------------------------------
// The inverse of every other source here: not "what happened today" but "what you already thought was
// worth keeping". No model call at either stage — the gather is an HTTP read and the write is a
// deterministic render (see write.ts), because a quote's whole value is that it is verbatim.
//
// The credential is per-USER, and read HERE rather than passed in, for the same reason the web-search
// kill switch lives inside its adapter: a paid/authenticated path should be impossible to reach by
// accident from some future caller. Two independent gates — the toggle and the token — and either one
// being off makes the section a silent no-op rather than an error.
const readwiseAdapter: Adapter = async (section, ctx) => {
  const s = section as ReadwiseSection;
  const max = s.max_items ?? 3;

  const { data } = await createServiceClient()
    .from("digest_user_settings")
    .select("readwise_enabled, readwise_token")
    .eq("user_id", ctx.digest.owner_id)
    .maybeSingle();

  const settings = data as { readwise_enabled: boolean; readwise_token: string | null } | null;
  if (!settings?.readwise_enabled || !settings.readwise_token) {
    console.info(`section ${s.id}: Readwise is not connected for this user — skipping`);
    return [];
  }

  const token = settings.readwise_token;
  // `random` over-draws (3× the cap) so the seen-filter below has something left to hand over. `review` takes
  // what Readwise offers — over-drawing isn't possible, and a thin review day is a thin section, honestly.
  const highlights =
    s.mode === "random"
      ? await randomHighlights(token, { count: max * 3, category: s.category, signal: ctx.signal })
      : await dailyReview(token, ctx.signal);

  return highlights
    .filter((h) => h.text?.trim())
    .filter((h) => !ctx.seen(urlHash(h.url))) // a quote already sent is not a quote worth sending again
    .slice(0, max)
    .map(toItem);
};

function toItem(h: Highlight): Item {
  return {
    // The source, not the quote: `title` is what the writer/reader see as the attribution line, and a
    // 300-character highlight makes a terrible title.
    title: h.title ?? "Readwise highlight",
    text: h.text.trim(),
    note: h.note?.trim() || undefined,
    url: h.url,
    source: h.author ?? undefined,
    published_at: h.highlighted_at,
  };
}

// The registry. Adding a source is a line here plus a file in ./sources — never a branch in the pipeline.
// `quiz` is deliberately absent: it is a CLOSER, not a source (see closers.ts), and the missing entry is
// what makes that structural rather than conventional.
export const ADAPTERS: Partial<Record<Section["kind"], Adapter>> = {
  search: searchAdapter,
  feed: feedAdapter,
  serial: serialAdapter,
  prompt: promptAdapter,
  readwise: readwiseAdapter,
  ranked: rankedAdapter,
  inbox: inboxAdapter,
  unread: unreadAdapter,
  sitewatch: sitewatchAdapter,
  video: videoAdapter,
};

export async function gather(section: Section, ctx: RunCtx): Promise<Item[]> {
  const adapter = ADAPTERS[section.kind];
  if (!adapter) return [];
  try {
    return await adapter(section, ctx);
  } catch (e) {
    // One broken feed must not kill the morning's digest.
    console.error(`gather ${section.kind}/${section.id} failed:`, e);
    return [];
  }
}

export type { PromptSection };
