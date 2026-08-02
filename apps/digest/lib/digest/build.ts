import { createServiceClient } from "@/lib/supabase/server";
import { gather } from "./adapters";
import { writeIntro, writeSection } from "./write";
import { renderIssueHtml } from "./render";
import { sendToKindle } from "./deliver";
import { urlHash } from "./canonical";
import { close } from "./closers";
import { isCloser } from "./types";
import { stripReaderPreamble } from "./entities";
import type { Digest, Item, IssueContent, RenderedSection, RunCtx, Section } from "./types";

// The whole pipeline for one issue: gather → filter → write → verify → assemble → render → deliver.
//
// Runs under the service role because it acts for a reader who is asleep at 6am and has no JWT to present.
// It is driven by an issue id that was already claimed atomically (claim_digest_issue), so this function
// never has to worry about two workers building the same morning.

const SEEN_HORIZON_DAYS = 90;

// ①–⑤ — everything from gather through assemble, with NO persistence and NO delivery.
//
// Split out so `previewIssue` can run the exact same compile the 6am job runs. A preview that exercised a
// different code path would be worth very little: the whole point is to see what would actually be sent.
export interface Compiled {
  content: IssueContent;
  /** Items belonging to sections that survived ④, i.e. the ones a real send would mark as delivered. */
  delivered: Item[];
  /** EVERYTHING gathered this run, used or not — the corpus row set. Each tagged with its section. */
  gathered: Array<Item & { section_id: string }>;
}

async function compile(
  digest: Digest,
  issueDate: string,
  seen: Set<string>,
  issueId: number | null,
  bodies: Map<string, string> = new Map(),
): Promise<Compiled | null> {
  const ctx: RunCtx = {
    digest,
    issueDate,
    seen: (h) => seen.has(h),
    cachedBody: (h) => bodies.get(h),
  };

  const due = (digest.sections ?? [])
    .filter((s: Section) => s.enabled !== false)
    .filter((s: Section) => runsToday(s, issueDate));
  if (!due.length) return null;

  // Sources first, closers after — a closer consumes what the sources produced, so the split is what makes
  // the ordering structural instead of a convention someone has to remember.
  const sections = due.filter((s: Section) => !isCloser(s.kind));
  const closers = due.filter((s: Section) => isCloser(s.kind));

  // ① GATHER + ③ WRITE, mapped per section. Sections are independent, so this is one fetch round plus one
  // LLM round — not the serial sum. That is what keeps a 6-section issue inside a normal request budget.
  const built = await Promise.all(
    sections.map(async (section: Section): Promise<{ rendered: RenderedSection | null; items: Item[]; section_id: string }> => {
      const items = await gather(section, ctx);
      // ② FILTER, part two: drop anything already delivered, then cap. Ranking happens before the cut.
      const fresh = items.filter((i) => !i.url || !seen.has(urlHash(i.url))).slice(0, section.max_items ?? 6);
      try {
        return { rendered: await writeSection(section, fresh, ctx, issueId), items: fresh, section_id: section.id };
      } catch (e) {
        console.error(`write ${section.id} failed:`, e);
        // A failed section is dropped from the issue — but its posts are still kept, which is precisely
        // the kind of thing the corpus is for.
        return { rendered: null, items: fresh, section_id: section.id };
      }
    }),
  );

  const gathered = built.flatMap((b) => b.items.map((i) => ({ ...i, section_id: b.section_id })));

  // ④ VERIFY already happened per section (writeSection returns null for NOTHING_TODAY / empty).
  const rendered = built.map((b) => b.rendered).filter((s): s is RenderedSection => !!s);
  // Note the shape: even when nothing is worth sending, `gathered` is returned so the caller can still
  // record what was pulled. A quiet morning is information about the feeds, not an absence of data.
  if (!rendered.length) return { content: { sections: [] }, delivered: [], gathered };

  // ③b CLOSE — sections that read the issue instead of retrieving for it. They run only when something
  // was actually written, because a quiz about an empty morning is worse than no quiz.
  const closed = (await Promise.all(closers.map((s) => close(s, rendered, ctx, issueId)))).filter(
    (s): s is RenderedSection => !!s,
  );

  // ⑤ ASSEMBLE. The intro summarises the SOURCE sections only: a closer is a coda, and letting it into the
  // opener would have the digest announce its own quiz before the reader has read anything.
  return {
    content: { intro: await writeIntro(rendered, ctx, issueId), sections: [...rendered, ...closed] },
    delivered: built.flatMap((b) => (b.rendered ? b.items : [])),
    gathered,
  };
}

