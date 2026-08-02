import type { SupabaseClient } from "@supabase/supabase-js";
import { appOrigin } from "@/lib/pensive";
import { isCloser, runsToday } from "./types";
import type { Digest, IssueContent, Section } from "./types";

// READINESS — "will this digest produce something worth reading tomorrow at 6am?", answered from data.
//
// The failure this exists to kill is the SILENT SKIP. A `search` section with AI off, a `readwise` section
// whose token was never entered, a feed that has served nothing but 2019 archive posts — every one of these
// compiles fine, delivers fine, and simply isn't there. The reader finds out at 6am, or never. Nothing in
// the pipeline is broken enough to log an error, which is exactly why a separate pass has to ask.
//
// Two properties are deliberate:
//
//   1. DERIVED, NEVER STORED. `readiness()` is a pure function of rows you already have — no new table, no
//      wizard step to migrate, no state to keep in sync with reality. Adding a check is adding a term.
//   2. PURE, so the caller decides where the data comes from. The page uses `loadReadiness` (RLS-scoped);
//      the agent will call `readiness()` with the same shape and get the same sentences. That is what keeps
//      "what the screen says" and "what the agent believes" from being two different opinions.
//
// It also splits BLOCKING from DEGRADING, because they are different kinds of bad news. Blocking = this
// will produce nothing (or this section will silently vanish). Degrading = it will deliver, but it isn't
// earning its place. Only the corpus can see the second kind, which is most of why the corpus exists.

const LOOKBACK_ISSUES = 5;
/** A section that was due this many times and never appeared once is silent, not merely quiet. */
const MIN_DUE_RUNS = 3;
/** Median age above which a "daily" is really serving an archive. Measured: James Clear 6.8y, Daily Stoic 3y. */
const STALE_DAYS = 180;
/** Below this, a median is one lucky old post rather than a pattern. */
const MIN_POSTS_FOR_AGE = 4;

export type ReadinessLevel = "blocking" | "degrading";

export interface ReadinessNote {
  level: ReadinessLevel;
  /** Set when the note is about one section, so the UI can name it and the agent can act on it. */
  sectionId?: string;
  /** One line, plain: what is wrong. */
  title: string;
  /** What actually happens because of it — the reason to care. */
  detail: string;
  fix?: { label: string; href: string };
}

export interface Readiness {
  notes: ReadinessNote[];
  blocking: number;
  degrading: number;
  /** The single next thing worth doing. Null when there is nothing to say. */
  next: string | null;
}

/** One past issue, reduced to the only two facts readiness cares about. */
export interface IssueSummary {
  issue_date: string;
  status: string;
  /** Ids of the sections that actually made it into the issue. */
  sectionIds: string[];
}

export interface PostSummary {
  section_id: string | null;
  published_at: string | null;
}

export interface ReadinessInput {
  digest: Pick<Digest, "id" | "sections" | "active" | "ai_enabled" | "web_search_enabled">;
  /** Already resolved: the digest's own override, else the account's OTP-verified address, else null. */
  kindleEmail: string | null;
  /** Readwise connected AND verified. A stored-but-unverified token is not readiness. */
  readwiseReady: boolean;
  /** Newest first. */
  issues: IssueSummary[];
  posts: PostSummary[];
  /** Messages ever received at this digest's inbound address. */
  inboxCount: number;
}

// ---------------------------------------------------------------------------------------------------
// The pure pass
// ---------------------------------------------------------------------------------------------------

