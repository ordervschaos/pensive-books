import type { SupabaseClient } from "@supabase/supabase-js";

// The domain contract. Everything in the pipeline speaks these three shapes.
//
// The important one is `Adapter`: every source kind — web search, RSS, a book you're re-reading, a pure
// prompt — collapses to "produce Items". That is what makes adding a source a new file rather than a new
// branch in the pipeline (source-adapter / plugin pattern). The writer stage downstream never learns
// where an Item came from; it only ever sees text it was handed, which is the structural guarantee that
// the model cannot source a "fact" from its own memory.

export type SectionKind =
  | "search"
  | "feed"
  | "serial"
  | "prompt"
  | "readwise"
  | "ranked"
  | "inbox"
  | "unread"
  | "sitewatch"
  | "video"
  | "quiz";

/**
 * How often a section runs. The digest has ONE delivery clock; sections need their own, because half of
 * them are weekly by nature — a resurfacer, a leftovers pass, a narrow beat that publishes twice a month.
 * Without this every kind is forced onto a daily rhythm it can't fill, and the reader learns to expect
 * empty sections. Evaluated against the LOCAL issue date, so it lands on the reader's Sunday, not UTC's.
 */
export type Cadence = "daily" | "weekdays" | "weekly";

export interface SectionBase {
  id: string;
  kind: SectionKind;
  title: string;
  enabled?: boolean;
  /** Tier-3 instruction: what to look for in this section and what to do with it. */
  instructions?: string;
  /** Hard cap on items handed to the writer. Ranking happens before this cut. */
  max_items?: number;
  /** Omitted = daily, which is what every section did before cadence existed. */
  cadence?: Cadence;
  /** `weekly` only: 0 = Sunday … 6 = Saturday. Omitted = Sunday. */
  weekday?: number;
}

export interface SearchSection extends SectionBase {
  kind: "search";
  query: string;
}

export interface FeedSection extends SectionBase {
  kind: "feed";
  urls: string[];
}

export interface SerialSection extends SectionBase {
  kind: "serial";
  /** A book in the main Pensive app. Read-only: the digest never writes to books/pages. */
  book_id: number;
  pages_per_day?: number;
}

export interface PromptSection extends SectionBase {
  kind: "prompt";
}

/**
 * Quotes out of the reader's own Readwise vault. The credential is per-USER (digest_user_settings), not
 * per-section, so a section carries only *which* quotes to draw — never the key.
 */
export interface ReadwiseSection extends SectionBase {
  kind: "readwise";
  /** `review` = Readwise's own daily spaced-repetition pick. `random` = our resurfacer over the library. */
  mode?: "review" | "random";
  /** `random` only: restrict the draw to one shelf. Omitted = the whole vault. */
  category?: "books" | "articles" | "tweets" | "podcasts";
}

/**
 * A source that ships its OWN ranking signal — HN points, arXiv's category, a repo's release cadence,
 * Lobsters' hotness. The digest's sharpest missing piece is ranking ("pick 3 of 40"); the cheapest way to
 * get it is to draw from places where the world already voted, and take the score with the item.
 */
export interface RankedSection extends SectionBase {
  kind: "ranked";
  source: "hn" | "reddit" | "arxiv" | "github" | "lobsters";
  /** hn/arxiv: the query. Ignored by github/lobsters. */
  query?: string;
  /** reddit: subreddit names. github: `owner/repo`. arxiv: categories like `cs.CL`. */
  targets?: string[];
  /** Floor on the source's own score (hn points, reddit upvotes, lobsters score). Ignored where meaningless. */
  min_score?: number;
  /** Look back this many days. Default 2 — a daily digest is not an archive. */
  days?: number;
  /** Fetch the linked article body for surviving items. Off = the source's own summary is enough. */
  fetch_body?: boolean;
}

/**
 * Mail sent TO this digest — newsletters you already subscribe to, forwarded or re-subscribed at the
 * digest's own address. The only PUSH source in the pipeline: nothing is polled, the sender delivers.
 * Curation is free here, because the reader already chose these writers by subscribing.
 */
export interface InboxSection extends SectionBase {
  kind: "inbox";
  /** Only mail from these addresses/domains (substring match on the sender). Empty = everything. */
  senders?: string[];
  /** How far back to look. Default 2 days; a weekly section wants 7. */
  days?: number;
}

/**
 * The corpus's own leftovers: posts this digest fetched and never used. Free content out of data already
 * being paid for, and the honest answer to "40 pulled, 3 used". Deliberately skips the last couple of days
 * so it can't race the sections that are still considering those posts.
 */
export interface UnreadSection extends SectionBase {
  kind: "unread";
  /** Ignore anything fetched in the last N days (default 3) — still fresh enough for a normal section. */
  min_age_days?: number;
  /** Ignore anything older than N days (default 30). */
  max_age_days?: number;
}

/**
 * Pages with no feed: a syllabus, a status page, a friend's site. Emits an item only when the extracted
 * text actually CHANGED since the last run — the cheapest "watch anything" primitive, and it reuses the
 * corpus (digest_posts.body) as its memory rather than adding a table.
 */
export interface SitewatchSection extends SectionBase {
  kind: "sitewatch";
  urls: string[];
}

/**
 * Video and podcast, read instead of watched. Medium conversion is the whole point: an hour of video
 * becomes six minutes of reading, which is the one thing a Kindle can do that YouTube cannot.
 */
export interface VideoSection extends SectionBase {
  kind: "video";
  /** YouTube channel URLs/ids/@handles, or any podcast RSS url. Resolved to feeds in the adapter. */
  channels: string[];
  days?: number;
}