// CADENCE. The digest has one delivery clock; a section may have its own, because half the useful kinds are
// weekly by nature — a resurfacer, a leftovers pass, a beat that publishes twice a month. Forcing those onto
// a daily rhythm is how a reader learns to expect empty sections.
//
// Evaluated against the LOCAL issue date (the digest's timezone already produced that string), so "Sunday"
// means the reader's Sunday. Noon-UTC parsing avoids the date shifting under the parser itself.
function runsToday(section: Section, issueDate: string): boolean {
  const cadence = section.cadence ?? "daily";
  if (cadence === "daily") return true;

  const day = new Date(`${issueDate}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  if (cadence === "weekdays") return day >= 1 && day <= 5;
  return day === (section.weekday ?? 0);
}

// One read serves both jobs: which posts were already DELIVERED (the dedupe set) and which bodies we
// already hold (so extraction isn't paid for twice). Bodies are reusable regardless of delivery; the seen
// set is strictly the delivered ones.
async function loadCorpus(
  db: ReturnType<typeof createServiceClient>,
  digestId: number,
): Promise<{ seen: Set<string>; bodies: Map<string, string> }> {
  const since = new Date(Date.now() - SEEN_HORIZON_DAYS * 86_400_000).toISOString();
  const { data } = await db
    .from("digest_posts")
    .select("url_hash, body, used_at")
    .eq("digest_id", digestId)
    .gte("fetched_at", since);

  const seen = new Set<string>();
  const bodies = new Map<string, string>();
  for (const r of (data ?? []) as Array<{ url_hash: string; body: string | null; used_at: string | null }>) {
    if (r.used_at) seen.add(r.url_hash);
    // Clean on read as well as on write (same rule as PostPage): rows stored before the extractor learned
    // to strip r.jina.ai's metadata block still carry it verbatim, and this cache is exactly what lets a
    // dirty body outlive the fix — every future run reuses it instead of re-fetching a clean copy.
    if (r.body) bodies.set(r.url_hash, stripReaderPreamble(r.body).text);
  }
  return { seen, bodies };
}

// Persist everything pulled this run. Upsert on (digest_id, url_hash) so a post seen again just refreshes
// its metadata; delivery state is NOT touched here — that happens only after a successful send.
async function recordPosts(
  db: ReturnType<typeof createServiceClient>,
  digestId: number,
  gathered: Array<Item & { section_id: string }>,
): Promise<void> {
  const rows = new Map<string, Record<string, unknown>>();
  for (const i of gathered) {
    if (!i.url) continue; // a post with no URL has no identity to key on (e.g. `prompt` sections)
    rows.set(urlHash(i.url), {
      digest_id: digestId,
      url_hash: urlHash(i.url),
      url: i.url,
      title: i.title,
      source: i.source ?? null,
      body: i.text || null,
      image_url: i.image_url ?? null,
      published_at: parseDate(i.published_at),
      section_id: i.section_id,
    });
  }
  if (!rows.size) return;
  const { error } = await db
    .from("digest_posts")
    .upsert([...rows.values()], { onConflict: "digest_id,url_hash" });
  if (error) console.error("recording posts failed (non-fatal):", error.message);
}

// Feed dates arrive in whatever format the publisher felt like. An unparseable one is not worth failing over.
function parseDate(raw?: string): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export async function buildIssue(
  issueId: number,
  opts: { force?: boolean } = {},
): Promise<{ status: string; error?: string }> {
  const db = createServiceClient();

  const { data: issue } = await db
    .from("digest_issues")
    .select("id, digest_id, issue_date, status, attempts, content, html, item_count, delivered_at")
    .eq("id", issueId)
    .maybeSingle();
  if (!issue) return { status: "failed", error: "issue not found" };

  // Idempotency guard: an unforced rebuild of a delivered issue is a no-op, which is what stops a watchdog
  // retry or a double tick from mailing the same morning twice.
  //
  // `force` is the explicit human override — "regenerate today". It must first FORGET what this issue
  // recorded as seen, or the rebuild dedupes its own previous output away and produces an empty issue: the
  // dedupe layer working perfectly in the one situation where you don't want it to.
  if (issue.status === "sent") {
    if (!opts.force) return { status: "already_sent" };

    // Archive the render we're about to overwrite. digest_issues stays one row per day (that's the
    // idempotency key), so regenerating necessarily UPDATEs this row — but the reader already got mailed
    // that morning, so its content must survive as history, not vanish. See digest_issue_versions.
    const { error: archiveErr } = await db.from("digest_issue_versions").insert({
      issue_id: issueId,
      digest_id: issue.digest_id,
      issue_date: issue.issue_date,
      content: issue.content,
      html: issue.html,
      item_count: issue.item_count,
      status: issue.status,
      delivered_at: issue.delivered_at,
    });
    if (archiveErr) return fail(db, issueId, `could not archive previous version: ${archiveErr.message}`);

    // Un-USE them rather than deleting: the posts themselves stay in the corpus (bodies and all), they
    // simply stop counting as delivered so the rebuild can pick them up again.
    const { error: forgetErr } = await db
      .from("digest_posts")
      .update({ used_at: null, used_in_issue_id: null })
      .eq("used_in_issue_id", issueId);
    if (forgetErr) return fail(db, issueId, `could not clear delivered posts: ${forgetErr.message}`);
  }

  const { data: digestRow } = await db
    .from("digests")
    .select("id, owner_id, name, timezone, deliver_at, active, voice, web_search_enabled, ai_enabled, sections, delivery")
    .eq("id", issue.digest_id)
    .maybeSingle();
  if (!digestRow) return fail(db, issueId, "digest not found");

  const digest = digestRow as Digest;
  await db
    .from("digest_issues")
    .update({ status: "building", attempts: (issue.attempts ?? 0) + 1, error: null })
    .eq("id", issueId);

  try {
    // ② FILTER, part one: what has already been delivered, plus bodies we can reuse.
    const { seen, bodies } = await loadCorpus(db, digest.id);

    const compiled = await compile(digest, issue.issue_date as string, seen, issueId, bodies);
    if (!compiled) return skip(db, issueId, "no enabled sections");

    // Record the corpus BEFORE deciding whether to send. What was pulled is worth keeping even on a morning
    // that ships nothing — that is the evidence for whether a feed is earning its place.
    await recordPosts(db, digest.id, compiled.gathered);

    const { content, delivered } = compiled;
    if (!content.sections.length) return skip(db, issueId, "nothing worth sending today");
    const ctx = { issueDate: issue.issue_date as string };

    // ⑥ RENDER
    const html = await renderIssueHtml(digest, ctx.issueDate, content);
    await db
      .from("digest_issues")
      .update({ status: "sending", content, html, item_count: delivered.length })
      .eq("id", issueId);

    // ⑦ DELIVER
    const to = digest.delivery?.kindle_email || (await kindleEmailFor(digest.owner_id));
    if (!to) return fail(db, issueId, "no verified Kindle address on file");

    const sent = await sendToKindle({ to, title: `${digest.name} — ${ctx.issueDate}`, html });
    if (!sent.ok) return fail(db, issueId, sent.error ?? "delivery failed");

    // Mark delivered ONLY after a 2xx. Send-then-mark: a crash here repeats one issue, whereas
    // mark-then-send would permanently burn that news. Repeating beats losing.
    const hashes = dedupeByHash(delivered).map((i) => urlHash(i.url!));
    if (hashes.length) {
      const { error } = await db
        .from("digest_posts")
        .update({ used_at: new Date().toISOString(), used_in_issue_id: issueId })
        .eq("digest_id", digest.id)
        .in("url_hash", hashes);
      if (error) console.error("marking posts delivered failed:", error.message);
    }

    await db
      .from("digest_issues")
      .update({ status: "sent", delivered_at: new Date().toISOString() })
      .eq("id", issueId);
    return { status: "sent" };
  } catch (e) {
    return fail(db, issueId, String((e as Error)?.message ?? e));
  }
}

function dedupeByHash(items: Item[]): Item[] {
  const byHash = new Map<string, Item>();
  for (const i of items) if (i.url) byHash.set(urlHash(i.url), i);
  return [...byHash.values()];
}

async function kindleEmailFor(ownerId: string): Promise<string | null> {
  const { data } = await createServiceClient()
    .from("user_data")
    .select("kindle_email, kindle_configured")
    .eq("user_id", ownerId)
    .maybeSingle();
  const u = data as { kindle_email?: string; kindle_configured?: boolean } | null;
  return u?.kindle_configured && u.kindle_email ? u.kindle_email : null;
}

// A day with nothing worth reading is a SUCCESS, not a failure — the constitution says a short digest is a
// good digest, and `skipped` records that without tripping the watchdog into retrying.
async function skip(db: ReturnType<typeof createServiceClient>, issueId: number, reason: string) {
  await db.from("digest_issues").update({ status: "skipped", error: reason }).eq("id", issueId);
  return { status: "skipped", error: reason };
}

async function fail(db: ReturnType<typeof createServiceClient>, issueId: number, error: string) {
  await db.from("digest_issues").update({ status: "failed", error }).eq("id", issueId);
  return { status: "failed", error };
}

// Compile today's issue and hand back the rendered HTML WITHOUT persisting, sending, or marking anything
// seen. This is the local development loop: change a prompt, hit preview, read the result — no mail, no
// state, no waiting until 6am.
//
// `ignoreSeen` exists because the honest default is misleading during development: a preview run right
// after a real send correctly dedupes to nothing, which looks like a broken pipeline rather than a working
// one. Default respects the seen-set (accurate); pass true to see what a first-ever run would produce.
export async function previewIssue(
  digestId: number,
  opts: { ignoreSeen?: boolean } = {},
): Promise<{ html: string; content: IssueContent; sections: number; items: number } | { error: string }> {
  const db = createServiceClient();

  const { data: digestRow } = await db
    .from("digests")
    .select("id, owner_id, name, timezone, deliver_at, active, voice, web_search_enabled, ai_enabled, sections, delivery")
    .eq("id", digestId)
    .maybeSingle();
  if (!digestRow) return { error: "digest not found" };

  const digest = digestRow as Digest;
  const issueDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: digest.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const { seen, bodies } = await loadCorpus(db, digest.id);

  // issueId is null: the ai_calls rows a preview writes are real (it really did spend those tokens) but they
  // belong to no issue, which is exactly right — nothing was issued.
  const compiled = await compile(digest, issueDate, opts.ignoreSeen ? new Set() : seen, null, bodies);
  if (!compiled) return { error: "no enabled sections" };

  // A preview genuinely fetched these, so they belong in the corpus — and caching their bodies is what
  // stops repeated previews from re-paying for extraction. It still marks nothing as delivered.
  await recordPosts(db, digest.id, compiled.gathered);
  if (!compiled.content.sections.length) return { error: "nothing worth sending today" };

  return {
    html: await renderIssueHtml(digest, `${issueDate} (preview)`, compiled.content),
    content: compiled.content,
    sections: compiled.content.sections.length,
    items: compiled.delivered.length,
  };
}