export function readiness(input: ReadinessInput): Readiness {
  const { digest } = input;
  const id = digest.id;
  const settings = { label: "Settings", href: `/digests/${id}/settings` };
  const sections = (digest.sections ?? []) as Section[];
  const live = sections.filter((s) => s.enabled !== false);
  const notes: ReadinessNote[] = [];

  // --- digest-level, worst first -------------------------------------------------------------------
  if (sections.length === 0) {
    notes.push({
      level: "blocking",
      title: "No sources yet",
      detail: "There is nothing to compile, so no issue will be built.",
    });
  } else if (live.length === 0) {
    notes.push({
      level: "blocking",
      title: "Every source is switched off",
      detail: "Nothing is enabled, so the build has nothing to gather.",
    });
  } else if (live.every((s) => isCloser(s.kind))) {
    // A closer reads what the source sections wrote, and only runs when something was written. On its own
    // it can never fire — a constraint that is structural in the pipeline and invisible in the form.
    notes.push({
      level: "blocking",
      title: "Only a closer is configured",
      detail: "A quiz runs over the sections that were written. With no source section, nothing is.",
    });
  }

  if (!digest.active) {
    notes.push({
      level: "blocking",
      title: "This digest is paused",
      detail: "The scheduler skips inactive digests, so nothing is delivered until it's switched back on.",
      fix: settings,
    });
  }

  if (!input.kindleEmail) {
    // Worth its own check because the failure is late and total: the issue compiles, costs whatever it
    // costs, and then dies at the delivery step with "no verified Kindle address on file".
    notes.push({
      level: "blocking",
      title: "No verified Kindle address",
      detail: "The issue would build and then fail at delivery. Verify one in the main app.",
      fix: { label: "Verify a Kindle address", href: `${appOrigin()}/settings/kindle` },
    });
  }

  // --- per section: the silent skips ----------------------------------------------------------------
  // Each of these is a section that saves happily, shows nothing wrong, and then isn't in the issue.
  for (const s of live) {
    if (s.kind === "search" && !digest.ai_enabled) {
      notes.push(skipped(s, "AI writing is off for this digest", settings));
    } else if (s.kind === "search" && !digest.web_search_enabled) {
      notes.push(skipped(s, "live web search is off for this digest", settings));
    } else if (s.kind === "prompt" && !digest.ai_enabled) {
      notes.push(skipped(s, "AI writing is off for this digest", settings));
    } else if (s.kind === "readwise" && !input.readwiseReady) {
      notes.push(skipped(s, "Readwise isn't connected", { label: "Account settings", href: "/settings" }));
    }
  }

  // --- degrading: it delivers, but it isn't earning its place ---------------------------------------
  if (input.issues.length === 0) {
    notes.push({
      level: "degrading",
      title: "Never built",
      detail: "Preview it once before tomorrow — a preview costs nothing and sends nothing.",
    });
  }

  notes.push(...silentSections(live, input.issues));
  notes.push(...staleSections(live, input.posts));

  if (input.inboxCount === 0 && live.some((s) => s.kind === "inbox")) {
    notes.push({
      level: "degrading",
      title: "Nothing has ever arrived at this digest's address",
      detail: "An inbox section reads mail sent to it. Until something is forwarded, it has nothing to read.",
    });
  }

  const blocking = notes.filter((n) => n.level === "blocking").length;
  const degrading = notes.length - blocking;
  return { notes, blocking, degrading, next: nextStep(notes) };
}

function skipped(s: Section, because: string, fix: { label: string; href: string }): ReadinessNote {
  return {
    level: "blocking",
    sectionId: s.id,
    title: `“${s.title}” is skipped every run`,
    detail: `A ${s.kind} section needs more than it has — ${because}. It is dropped silently at build time.`,
    fix,
  };
}

/**
 * Sections that were DUE and produced nothing, repeatedly.
 *
 * The cadence check is the whole reason this isn't a naive "did it appear" count: a weekly resurfacer
 * legitimately misses six issues out of seven, and flagging it would train the reader to ignore this panel.
 * `failed` issues are excluded too — a build error says nothing about a section's editorial yield.
 */
function silentSections(live: Section[], issues: IssueSummary[]): ReadinessNote[] {
  const built = issues.filter((i) => i.status === "sent" || i.status === "skipped").slice(0, LOOKBACK_ISSUES);
  if (built.length < MIN_DUE_RUNS) return [];

  const out: ReadinessNote[] = [];
  for (const s of live) {
    if (isCloser(s.kind)) continue; // a closer is absent whenever the issue was thin — not its own fault
    const due = built.filter((i) => runsToday(s, i.issue_date));
    if (due.length < MIN_DUE_RUNS) continue;
    if (due.some((i) => i.sectionIds.includes(s.id))) continue;
    out.push({
      level: "degrading",
      sectionId: s.id,
      title: `“${s.title}” has produced nothing in its last ${due.length} runs`,
      detail:
        "Either the beat is too narrow for this cadence, or the source has stopped publishing. " +
        "Widen it, slow its cadence, or drop it.",
    });
  }
  return out;
}