/**
 * A CLOSER, not a source: it consumes the sections already written rather than retrieving anything.
 * Retrieval practice on the LAST issue — the one thing a digest can do that a feed reader structurally
 * cannot, because only the digest knows what it told you yesterday.
 */
export interface QuizSection extends SectionBase {
  kind: "quiz";
  /** Quiz the previous issue (default) or the one being assembled right now. */
  over?: "previous" | "today";
}

export type Section =
  | SearchSection
  | FeedSection
  | SerialSection
  | PromptSection
  | ReadwiseSection
  | RankedSection
  | InboxSection
  | UnreadSection
  | SitewatchSection
  | VideoSection
  | QuizSection;

/** Kinds that run AFTER the source sections, over their output. See `Closer`. */
export const CLOSER_KINDS: ReadonlyArray<SectionKind> = ["quiz"];

export function isCloser(kind: SectionKind): boolean {
  return CLOSER_KINDS.includes(kind);
}

/**
 * CADENCE. The digest has one delivery clock; a section may have its own, because half the useful kinds are
 * weekly by nature — a resurfacer, a leftovers pass, a beat that publishes twice a month. Forcing those onto
 * a daily rhythm is how a reader learns to expect empty sections.
 *
 * Evaluated against the LOCAL issue date (the digest's timezone already produced that string), so "Sunday"
 * means the reader's Sunday. Noon-UTC parsing avoids the date shifting under the parser itself.
 *
 * Lives here rather than in `build.ts` because it is a property of a Section, and `readiness.ts` has to ask
 * the same question — "was this section even due?" — to tell a genuinely dead section apart from a weekly
 * one that simply wasn't up. Two copies of this rule would disagree the first time either changed.
 */
export function runsToday(section: Section, issueDate: string): boolean {
  const cadence = section.cadence ?? "daily";
  if (cadence === "daily") return true;

  const day = new Date(`${issueDate}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  if (cadence === "weekdays") return day >= 1 && day <= 5;
  return day === (section.weekday ?? 0);
}

/** A retrieved unit of grounding. `text` is the ONLY thing the writer may draw facts from. */
export interface Item {
  title: string;
  text: string;
  url?: string;
  source?: string;
  published_at?: string;
  /**
   * The SOURCE's own ranking score (HN points, reddit upvotes, GitHub stars). Present only for sources that
   * carry one. Not persisted — it is a selection input, used before the cut and then discarded.
   */
  score?: number;
  /**
   * The reader's OWN annotation on this item, if the source carries one (Readwise highlights do). Kept
   * separate from `text` because it is the one piece of material in the pipeline that isn't a source at
   * all — it's the reader talking back to it, and it must never be blended into the quote itself.
   */
  note?: string;
  /**
   * A lead image discovered DETERMINISTICALLY from the page (og:image), never authored by the model.
   * The writer may ask for an image by item index; it can never supply a URL. That keeps the "the model
   * does not invent URLs" rule intact for pictures as well as for citations.
   */
  image_url?: string;
}

export interface Digest {
  id: number;
  owner_id: string;
  name: string;
  timezone: string;
  deliver_at: string;
  active: boolean;
  voice: string | null;
  /** Opt-in for `search` sections — the only gather path that bills per run. Default false. */
  web_search_enabled: boolean;
  /** Umbrella gate for every model call (search/select/write/quiz). Default false — the paid AI tier. */
  ai_enabled: boolean;
  /** Routing token for this digest's inbound address (`read+<token>@…`). See the inbox source. */
  inbox_token?: string | null;
  sections: Section[];
  delivery: { kindle_email?: string; format?: "html" | "epub" };
}

/** What the WRITE stage produces for one section, and what the reader UI renders. */
export interface RenderedSection {
  id: string;
  title: string;
  markdown: string;
  items: Array<Pick<Item, "title" | "url" | "source" | "image_url">>;
}

export interface IssueContent {
  intro?: string;
  sections: RenderedSection[];
}

export interface RunCtx {
  digest: Digest;
  /** Local issue date (YYYY-MM-DD) in the digest's timezone. */
  issueDate: string;
  /**
   * True if this url_hash has already been DELIVERED by this digest. Deliberately not "fetched": a post we
   * pulled and passed over must stay eligible, or the corpus would blacklist everything it ever saw.
   */
  seen: (urlHash: string) => boolean;
  /** Previously extracted body for a url_hash, so a re-run doesn't re-fetch an article we already have. */
  cachedBody?: (urlHash: string) => string | undefined;
  /**
   * Service-role client, for the stages that read or write the corpus mid-run (the trim pass caches its
   * result per post). Optional because an adapter must never need it — gather stays pure retrieval.
   */
  db?: SupabaseClient;
  /** The issue these calls belong to, for `ai_calls` attribution. Null in a preview: real spend, no issue. */
  issueId?: number | null;
  signal?: AbortSignal;
}

export type Adapter = (section: Section, ctx: RunCtx) => Promise<Item[]>;

/**
 * The second contract. A closer takes the sections that were already written and produces one more — a
 * quiz, a "what to make of all this", a letter framing. Modelling these as Adapters would be a type lie
 * (they retrieve nothing) and would force fake Items through the writer; a separate signature keeps the
 * source registry honest and makes the ordering constraint visible: closers run last, by construction.
 */
export type Closer = (
  section: Section,
  sections: RenderedSection[],
  ctx: RunCtx,
  issueId: number | null,
) => Promise<RenderedSection | null>;