/**
 * Sections serving old writing.
 *
 * Median, not mean, and keyed on when the piece was WRITTEN rather than when we fetched it. Several feeds
 * republish evergreen archives, so a "daily" quietly ships 2019 — visible in the corpus and nowhere else.
 */
function staleSections(live: Section[], posts: PostSummary[]): ReadinessNote[] {
  const ages = new Map<string, number[]>();
  for (const p of posts) {
    if (!p.section_id || !p.published_at) continue;
    const t = new Date(p.published_at).getTime();
    if (Number.isNaN(t)) continue;
    const bucket = ages.get(p.section_id) ?? [];
    bucket.push((Date.now() - t) / 86_400_000);
    ages.set(p.section_id, bucket);
  }

  const out: ReadinessNote[] = [];
  for (const s of live) {
    const days = ages.get(s.id);
    if (!days || days.length < MIN_POSTS_FOR_AGE) continue;
    const med = median(days);
    if (med <= STALE_DAYS) continue;
    out.push({
      level: "degrading",
      sectionId: s.id,
      title: `“${s.title}” is serving writing that is ${ageLabel(med)} old, on average`,
      detail: `Half of what it has pulled was published over ${ageLabel(med)} ago — an archive, not a day's news.`,
    });
  }
  return out;
}

function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function ageLabel(days: number): string {
  if (days < 365) return `${Math.round(days / 30)} months`;
  return `${(days / 365).toFixed(1).replace(/\.0$/, "")} years`;
}

/**
 * The ONE next step: where to start, when there is more than one thing wrong. Deliberately a single
 * sentence rather than a ranked list — this is the string the agent will later inject as
 * `<suggested_next>`, and a list there reads as a set of orders rather than as a default.
 */
function nextStep(notes: ReadinessNote[]): string | null {
  const first = notes.find((n) => n.level === "blocking") ?? notes[0];
  return first?.title ?? null;
}

// ---------------------------------------------------------------------------------------------------
// The impure half: fetch the rows, hand them to the pure pass
// ---------------------------------------------------------------------------------------------------

/**
 * Read everything `readiness()` needs through the caller's client. Request-scoped (RLS-enforcing) on
 * purpose — this runs for a signed-in reader looking at their own digest, not for the 6am pipeline.
 *
 * `kindle_email` follows the same fallback the delivery step uses (`buildIssue`): the digest's own override
 * first, then the account's OTP-verified address. A different rule here would report ready for a digest
 * that is not.
 */
export async function loadReadiness(
  supabase: SupabaseClient,
  digest: Pick<Digest, "id" | "sections" | "active" | "ai_enabled" | "web_search_enabled" | "delivery">,
): Promise<Readiness> {
  const [issuesRes, postsRes, rwRes, inboxRes, userRes] = await Promise.all([
    supabase
      .from("digest_issues")
      .select("issue_date, status, content")
      .eq("digest_id", digest.id)
      .order("issue_date", { ascending: false })
      .limit(LOOKBACK_ISSUES),
    supabase
      .from("digest_posts")
      .select("section_id, published_at")
      .eq("digest_id", digest.id)
      .order("fetched_at", { ascending: false })
      .limit(300),
    supabase.from("digest_user_settings").select("readwise_enabled, readwise_verified_at").maybeSingle(),
    supabase
      .from("digest_inbox_messages")
      .select("id", { count: "exact", head: true })
      .eq("digest_id", digest.id),
    supabase.from("user_data").select("kindle_email, kindle_configured").maybeSingle(),
  ]);

  const issues: IssueSummary[] = (
    (issuesRes.data ?? []) as Array<{ issue_date: string; status: string; content: IssueContent | null }>
  ).map((i) => ({
    issue_date: i.issue_date,
    status: i.status,
    sectionIds: (i.content?.sections ?? []).map((s) => s.id),
  }));

  const rw = rwRes.data as { readwise_enabled?: boolean; readwise_verified_at?: string | null } | null;
  const user = userRes.data as { kindle_email?: string; kindle_configured?: boolean } | null;

  return readiness({
    digest,
    kindleEmail:
      digest.delivery?.kindle_email ||
      (user?.kindle_configured && user.kindle_email ? user.kindle_email : null) ||
      null,
    readwiseReady: Boolean(rw?.readwise_enabled && rw?.readwise_verified_at),
    issues,
    posts: (postsRes.data ?? []) as PostSummary[],
    inboxCount: inboxRes.count ?? 0,
  });
}
