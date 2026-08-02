# WORKLOG — append-only catalogue of work

> The **firehose**. Every completed unit of work lands here as one dated entry, newest first.
> Where `STATE.md`/`ROADMAP.md` are the *curated projection* (one row per project, ranked),
> this is the *raw event log* (one entry per task). Think event-sourcing: cheap appends here,
> a hand-curated read-model there.
>
> **Never loaded whole into an agent session — grep, never load.** It can grow forever at zero
> context cost. Don't summarize it, don't `Read` it end-to-end, don't rank it. Just append. A
> *targeted* lookup is fine and encouraged — `grep -A3 '<topic>' pm/WORKLOG.md` to answer "when
> did we touch X and what happened?" costs a few hundred tokens; a full load costs the whole file.
> The rule is point-lookups yes, full scans never.
>
> Written by the **`/wrap`** ritual at the end of a task. Impact tags:
> `ship` (landed → promote to STATE) · `decision` (→ DECISIONS) · `park` (→ STATE/ROADMAP) ·
> `wip` (in progress, no promotion) · `chore` (housekeeping, no promotion).



<!-- NEWEST ENTRIES GO DIRECTLY BELOW THIS LINE (prepend, do not append at the bottom) -->

## 2026-08-02 — Citations vs links, and the paragraph gap the preview never had `[ship]`
- **What:** Two more reader-side reports (`doc_1785656805078.md` §10), both `issueStyles` doing less than the
  code around it assumed.
  **(a) Inline links shrunk to 0.75em mid-sentence.** `.src` wrapped EVERY prose link, so a verbatim
  article's own sentence link ("…we write about in *our daily email newsletter*") rendered two-thirds size.
  The obvious fix — stop shrinking `.src` — is wrong: it would flatten the AI path's real citations (the
  reader asked for "source in small words") and blow up the article byline, which genuinely is metadata. The
  two cases want opposite things, so the renderer gets told which: `RenderOpts.citations`, resolved per
  section by **`isVerbatimSection(markdown)` — inferred, not stored.** `renderRawList` always opens with
  `## [Title](url)` and the constitution forbids the model from emitting headings at all, so a leading `## [`
  is unambiguous; inferring costs no schema change and is correct for issues ALREADY in the database, which
  a column could never be. Body links now full-size ink + hairline underline; `.src` keeps 0.75em and means
  one thing again. The byline then needed a home: identified structurally as `h3 + p`, which is only safe
  because `demoteHeadings` guarantees sub-heads start at `h4` AND `renderRawList` now **always** emits a
  byline (domain fallback) — without that, an article whose feed declares no source would have handed byline
  styling to its first real paragraph.
  **(b) Paragraphs ran together.** `issueStyles` never set `p` margins. Three consumers, two compensating by
  accident — the reader page via a Tailwind `space-y-3` utility, the mailed HTML via browser defaults (no
  reset in a standalone doc). The preview page had neither and Tailwind's preflight zeroes `p`, so every
  paragraph ran into the next. Spacing moved into `issueStyles`; `space-y-3` dropped from the reader so
  there's one owner. Same failure as the `globals.css` one earlier today, one layer down: **a shared
  stylesheet missing a rule looks fine wherever something else happens to supply it.**
  **Verified:** body `p` margin-top 14.4px (was 0 in preview), inline link 16px/#1a1917/underline (was
  12px/#666), byline 12.8px/#666; 4 assertions on the citation split + `isVerbatimSection` both directions.
  `tsc` + `next build` green.
- **Files/commits:** `lib/digest/render.ts`, `lib/digest/write.ts`, `components/IssueContentView.tsx`,
  `app/digests/[id]/preview/page.tsx`, `doc_1785656805078.md` §10. Uncommitted.
- **PM impact:** folded into today's "Issue reader render" STATE row. Note: a concurrent session is editing
  the same app (`llm.ts`, `commands.ts`, `readiness.ts`, `app/digests/[id]/page.tsx`) — one build failed
  transiently on a `scripts/tmp-cleanup.ts` that appeared and vanished mid-run; re-ran green.

## 2026-08-02 — Digest agent loop, on DeepSeek `[ship]`
- **What:** Rung 4's core (loop, not UI). Owner directive: *Anthropic only for `web_search`, everything else
  DeepSeek.* Audit first — the code already complied (`MODEL_GATHER` appears at exactly one call site; the
  other four omit `model:` and default to DeepSeek), so nothing to migrate. What was missing was
  enforcement, so the policy is now checked from the **capability** side: reaching Anthropic requires
  asking for a *server* tool, and `callModel` throws on a `claude-*` model without one. Function tools carry
  no such licence — they're a protocol both providers speak.
  New in `llm.ts`: `callModelStep` — one step of a tool loop on DeepSeek (OpenAI-shape `tools`,
  `tool_calls` parsing, `role:"tool"` turns, multi-turn message arrays), logged to `ai_calls` like every
  other call so an agent turn is as attributable as anything else. Malformed tool arguments are *recorded*
  (`parseError`) rather than thrown — the model can fix them if told.
  New `lib/digest/agent/loop.ts`: `runAgentTurn`. Static constitution then `<digest_state>` re-read every
  turn (cacheable prefix + state that can't be stale); tool calls run in sequence because they contend on
  one version counter; `execute` never throws, and the conflict case tells the model to **re-read and
  decide**, explicitly not to retry. No self-chaining/durable-row/watchdog — that's a Supabase-worker
  workaround and Vercel gives 300s.
- **Verified:** `scripts/smoke-agent.ts` (new), two real turns on live digest #1. Read turn: called
  `read_digest` + `check_readiness`, found the genuine silent failure (`prompt` section with AI off),
  explained it, offered two paths and **asked before proposing paid spend** — the constitution rule
  holding. Write turn: `add_feed_section` with every field right including weekday 3 = Wednesday, 7s.
  Scratch section removed after; sections back to 6. typecheck + build green.
- **Two bugs caught while writing, not by tests:** (1) the conflict remedy was unreachable — `read_digest`
  didn't refresh the version holder, so "re-read then write" would have conflicted forever. It refreshes
  now, and *only* on the tool the model calls: the internal read inside `update_section` must not, or the
  guard would re-arm microseconds before every write and protect nothing. (2) a shadowed `step` variable.
- **Open decision for the owner (in README):** the agent sits behind the same `aiEnabled(digest)` gate as
  the 6am pipeline, so an AI-off digest can't use it. Possibly backwards — an AI-off digest still delivers
  a good plain linked list, and the agent is what would help someone set one up. The pipeline gate is about
  *unattended* spend; the agent is user-initiated, closer to Preview. Not decided; flagged.
- **Files/commits:** `apps/digest/lib/digest/{llm.ts,agent/loop.ts}`, `scripts/smoke-agent.ts` (new),
  `lib/digest/agent/tools.ts`, `apps/digest/README.md`. Uncommitted, with rung 3 + the version column.
- **PM impact:** none yet. Remaining for rung 4: the rail UI and conversation persistence. Rung 5 (context
  policy) is unstarted — history currently accumulates unbounded in `AgentTurn.messages`.

## 2026-08-02 — `cleanBody` was deleting paragraphs and demolishing every heading, quote and italic `[ship]`
- **What:** Owner read the rendered issue against the source article and spotted two things: formatting gone
  (a sub-head, its pull-quote and the paragraph under it all landing as identical undifferentiated
  paragraphs) and text simply **missing**. Both in `entities.ts`, two independent faults that had been hiding
  each other. Full write-up in `doc_1785656805078.md` §9.
  **(a) `isLinkHeavy` deleted real prose.** It called anything under 300 characters-per-link a nav row, so a
  200-char paragraph with ONE inline citation scored 200 and was dropped — including *"As mentioned before,
  hardship allows you to show your true character… Amor Fati…"*, gone purely because "Amor Fati" was linked.
  It also ate the article's own `## [](url)How do we persevere?` headings, since that extractor writes an
  **empty-label permalink anchor** that renders nothing but counted as a link. Rewrote on the right axis:
  strip empty-label anchors, then measure the visible text that is NOT link label (share + absolute floor).
  A nav row is links plus separators; a paragraph is the author's sentences with a link inside one of them.
  **Measured over all 43 stored bodies: 109 blocks restored**, overwhelmingly real prose — **+8,591 chars of
  article text on issue 15 alone** that had been deleted before anyone could read it.
  **(b) `cleanBody` returned flat text.** `stripMarkdownSyntax` output WAS the return value, so `#`, `>`,
  `*`, `_` all died. Fine for a one-paragraph teaser, wrong once `renderRawList` emitted whole articles. Fix
  is one line with a principle behind it: **judge on the stripped text, return the original block** — the
  chrome/length decisions are easier flat, the reader wants the structure, and `markdownToHtml` could already
  render all of it.
  **(c) Restoring structure exposed three latent bugs**, each fixed: heading collision with the article title
  (`demoteHeadings` re-bases the *shallowest* body heading to `###` — a fixed +1 fails because one site opens
  at `#` and another at `##`); `markdownToHtml` matched only `#{1,3}` so `##### Performance Cookies` printed
  its hashes (now `#{1,6}` clamped at h6); and underscore litter, because real markdown nests emphasis
  (`**_[title](url)_**`) and by the time the `_` rule ran the preceding character was a `<strong>`'s `>` — so
  `>`/`<` now count as boundaries, `__strong__` is supported, and the closing side takes any non-word char (a
  curly apostrophe in `_Exposure Therapy_’s` was the last survivor). Opening side stays a narrow whitelist,
  which is what keeps `used_at` intact. Blocklist also gained the furniture that only became visible once
  headings existed (`Tags`, `Like this:`, `Newswire`, `Discover more from …`, `Your Privacy Choices`).
  **Verified:** issue 15 rebuilt from raw bodies — `<h3>` = 13 = exactly the 13 articles (no collisions),
  `<h4>` sub-heads, 12 blockquotes, 42 italics, 17 bolds, 9 rules, **0 stray underscores**. 10 renderer
  assertions pass incl. `used_at` protection and the curly apostrophe. `tsc` + `next build` green.
  **Worth keeping:** both faults were invisible *by construction* — a filter that flattens markers leaves no
  trace of unmatched emphasis, and one that returns only what it kept leaves no gap where a deleted paragraph
  was. Same argument as the §5 trim pass: **make deletion legible.** Had `cleanBody` recorded its drops this
  would have been a one-look diagnosis instead of a reader noticing a missing sentence.
- **Files/commits:** `lib/digest/entities.ts`, `lib/digest/render.ts`, `lib/digest/write.ts`,
  `doc_1785656805078.md` §9. Uncommitted.
- **PM impact:** folded into the STATE row added earlier today ("Issue reader render"). No new project.

## 2026-08-02 — Optimistic concurrency on digest sections `[ship]`
- **What:** Closes the lost-update gap logged two entries ago, before rung 4 makes a second writer real.
  New `digests.sections_version` (migration `20260803140000`, **pushed**); every section write is now a
  compare-and-swap — `.eq("sections_version", v)` + bump, with `.select("id")` so "zero rows" is
  observable (a plain update reports no error when it matches nothing, which is the silence this ends).
  Mismatch raises `ConflictError`.
  The design point: **there are two windows and only the caller knows about the long one.** The short one
  is inside `applyCommand` and is guarded for free by the version just read — all a form needs, which is
  why forms pass nothing. The long one is an agent's twenty seconds of thinking between read and write, so
  `ToolCtx.sections` holds the version the turn started with and every write is checked against *that*.
  Deliberately **not** a tool parameter: a model echoing a version back correctly on every call is not a
  property worth depending on. The holder absorbs each result, or the agent's second write conflicts with
  its own first. On conflict an agent must re-read and reconsider, never retry — a retry re-applies an
  intent computed against a configuration that no longer exists (the staleness fence from the context
  design, at the data layer instead of the prompt).
  Not covered on purpose: scalar settings (`update_digest` writes only the keys given, so concurrent
  patches of different columns can't clobber) and per-element `jsonb_set` (the optimization to reach for
  only if conflicts prove common).
- **Verified:** `scripts/smoke-tools.ts` grew a concurrency section — a competing write lands and moves the
  version, the stale write is **refused** with `ConflictError` and writes nothing, the same write succeeds
  after a re-read, and a second write in one turn does not conflict with the first. ALL OK on live digest
  #1 alongside the existing 30+ assertions. typecheck + build green.
  Also caught in review, not by a test: the first cut keyed the guard on `"expectedVersion" in cmd`, which
  is an optional field and therefore absent at runtime — the guard would have silently never fired. Keyed
  on `cmd.type` now.
- **Rough edge logged, not solved:** two racing *form* submits now surface an error page instead of
  silently taking the last write. Better, but the forms have no conflict UI; the window is milliseconds.
- **Files/commits:** `supabase/migrations/20260803140000_digests_sections_version.sql` (new, pushed),
  `apps/digest/lib/digest/commands.ts`, `lib/digest/agent/tools.ts`, `scripts/smoke-tools.ts`,
  `apps/digest/README.md`. Uncommitted, with rung 3.
- **PM impact:** none. Next: rung 4 (the loop) — owner directed it onto **DeepSeek, not Anthropic**, which
  means `lib/digest/llm.ts` needs a real OpenAI-shape tool loop; its current guard throws on any `tools`.
  That guard should narrow to *server* tools (`web_search` is Anthropic-infrastructure and vanishes
  silently elsewhere) rather than being dropped.

## 2026-08-02 — Digest agent tool belt, generated from the section schema `[ship]`
- **What:** Rung 3 of `doc_1785651033920.md`. `lib/digest/agent/tools.ts` — 21 tools: 6 reads
  (`read_digest`, `check_readiness`, `read_issues`, `read_issue_section`, `read_posts`, `read_inbox`), 11
  **generated** `add_<kind>_section` tools, and `update_section` / `remove_section` / `update_digest` /
  `forget_message`. Every write goes through `applyCommand` (rung 2); nothing does its own RMW. Tool
  schemas are derived from `sectionSchema.ts` — `hint` becomes the field `description`, so there is no
  second copy of "what this field means" to drift. Three scoping calls: the **digest id is ambient** (no
  tool exposes it, so no model output can reach another digest), **`create_digest` is absent** (the agent
  works inside one digest; admitting it would mean an unscoped tool for symmetry), and **`update_section`
  merges before writing** (the command replaces the whole section — right for a form, a trap for an agent
  changing one field; `kind` comes from the stored section so a rename can't turn a feed into a search).
  Reads return compact text and never a body or whole issue unless asked for by id — tool results, not
  user text, are what dominates a tool-loop transcript.
- **Verified:** new `scripts/smoke-tools.ts <digestId>` — no model, no chat UI. 30+ assertions, ALL OK on
  live digest #1: every kind has a tool, required-in-schema == required-in-parser for all 11, field types
  survived (`targets` array, `min_score` integer, `source` enum), native values reached the store, a
  `ranked/arxiv` with no targets refused with the form's own sentence, a patch left omitted fields alone,
  cleanup restored the section count. typecheck + build green.
- **Bug the smoke test caught (fixed):** `loadReadiness` reported "No verified Kindle address" on a digest
  that had delivered two days running. `.maybeSingle()` on an unfiltered `user_data` ERRORS when it sees
  >1 row and the error was swallowed into a null — invisible under RLS (one row), wrong under a
  service-role client, i.e. exactly what a server-side agent would hold. Both account-level reads in
  `loadReadiness` now filter by `owner_id`; `page.tsx` and `tools.ts` select it.
- **Files/commits:** `apps/digest/lib/digest/agent/tools.ts` (new), `scripts/smoke-tools.ts` (new),
  `lib/digest/readiness.ts`, `app/digests/[id]/page.tsx`, `apps/digest/README.md`. Uncommitted.
  Prior rung: `84885fb`.
- **PM impact:** none yet. Rung 4 (the loop + rail UI) is the first one that needs the owner's ratification
  — it turns on model spend and makes the read-modify-write concurrency gap (logged in the previous entry)
  real.

## 2026-08-02 — Issue reader: hairlines, real headlines, and a boilerplate blocklist `[ship]`
- **What:** Items 1–3 of the issue-15 design review (`doc_1785656805078.md` §7, now §8 records the result).
  (1) `markdownToHtml` gained a thematic-break rule — `renderRawList`'s `\n\n---\n\n` had been falling
  through to the paragraph branch and printing a literal "---" between every pair of articles (7 in one
  issue). (2) `inline(s, {citations})` splits the two meanings of a markdown link: a CITATION inside prose
  stays `<small class="src">`, a link that IS a heading gets a plain anchor. That inversion was the worst
  thing on the page — the article headline rendered 0.75em grey while its unlinked publication name sat
  beside it at full body size. `renderRawList` now emits `## [Title](url)` plus a small linked byline, which
  also buys a per-article Kindle TOC entry (Amazon builds the TOC from headings) and an anchor for the real
  TOC later. (3) `cleanBody` gained a two-tier boilerplate blocklist, kept as DATA: tier 1 = phrases that are
  only ever furniture, matched anywhere (`Manage Consent Preferences`, `Switch Label label`, `Confirm My
  Choices`); tier 2 = words that are furniture only as a standalone short label ("Advertisement", "Share
  this:", "Subscribe"), since they're ordinary English mid-sentence. Cookie panels carry no links, so
  `isLinkHeavy` had been sailing straight past ~3,000 unbroken characters of Cookiebot copy.
  **Fixing the link colour surfaced a structural duplication:** the reader page never used `issueStyles()` —
  the mailed HTML inlined it and the preview injected it scoped, but the page you actually read on
  hand-copied a subset into `globals.css`, so a non-`.src` link fell through to browser-default blue.
  `IssueContentView` now injects `issueStyles(".prose-digest")` and globals dropped its copy — back to the
  one definition that function's own comment already asked for.
  **Verified** by rebuilding issue 15 from the raw `digest_posts.body` rows (not the stored render), so every
  changed stage ran: literal `<p>---</p>` 7→0, `<hr/>` 9, article `<h3>` 13; headline computed style
  12px #666 → 18px #1a1917 no-underline, byline 12px #666; all six observed junk patterns gone; blocklist
  isolated old-vs-new over all 43 stored bodies = 47 blocks / 3.6% removed with **zero false positives**
  (every removed block printed and read). 8 renderer branch assertions pass (inline citation, heading anchor,
  `---`, `***`, bullets, escaped asterisk, blockquote). `tsc --noEmit` + `next build` green.
  **Deliberately not fixed:** mid-word truncation (`"…the purposes of cor"`), the TOC, section chrome, and
  the Substack-migration notice that is structurally an article but editorially admin noise — that last one
  is exactly the residue a blocklist can't reach and the trim pass is for.
- **Files/commits:** `lib/digest/render.ts`, `lib/digest/write.ts`, `lib/digest/entities.ts`,
  `components/IssueContentView.tsx`, `app/globals.css`, `doc_1785656805078.md` §8. Uncommitted.
- **PM impact:** new row in STATE → Morning Digest ("Issue reader render (design pass 1 of 3)"), snapshot
  date bumped to 2026-08-02. Still open for the author: whether the delete-only trim pass is exempt from
  `ai_enabled` (recommended — it gates voice, not hygiene) or gets its own switch. → DECISIONS once ruled.

## 2026-08-02 — Readiness stops flagging old-but-good posts; digest labels them instead `[ship]`
- **What:** Owner feedback on the readiness panel (screenshot of digest #1): old articles aren't a
  readiness problem, they're fine content — just say so. Removed `staleSections()` from
  `readiness.ts` (the median-age-over-6-months degrading note, plus its now-unused `posts` query and
  `PostSummary`/`median`/`ageLabel` plumbing in `loadReadiness`) so age alone no longer blocks/degrades a
  section. Moved the signal from a *gate* to a *label*: `renderRawList()` (`write.ts`, the non-AI fallback
  path) now appends "· *From the archives*" to any item whose `published_at` is >180 days old — same
  cutoff the old check used. Deliberately not extended to the AI-written prose path or `readwise` quotes
  (would need feeding age into the model prompt — out of scope for this fix). Verified live: digest #1's
  readiness panel dropped its two stale-feed notes, and the rendered preview shows the tag on a Daily Stoic
  archive repost.
- **Files/commits:** `apps/digest/lib/digest/readiness.ts`, `apps/digest/lib/digest/write.ts`. Uncommitted.
- **PM impact:** `pm/STATE.md` readiness-panel row updated to drop the stale-feed example and note the
  archive-tag behavior instead.

## 2026-08-02 — Digest writes collapse to one command layer `[ship]`
- **What:** Rung 2 of `doc_1785651033920.md`. New `lib/digest/commands.ts` owns every write to a digest
  (`create_digest`, `update_digest`, `add`/`update`/`remove_section`, `forget_message`);
  `app/digests/actions.ts` is now a thin FormData→Command adapter (247 lines → ~120, all translation, no
  decisions). Ports-and-adapters, so an agent tool becomes a second adapter rather than a second write path
  — the multi-mirror drift `sectionSchema.ts` was introduced to kill, applied to *what happens when you
  save* instead of *what fields a kind has*.
  Three things stay framework-side by design: `revalidatePath` (commands return the paths; calling Next's
  cache API outside a request throws, which would make commands untestable from a script), `redirect`, and
  FormData itself. Commands take **native** values — `normalizeFieldValue` in sectionSchema flattens
  `urls: [...]` / `days: 3` before `parseSectionFields`, so the schema stays the single interpreter.
  `update_digest` is now a **patch** (only present keys are written) — no change for forms, which always
  send everything, but "rename this" from any other caller must not blank the voice it never mentioned.
  Preview/run/regenerate deliberately excluded: they're the pipeline, not config, and they cost money.
- **Verified:** `applyCommand` driven directly against digest #1 with no request context — native array +
  numeric fields stored correctly, update carried `max_items` over and dropped the omitted cadence, a
  `feed` with no urls refused with the same message the form gives, a `{name}`-only patch left voice and
  active untouched, cleanup restored the section count. typecheck + build green. **Not** clicked through
  the browser (MCP profile busy, page needs a session) — the form path is verified by compile + reasoning
  over field names, not by a click.
- **Found, not fixed:** sections are one jsonb array, so every section command is a read-modify-write with
  no optimistic concurrency — two writers clobber each other silently. Harmless with one human writer;
  needs a version column or jsonb-path update before rung 4 makes a second writer real. Recorded in
  `apps/digest/README.md`.
- **Files/commits:** `apps/digest/lib/digest/commands.ts` (new), `app/digests/actions.ts`,
  `lib/digest/sectionSchema.ts`, `apps/digest/README.md`. Uncommitted.
- **PM impact:** none — internal refactor, no user-visible change. Rung 3 (tools generated from
  `sectionSchema`) is the next one and is where the agent design starts needing ratification.

## 2026-08-02 — Issue 15 read as a reader: the non-AI path ships the corpus, not a digest `[wip]`
- **What:** Design review of `/issues/15` from the reader's side. Couldn't load the live page (automation
  Chrome is signed in as another account → RLS 404), so pulled the stored `digest_issues.content` and
  re-rendered it through the app's own `markdownToHtml` + `IssueContentView` markup/type scale.
  **Root cause:** digest #1 has `ai_enabled:false`, so `writeSection` falls to `renderRawList`, which emits
  entire extracted bodies verbatim — 55,127 chars, **22,619px (~24 screens)**, 4 `<h2>`s, no TOC, no
  landmarks. Three renderer bugs the raw path exposes: (1) `render.ts:35` wraps *every* link in
  `<small class="src">`, so the article **headline renders 0.75em grey** while the publication name renders
  full-size — hierarchy inverted; (2) no `<hr>` rule in `markdownToHtml`, so `renderRawList`'s `\n\n---\n\n`
  separator renders as literal `<p>---</p>` (7×); (3) `fetch.ts:83` `slice(0,12_000)` cuts mid-word with no
  marker. Plus ~8% measurable boilerplate (cookie-consent tail, `Share this:`, a whole "article" that is a
  Substack migration notice) and a `readwise` section literally titled "Untitled section".
  **Proposed trim design:** delete-only pass where the model returns **block indices, not text** — output
  alphabet is integers, so the result is a provable subsequence of the input and fabrication is structurally
  impossible; ~30–60 output tokens/article regardless of length. Deterministic blocklist first, model for the
  residue; cache as `body_clean` + `trim_version` so a better trimmer re-cleans on read (same trap
  `loadCorpus` already dodges for the jina preamble). Nothing implemented — review + plan only.
- **Files/commits:** `doc_1785656805078.md` (new, full review + cheapest-first fix order). No code touched.
  Note: the other uncommitted `apps/digest/**` edits in the tree (`actions.ts`, `commands.ts`,
  `sectionSchema.ts`, `write.ts`, `readiness.ts`) are **not** from this session.
- **PM impact:** none yet. One open product decision for the author: a trim pass is an LLM call but this
  digest has `ai_enabled:false` — recommend exempting hygiene from that toggle (it gates *voice*, not
  cleaning; the subsequence guarantee is what earns the exemption) rather than adding a `clean_enabled`
  switch. Promote to DECISIONS once ratified.

## 2026-08-02 — Digest readiness: the silent skip is now visible before 6am `[ship]`
- **What:** Rung 1 of the digest-agent plan (`doc_1785651033920.md`), built as a standalone feature — no
  agent involved. `lib/digest/readiness.ts` derives "will this deliver something worth reading tomorrow?"
  from rows that already exist. **Blocking:** no sources / all disabled / only a closer (a quiz alone can
  never fire) / paused / no verified Kindle address / the four silent skips (`search` and `prompt` with AI
  off, `search` with web search off, `readwise` with no token). **Degrading:** never built; a section that
  was *due* and produced nothing in its last N runs; a section whose posts have a median age over six
  months; an `inbox` section nothing was ever sent to. Pure `readiness(input)` + `loadReadiness(supabase,
  digest)` so a page and (later) an agent read the same sentences. `runsToday` moved `build.ts` → `types.ts`
  because readiness must ask the same cadence question — a weekly section legitimately misses six issues in
  seven, and flagging it would train the reader to ignore the panel.
  New `ReadinessPanel` at the top of the Sections tab; it **replaced** the per-section ⚠ lines (the same
  three checks written a second time in JSX). A clean digest gets one quiet line, not a green panel.
  Verified against the live digest #1: correctly flagged the `prompt` section as skipped (ai_enabled=false)
  and two feeds serving 7- and 10-month-old writing; no false positives on the connected Readwise section or
  the Kindle address. All three panel states rendered via `renderToStaticMarkup`. typecheck + build green.
- **Files/commits:** `apps/digest/lib/digest/readiness.ts` (new), `app/digests/[id]/Readiness.tsx` (new),
  `app/digests/[id]/page.tsx`, `lib/digest/{types,build}.ts`, `apps/digest/README.md`. Uncommitted.
- **PM impact:** none — a diagnostic surface inside the existing digest app, not a Now-slot item. The agent
  design it comes from is still unratified (see the `[wip]` entry below).

## 2026-08-02 — Digest session committed (`d5c8691`) `[chore]`
- **What:** Committed the raw-list content fix, the streamed live preview page, and the (concurrently
  authored) readiness panel — see the three preceding entries for what each does. No new work here, just
  landing what was already catalogued.
- **Files/commits:** `d5c8691` "digest: better raw-list content, streamed live preview, readiness checks".
- **PM impact:** promoting the preview-page ship to STATE below.

## 2026-08-02 — Live streaming preview page, one Suspense boundary per section `[ship]`
- **What:** The `/api/digests/[id]/preview` route (still there, for curl/`?ignoreSeen=1` dev workflows) can
  only ever return one atomic blob — no Suspense possible on a route handler, per the earlier design
  discussion. Built the real thing: `/digests/[id]/preview` page. Split `compile()`'s per-section
  gather+write into a standalone `buildSection()` (no behavior change to the real pipeline — `compile()`
  just calls it in its existing `Promise.all` now) and added `previewStream()` + `previewClosersAndIntro()`
  in `build.ts`: the former kicks off every source section's build immediately and returns one promise per
  section without awaiting any of them; the latter awaits all of them then runs intro+closers (which
  structurally can't start earlier — they read what the sections produced). The page wraps each section
  promise in its own `<Suspense>`, so a fast section renders while a slow one (a `search` section, when AI
  is on) is still in flight; intro/closers share ONE kicked-off `previewClosersAndIntro` promise across two
  boundaries so the work runs once, not twice, even though both await it.
  Visual fidelity: extracted the mailed issue's `<style>` block into `issueStyles(scope)` in `render.ts` —
  bare selectors for the standalone email doc, scoped under `.issue-render` for this page — one CSS
  definition instead of two that drift. Content renders through the same `markdownToHtml` either way, so
  this is not a separate preview design, it's the actual render.
  Added as a 6th tab ("Preview") in the digest layout, same nesting as Sections/Inbox/Posts/Settings.
  Verified via a standalone script exercising `previewStream`/`previewClosersAndIntro` directly (no browser
  available — chrome-devtools-mcp had a stale profile lock from earlier this session): 6 source sections
  resolved correctly (one legitimately dropped, `NOTHING_TODAY`-style), full section content (1.7k–38.6k
  chars each, matching the last live send), no errors.
- **Files/commits:** `apps/digest/lib/digest/{build,render}.ts`, new
  `apps/digest/app/digests/[id]/preview/page.tsx`, `apps/digest/app/digests/[id]/layout.tsx`. Uncommitted.
- **PM impact:** none — a dev/QA surface improvement, not a reader-facing capability.

## 2026-08-02 — Raw list renders full bodies, not a one-paragraph teaser `[ship]`
- **What:** Owner noticed the Marginalian item didn't read like "a newsletter" — `firstParagraph` (previous
  two entries) always returned exactly one paragraph, so a 2,000-word essay and a one-line Daily Stoic quote
  rendered identically. Asked to render everything in full. Replaced `firstParagraph` with `cleanBody` in
  `lib/digest/entities.ts`: same chrome-skipping bar (forward header / link-heavy / too-short) to find where
  the real content STARTS, but once past that point every remaining block is kept (only link-heavy blocks —
  e.g. a footer/unsubscribe block — get dropped throughout, not just at the top; a short mid-article line is
  fine once we're past the opening bar, unlike before). `renderRawList` now joins items on `\n\n---\n\n`
  (matching the separator `writeSection`'s own AI-path material-building already uses) since items are full
  articles now, not one-line teasers — a bare blank line wasn't enough to tell where one item ends and the
  next begins.
  Verified before sending: today's 5 sections are 1.7k–38.6k chars each (was ~280 chars/item), Marginalian
  item present and substantial. Live-verified: force-resent issue 6, `status: sent`, 16 items.
- **Files/commits:** `apps/digest/lib/digest/{entities,write}.ts`. Uncommitted.
- **PM impact:** none — same non-AI fallback path as the last three entries, further tuned per live
  feedback on the actual send.

## 2026-08-02 — Digest agent: design only, no code `[wip]`
- **What:** Answered the owner's two questions about a digest-building agent that mirrors the UI.
  Three proposals: (1) mirror is *mechanical* — tool JSON Schemas compile from `sectionSchema.ts`, and
  `actions.ts` splits into FormData-adapter + one `applyCommand()` port so forms and tools share a write
  path; (2) objectives are *derived* — a pure `digestReadiness()` (modelled on the DNA side's
  `currentObjective()`) injected as an anchor under a three-state policy, so one agent serves both a
  concrete ask and "walk me through it", with `preview` as a free generate↔verify loop; (3) context —
  state is re-hydrated from the DB every turn and stripped from history, only *intent* survives folding,
  tool results elide to receipts after one turn, plus a version-stamped staleness fence. Also a negative
  finding: do **not** port `book_agent_runs`/self-chaining/pg_cron — that's a workaround for Supabase's
  ~150s worker ceiling, and Vercel Fluid Compute gives 300s + streaming in one request.
  Proposed a 6-rung build order where rungs 1–3 are useful with no agent at all. Nothing built; owner
  hasn't picked a rung.
- **Files/commits:** `doc_1785651033920.md` (new, untracked). No code touched.
- **PM impact:** none yet — not ratified. If the owner picks a rung it becomes a DECISIONS entry
  (direct-write-for-config diverges from the DNA proposal-channel rule) plus a ROADMAP item.

## 2026-08-02 — Raw-list excerpts uncapped `[ship]`
- **What:** Owner noticed a quote cut mid-sentence in the resent digest — the 280-char cap on
  `firstParagraph`'s excerpt (previous entry) was a teaser length, not a data bug. Asked to remove it.
  `firstParagraph(raw, maxLen = Infinity)` — the cap is now opt-in per caller rather than baked in;
  `renderRawList` calls it with no second arg. Still only the FIRST real paragraph (nav/forward-header/
  link-heavy skipping unchanged), just not truncated within it. Live-verified: force-resent issue 6,
  `status: sent`, 16 items, excerpts now run to a complete thought instead of an ellipsis mid-clause.
- **Files/commits:** `apps/digest/lib/digest/{entities,write}.ts`. Uncommitted.
- **PM impact:** none — a formatting tweak on the same non-AI fallback path.

## 2026-08-02 — Raw-list excerpts were surfacing nav chrome and forward headers `[ship]`
- **What:** Owner caught it from the resent digest: "Stoicism" section excerpts showed site nav
  (`Home About * donating=loving`) and broken markdown (`!Image 1`, bare `>`/`_`), and the inbox item
  ("brain pickings") showed the Gmail forward header instead of the newsletter's actual opening. Root
  cause: `renderRawList`'s excerpt was `text.slice(0, 280)` from character 0 — fine when the extracted text
  starts with the article, wrong whenever it starts with nav/logo-image chrome (themarginalian.org,
  modernstoicism.com) or a mail client's own forward header. The AI writer never showed this because a model
  reads past chrome on its own; a plain excerpt can't.
  Added `firstParagraph()` in `lib/digest/entities.ts`: walks blank-line-separated blocks, skips a Gmail
  forward-header block outright, skips anything link-heavy (links using >~1 per 300 chars — catches
  nav/footer lists even when they're grammatical sentences, e.g. a "view in browser / unsubscribe" blurb),
  skips anything under 100 chars once markdown-stripped (headings/blockquote markers/images/links resolved
  to plain text), and returns the first block that clears all three bars — falling back to a plain-stripped
  slice of everything if nothing does. Wired into `renderRawList` in place of the raw slice.
  Verified against the actual flagged rows (Modern Stoicism, Marginalian, Daily Stoic, James Clear, the
  inbox forward) before resending — all now surface real opening prose. One known residual: Marginalian's
  recurring donation-appeal paragraph occasionally still wins over the article's true opening (coherent
  English, just not the piece) — flagged to the owner, not special-cased, since it's one publisher's
  boilerplate rather than a general pattern. Live-verified: force-resent issue 6 again, `status: sent`,
  16 items, real content in every section including the inbox one.
- **Files/commits:** `apps/digest/lib/digest/{entities,write}.ts`. Uncommitted.
- **PM impact:** none — correctness fix to the non-AI fallback shipped 2026-08-01, not a new capability.

## 2026-08-01 — Cached post bodies were feeding the r.jina.ai preamble to everything `[ship]`
- **What:** Owner caught it from the new raw-list preview (previous entry): sections showed "Title: X URL
  Source: Y Published Time: Z Markdown Content:" instead of actual article text. Root cause: `articleText()`
  already strips that preamble on a fresh fetch, but `loadCorpus()` (`lib/digest/build.ts`) read cached
  bodies straight from `digest_posts.body` with no stripping — and those rows predated the stripper, so
  every recurring article kept re-serving its dirty cached copy forever. This fed BOTH the new non-AI list
  and the LLM writer's prompt (confirmed: the same un-stripped text is what `write.ts` slices into the
  writer's source material) — a real, silent data-quality bug in the AI path too, just invisible because
  the model quietly worked around its own garbage input. Fixed by running `stripReaderPreamble` in
  `loadCorpus` as well, same "clean on read and on write" rule `PostPage` already followed.
  Verified live: renamed digest 1 to "Pssst...it's me!" and force-resent today's issue (`buildIssue(6,
  {force:true})`) — real content now, sent successfully (16 items, status `sent`). One smaller, separate
  cosmetic issue survived (a few excerpts lead with feed clutter — category tag, byline, a stray image
  markdown — before the real sentence; one inbox item shows raw email forward-headers) — flagged to the
  owner, not fixed, out of scope for this bug.
- **Files/commits:** `apps/digest/lib/digest/build.ts` (import + one line in `loadCorpus`). Uncommitted.
- **PM impact:** none beyond the fix — no STATE/ROADMAP row changes, this is a correctness fix to a shipped
  pipeline, not a new capability.

## 2026-08-01 — Digest AI gated behind a paid tier, mechanical fallback otherwise `[ship]`
- **What:** Owner call — the digest pipeline was overusing LLMs; most of it should work without one, with AI
  as a paid add-on. Audited the whole pipeline: exactly 4 model call sites, all through one `callModel`
  chokepoint (`search` gather, `select` editorial triage, `write` intro/section, `quiz` closer). Added one
  `aiEnabled(digest)` resolver in `lib/digest/llm.ts` and checked it at all 4 sites, each falling back to
  its own mechanical equivalent: select → `candidates.slice(0, keep)` (the pre-select behavior), write →
  plain linked list of gathered items instead of prose, intro → omitted. `prompt` (reflection) sections and
  the quiz closer have no non-AI equivalent and are simply skipped when AI is off — pure generation, nothing
  to fall back to.
  Two-layer gate: new `digests.ai_enabled` column (migration `20260803130000`, default false, mirrors the
  existing `web_search_enabled` pattern — this is the seed the real paid-entitlement work
  (ROADMAP Now #2) will set later, not a full billing system yet) + `DIGEST_AI_ENABLED` env override
  (unset = off outside production, `=true` opts back in locally, `=false` is an ops kill-switch). Settings
  UI (new + edit) gained an "AI writing (paid)" checkbox above the existing web-search one, off by default.
  Typecheck clean; migration pushed to remote.
- **Files/commits:** `apps/digest/lib/digest/{llm,adapters,select,write,closers,build,types}.ts`,
  `apps/digest/app/digests/{actions.ts,new/page.tsx,[id]/page.tsx,[id]/settings/page.tsx}`,
  `apps/digest/scripts/{smoke-sources,smoke-db-sources}.ts`, `apps/digest/README.md`,
  `supabase/migrations/20260803130000_digests_ai_enabled_flag.sql`. Uncommitted.
- **PM impact:** connects to ROADMAP Now #2 (Monetization rails v1) — `ai_enabled` is the chokepoint that
  work should flip once real Stripe entitlement lands, no further pipeline changes needed.

## 2026-08-01 — Explained digest LLM chokepoint/gateway architecture `[chore]`
- **What:** Q&A only, no code changes from me — walked through how digest creation works: the `callModel` gateway in `lib/digest/llm.ts`, the 4 conceptual LLM chokepoints (gather/selectValuable/write/closers), the `compile()` pipeline in `build.ts`, and the `web_search_enabled` kill-switch pattern (checked inside `adapters.ts`, not scattered). Used as groundwork for the upcoming monetization gating work (extend the same kill-switch pattern to all 4 chokepoints).
- **Files/commits:** none by me. Note: working tree already has uncommitted digest changes (adapters.ts, llm.ts, select.ts, types.ts, new `digests_ai_enabled_flag` migration) that predate/are outside this conversation — not catalogued here since I didn't author them.
- **PM impact:** none.

## 2026-08-01 — `/api/digests/1/preview` spinner: not a bug, just slow `[wip]`
- **What:** Resolved the diagnosis from the prior entry. Ran `previewIssue(1)` directly (outside the HTTP
  layer) and it completed cleanly in **173s** — 6 sections, 19 items, no errors. So the route isn't hanging;
  it's doing real LLM work across 6 sections (gather + write each) with zero progress feedback in the
  browser, which reads identically to a hang for the first ~3 minutes. Told the author to confirm whether
  they waited that long; if they did and it still never resolved, the bug is in the HTTP path specifically
  (dev-server handling / browser abort), not the compile logic — otherwise no fix needed. Deleted the
  scratch debug harness (`apps/digest/scripts/tmp-preview-debug.ts`) now that it served its purpose.
- **Files/commits:** none (diagnosis only; debug script removed, not committed).
- **PM impact:** none — no fix was needed if the theory holds; revisit only if the author reports otherwise.

## 2026-08-01 — Inbox messages open to a full-text detail view `[ship]`
- **What:** The inbox list only showed a 240-char clamp per message. Subject is now a link to
  `/digests/[id]/inbox/[messageId]`, a detail page mirroring `PostPage`'s pattern (full text, sender/date,
  back link, "used in issue" link). Rendered via the same `body_text || stripHtml(body_html)` the pipeline
  itself trusts — deliberately NOT `dangerouslySetInnerHTML` on raw mail HTML, since that's sender-controlled
  content and would be stored XSS in an authenticated view. Typecheck passes.
- **Files/commits:** new `apps/digest/app/digests/[id]/inbox/[messageId]/page.tsx`; edited
  `apps/digest/app/digests/[id]/inbox/page.tsx`. Uncommitted.
- **PM impact:** none.

## 2026-08-01 — `/api/digests/1/preview` hangs (spinner, no response) `[wip]`
- **What:** Reported not working; ruled out auth (401-without-cookie was expected, but user is signed in at
  :8080 and still gets an infinite spinner, not even a 401 — so the request itself is hanging somewhere in
  gather → write → render). Reproducing directly via `previewIssue(1)` outside the HTTP layer to find which
  stage stalls; not yet resolved.
- **Files/commits:** scratch-only `apps/digest/scripts/tmp-preview-debug.ts` (debug harness, delete before
  commit, not part of the fix).
- **PM impact:** none yet — will promote once root cause + fix land.

## 2026-08-01 — Inbox tab: the mailbox becomes a first-class view `[ship]`
- **What:** Inbound mail was only inspectable by running a script — "a push source you cannot see is a push
  source you cannot trust." New `Inbox` tab per digest: subject, sender, received, body size, used/unused
  (linking to the issue), a 2-line preview, and per-message delete. Two deliberate calls: (1) *used* is NOT
  a column on `digest_inbox_messages` — it's recomputed by hashing the adapter's synthetic permalink and
  joining `digest_posts`, so "delivered" keeps ONE definition across every source kind; (2) deleting a
  message does not delete the `digest_posts` row it produced — delivery history isn't rewritten to tidy a
  mailbox. Empty state names the failure mode that looks identical to "nothing sent yet" (401 → permanent
  drop). Also flags messages under the 120-char floor that the adapter will skip.
- **Files/commits:** `app/digests/[id]/inbox/page.tsx` (new), `layout.tsx` (tab), `actions.ts`
  (`forgetMessage`), SETUP.md §B. Typecheck + `next build` green.
- **PM impact:** none beyond the already-shipped `inbox` row in STATE.

## 2026-08-01 — Inbound mail proven end-to-end; the push source is live `[ship]`
- **What:** First forwarded newsletter 401'd. Mailgun's event log had the whole story
  (`accepted → read+…@pensive.me`, `accepted → webhook`, `failed / Unauthorized`): `MAILGUN_SIGNING_KEY`
  was in `.env.local` but never in Vercel production. Added it, **redeployed** (env vars only bind to new
  deployments — that gap is what killed the message), then verified the full path without waiting on
  another forward: POSTed a synthetic message signed with the real key → `{"ok":true,"digest_id":1}`, row
  inserted, `inboxAdapter` returned it, test row deleted. `digest_inbox_messages` back to 0 rows.
- **Files/commits:** SETUP.md §F (signing-key item now closed, with the redeploy trap recorded). No code.
- **PM impact:** STATE — Mailgun route row moves from `blocked (owner)` to shipped/verified.
- **Consequence worth remembering:** a signature failure returns 401, and Mailgun treats **4xx as
  permanent drop**. Mail sent during a misconfigured window is not retried — it is simply lost.

## 2026-08-01 — digest.pensive.me live; inbox address moved to the Settings tab `[ship]`
- **What:** A record added by owner → `digest.pensive.me` resolves (76.76.21.21), TLS valid, root 307s to
  the auth bounce, webhook 401s (fail-closed, signing key now added). Mailgun route created successfully.
  UX fix off a real miss: the inbound address only rendered on the Sections tab, gated on an `inbox` section
  existing — the owner went looking on Settings and found nothing. `InboxAddress` now renders on the digest
  Settings tab unconditionally (Sections keeps its contextual copy). Also cleared a stale `.next` (dev and
  prod builds sharing one directory → `Cannot find module './958.js'`).
- **Files/commits:** `app/digests/[id]/settings/page.tsx`, SETUP.md §B (address location + digest 1's token).
- **PM impact:** STATE deployment row already true; `inbox` now blocked only on an actual test message.
- **Note:** ran `prettier --write` on the settings page before noticing the repo has **no prettier config** —
  it reflowed a ~110-col file to 80. Reverted by rewriting in the house style. Don't reach for prettier here.
## 2026-08-01 — Per-kind section field schema (SSOT) `[ship]`
- **What:** owner-approved fix for the gap raised the same day. `lib/digest/sectionSchema.ts` now declares
  every kind's fields once — which exist, which are **required**, what each *means*, how a raw string becomes
  a property — and both consumers derive from it: `AddSectionForm` renders it (no kind names left in the
  component) and `buildSection` parses + **enforces** it. Replaces the same list living in `types.ts` +
  the form's JSX + a per-kind switch in `actions.ts` (3 edits/field, silent drift). Pure data, not parse
  callbacks, so it crosses the client boundary and reads as documentation; `field.name` doubles as the
  Section property name, which deleted the rename table (`readwise_mode`→`mode` etc). `requiredWhen` is one
  named hook for the single conditional case (`ranked.targets`), not a rule engine. Verified: feed-without-
  urls / serial-without-book / search-without-query / any-kind-without-title now **rejected** with a reason;
  all valid configs still parse; junk URLs filtered; `category:""` omitted rather than stored. 0 typecheck
  errors, builds.
- **Files/commits:** uncommitted. `apps/digest/lib/digest/sectionSchema.ts` (new),
  `apps/digest/app/digests/[id]/AddSectionForm.tsx`, `apps/digest/app/digests/actions.ts`, README.
- **PM impact:** none — an internal consistency fix, no priority change.


## 2026-08-01 — Digest section editing, in progress `[wip]`
- **What:** Pre-existing uncommitted changes found in the tree, not made in this session — no context available on intent. Flagging so they're not silently uncatalogued; author to fill in details or re-tag on next touch.
- **Files/commits:** `apps/digest/app/digests/[id]/AddSectionForm.tsx` (trimmed, -247/+80), new `apps/digest/lib/digest/sectionSchema.ts` (317 lines, untracked). Uncommitted.
- **PM impact:** none.

## 2026-08-01 — Root `dev:digest` script `[chore]`
- **What:** Added `pnpm dev:digest` to root `package.json`, matching the existing `dev:web`/`dev:marketing` convention (proxies to `apps/digest`'s own `next dev --port 3001`). No new server code — the app script already existed, just wasn't wired at the root.
- **Files/commits:** `package.json` (uncommitted).
- **PM impact:** none.

## 2026-08-01 — Digest write stage moves to DeepSeek `[ship]`
- **What:** owner directive — write on DeepSeek instead of Sonnet. `lib/digest/llm.ts` now routes on the
  **model id alone** (`providerFor`), so there's no second switch to keep in sync; `MODEL_WRITE =
  deepseek-v4-pro`, `MODEL_GATHER` stays `claude-opus-5`. Gather **cannot** move: `web_search` is an
  Anthropic server tool and would be silently dropped, so `callModel` throws if a DeepSeek model is handed
  `tools`. Renamed `callClaude` → `callModel` (5 sites) — a function named Claude that dials DeepSeek is
  exactly the drift this repo keeps paying for. Two hazards found and fixed: (1) DeepSeek charges reasoning
  against `max_tokens`, so `writeIntro`'s 400 would have returned empty — added `REASONING_HEADROOM` per
  effort level + a `truncated` marker in `ai_calls`; (2) DeepSeek brackets citations (`[[Anthropic](url)]`),
  which rendered as link text `[Anthropic` plus an orphan `]` — fixed in `render.ts` by unwrapping a bracket
  pair around a whole link (literal `[1, 2]` still survives), deliberately render-side since citation habits
  differ per model. Verified live: intro 156 chars/5.1s, section 229 chars with a correct citation, tools
  guard fires, `ai_calls` rows land as `provider=deepseek`.
- **Files/commits:** uncommitted. `apps/digest/lib/digest/{llm.ts,render.ts,write.ts,adapters.ts,select.ts,closers.ts}`,
  `apps/digest/.env.local` (DEEPSEEK_API_KEY), README (env table + new "Two providers" section).
- **PM impact:** none — it applies the standing `ai_provider = deepseek` decision (2026-07-10) to a second
  app rather than making a new call. Noted here so the digest's cost profile is traceable.
- **Open, not mine:** `updateSectionMaxItems` is imported by `MaxItemsField.tsx` but no longer exported from
  `app/digests/actions.ts` — the parallel session deleted it mid-flight; it is the only typecheck error and
  it blocks `next build`. Left for them.
- **Raised by owner, not built:** section config has no required/optional contract — the field schema is
  triplicated across `types.ts`, `AddSectionForm.tsx` and `actions.ts`, and `addSection` validates nothing,
  so a `feed` with no URLs or a `serial` with no book saves happily and gathers 0 items forever (verified);
  an empty `search` query is worse — it still burns an Opus call. Fix = one per-kind field schema as SSOT,
  same shape as `dnaSchema.ts`. Proposed, awaiting the owner's call.

## 2026-08-01 — Digest: sections are now editable, not just add/remove `[ship]`
- **What:** Sections previously could only be added or removed — no way to fix a typo'd query or bump
  `max_items` after creation. Started narrow (an autosave-on-blur `max_items` field) but the real gap was
  broader, so generalized: extracted `buildSection()` out of `addSection`'s per-kind switch and added
  `updateSection`, a read-modify-write that replaces one section by id. `AddSectionForm` now does double
  duty as the edit form — takes an optional `section` prop, prefills every field via a generic `val()`
  reader, posts to `updateSection` instead of `addSection` when editing. Each section row gets a native
  `<details>/<summary>` "edit" disclosure (no client state needed for open/close). Removed the one-off
  `MaxItemsField.tsx` autosave widget — it's now subsumed by full editing and would've been a second,
  conflicting way to change the same value. Verified with `tsc --noEmit` and `next build` (auth-gated
  dev server, couldn't click-test in browser).
- **Files/commits:** `apps/digest/app/digests/actions.ts` (buildSection extraction + updateSection),
  `apps/digest/app/digests/[id]/AddSectionForm.tsx` (edit mode), `apps/digest/app/digests/[id]/page.tsx`
  (details/summary wiring), deleted `apps/digest/app/digests/[id]/MaxItemsField.tsx`. Uncommitted.
- **PM impact:** none — digest still has no STATE board row (parallel session owns it, per the prior
  entry); this rides along with whoever catalogues that row.

## 2026-08-01 — Digest deployed: third Vercel project, live at pensive-digest.vercel.app `[ship]`
- **What:** Created + linked Vercel project `pensive-digest` (root dir `apps/digest`, `vercel.json` mirroring
  marketing's monorepo `ignoreCommand`), set 5 production env vars, deployed to production. Verified live:
  root 307s to `app.pensive.me/auth` (shared-cookie bounce works), `/api/inbound/mailgun` returns 401
  (reachable + fail-closed on the absent signing key). `digest.pensive.me` attached but unconfigured —
  `pensive.me` is on Squarespace/NS1 nameservers, needs `A digest 76.76.21.21` added by hand. Preview env
  vars NOT set: the pinned CLI (54.1.0) loops on `git_branch_required` even with `--yes`.
- **Files/commits:** `apps/digest/vercel.json` (new), `apps/digest/.vercel/` (gitignored), SETUP.md §B/§F
  rewritten to match reality. Deployment `dpl_GrWPfDEohXgtQiK1LuA7oVEPYbXv` — a **CLI upload, not a
  git-connected build**, so no push-to-deploy yet.
- **PM impact:** STATE Morning Digest table — deploy row now true; `inbox` still blocked on
  `MAILGUN_SIGNING_KEY` + the Mailgun route (which can now be created against the `.vercel.app` URL).

## 2026-08-01 — Mailgun route blocker resolved: the digest app was never deployed `[chore]`
- **What:** Real error out of `POST /v3/routes` was `"...must be publicly accessible"` — not the regex and
  not the plan. Confirmed: `digest.pensive.me` does not resolve, and `vercel projects ls` shows no digest
  project (`apps/digest` was never linked). SETUP.md ordering was wrong (§B Mailgun before §F deploy);
  §B now carries a deploy-first gate with the verbatim error. Noted that the route can point at the raw
  `*.vercel.app` production URL, so the custom domain isn't required to start testing `inbox`.
- **Files/commits:** `apps/digest/SETUP.md` (§B gate). No code.
- **PM impact:** none — STATE already records `inbox` as inert pending the route; the reason is now known.
  Awaiting owner's call on who creates the Vercel project (new public surface, not doing it unilaterally).

## 2026-08-01 — Mailgun inbound route: diagnosed, not yet created `[chore]`
- **What:** Owner hit "Failed to create route" in the Mailgun UI. Verified read-only that this is NOT a DNS
  problem — `pensive.me` MX → `mxa/mxb.mailgun.org`, both valid, domain active, 0 routes existing. API
  creation attempt returned `401 insufficient permissions`: the key in `.env.local` is a domain-scoped
  SENDING key, not an account key. Two live candidates left: an unescaped `+` in the match_recipient regex
  (must be `^read\+.*@pensive\.me$`), or routes being gated behind a paid plan (Upgrade button present).
  Fallback if it's the plan: inbound-only on a `read.pensive.me` subdomain via Cloudflare Email Workers or
  SendGrid Inbound Parse — sending stays on Mailgun so the Kindle approved-sender path is untouched.
- **Files/commits:** none (diagnosis). `apps/digest/SETUP.md` §B is the affected step.
- **PM impact:** none — `inbox` was already recorded in STATE as inert pending the route.

## 2026-08-01 — Digest: six new source kinds + closer contract + per-section cadence `[ship]`
- **What:** Built the whole backlog from the morning's ideation. New kinds: `ranked` (HN/arXiv/GitHub/
  Lobsters/reddit — borrows the world's ranking instead of building one), `inbox` (Mailgun inbound →
  the pipeline's first PUSH source), `unread` (corpus leftovers), `sitewatch` (page diff, url-versioned),
  `video` (YouTube/podcast), `quiz` (first **closer**: reads the last issue, retrieves nothing).
  Structural: `Closer` as a second contract with `ADAPTERS`/`CLOSERS` split on `isCloser`, and
  `cadence: daily|weekdays|weekly` per section. Adapters split into `lib/digest/sources/*` with shared
  `fetch.ts` + `feedparse.ts`; add-section form made kind-aware. Verified live: hn/arxiv/lobsters return
  real ranked items; YouTube transcripts proven *unavailable* server-side (falls back to description);
  reddit 403 and github 60/hr-per-IP both measured and documented.
- **Files/commits:** `apps/digest/lib/digest/{types,build,adapters,closers,fetch,feedparse}.ts`,
  `lib/digest/sources/{ranked,inbox,unread,sitewatch,video}.ts`, `app/api/inbound/mailgun/route.ts`,
  `app/digests/[id]/{AddSectionForm,InboxAddress}.tsx`, `scripts/smoke-{sources,db-sources}.ts`,
  `supabase/migrations/20260803120000_digest_inbox.sql` (**pushed to remote**), README + new `SETUP.md`.
  Uncommitted.
- **PM impact:** DECISIONS entry (closer contract · push source · cadence · measured transcript finding).
  Owner checklist at `apps/digest/SETUP.md` — needs `MAILGUN_SIGNING_KEY` + a Mailgun inbound route
  before `inbox` does anything.

## 2026-08-01 — Readwise as a digest source kind `[ship]`
- **What:** `apps/digest` can now pull quotes from a reader's own Readwise vault — a fifth source
  adapter, so gather/filter/write/render were untouched. Two draws: `review` (Readwise's own daily
  spaced-repetition pick) and `random` (books list → books weighted by `num_highlights` → one random
  page each, so cost is O(1) requests at any vault size). Credential grain is **per user**, not per
  digest and not an env var: new `digest_user_settings` table + an account-level `/settings` page that
  verifies the token against `GET /auth/` before storing it, and states the paid-plan requirement.
  Quote sections skip the LLM entirely and render from a template — verbatim is the whole value, so a
  model in that path can only paraphrase, pad, or misquote. Dedupe reuses `digest_posts` keyed on the
  Readwise permalink, reconstructed for `/review/` which omits it. Verified end-to-end through the real
  `previewIssue`: 5 real quotes, both modes, correct blockquote HTML, 5 corpus rows, zero gather/write
  model calls.
- **Files/commits:** uncommitted. `supabase/migrations/20260802090000_digest_user_settings.sql`;
  `apps/digest/lib/digest/{readwise.ts,adapters.ts,types.ts,write.ts,render.ts}`;
  `apps/digest/app/settings/{page.tsx,actions.ts}`; `apps/digest/app/digests/{actions.ts,[id]/page.tsx,[id]/posts/page.tsx}`;
  `apps/digest/app/{layout.tsx,globals.css}`; README + `doc_1785584624000.md`.
- **Follow-up same day:** the account-vs-digest settings split wasn't discoverable — the reader looked
  for Readwise on the digest's own Settings tab and concluded it wasn't built. Added a signpost there
  pointing at `/settings`. Reconciled with the parallel `adapters.ts` refactor that landed meanwhile
  (six more source kinds): Readwise adapter, registry entry, write short-circuit, blockquote render and
  the add-section fields all survived it, and that session's extracted `AddSectionForm` improved the
  fields to show only when `readwise` is picked. Dropped my posts-page staleness exclusion — they had
  already reframed age as neutral context, so it was dead code. App typechecks at 0 errors and builds.
- **PM impact:** DECISIONS (credential grain + verbatim-render call). No STATE row — the digest
  project has no board row yet and the parallel session owns that app's board entry; left it for
  whoever catalogues the six-source-kind work.

## 2026-08-01 — Digest: content-kind ideation (source taxonomy + backlog) `[wip]`
- **What:** Ideation pass over `apps/digest` for new section kinds. Framed the gap as *coverage*, not
  ideas: the four existing kinds cover public-pull and owned-corpus only; missing are private push
  (`inbox` via Mailgun inbound routes), exogenous ranking (`ranked` — HN/arXiv/GitHub, which dissolves
  the "selection is not ranking" gap by picking sources that ship a score), and memory-of-issues
  (`followup`, `quiz`). Two structural moves flagged as worth more than any single kind: per-section
  cadence, and splitting `Adapter` into source vs transform before a third transform-shaped kind exists.
  No code written.
- **Files/commits:** `doc_1785583615575.md` (uncommitted); reference only — `apps/digest/lib/digest/{types,adapters}.ts`.
- **PM impact:** none — backlog/proposal, not ratified. Promote if the author picks an order.

## 2026-08-01 — Digest: read stored post bodies in-app; strip extractor preamble `[ship]`
- **What:** Posts list only linked out, so the body we'd already paid to extract went unread. Added
  `/digests/:id/posts/:postId` rendering the stored markdown with the same renderer the digest uses; the
  list title now opens that, with `original ↗` demoted to a secondary link.
  **Found while building it:** every stored body began with r.jina.ai's metadata block (`Title: … URL
  Source: … Markdown Content:`) — present in 8/8 rows — which meant it was also being fed to the *writer*
  as source material on every feed item. Now stripped at extraction (and again on read, so pre-existing
  rows display correctly without a backfill), with its `Published Time` used as a fallback date. 5 cases
  tested including a decoy marker deep in an article that must not truncate it.
  Also: `_underscore_` emphasis (what the extractor emits) rendered literally — added, anchored so
  snake_case identifiers survive; 5 cases tested.
  **The corpus immediately paid off:** post ages are now visible and stark — James Clear **6.8y**, Daily
  Stoic **3y**, Modern Stoicism **7mo**, against same-day Hyperallergic/ARTnews/Tricycle. Those feeds
  republish evergreen archives, so the "daily" has been serving 2020 writing. List flags >6mo.
- **Files/commits:** `apps/digest/lib/digest/{entities,adapters,render}.ts`,
  `app/digests/[id]/posts/{page.tsx,[postId]/page.tsx}`, README. Uncommitted.
- **PM impact:** none ranked. Recommended next: `max_age_days` per section — the evidence is now concrete.

## 2026-08-01 — Digest: regenerate archives instead of overwriting `[ship]`
- **What:** "Regenerate" (force-rebuild an already-sent issue) was overwriting `digest_issues.content`/`html`
  in place — the old delivered morning was silently lost, because `(digest_id, issue_date)` uniqueness is
  the idempotency key the scheduler relies on and can't change. Fix: snapshot the row into a new
  `digest_issue_versions` table right before the overwrite (fails closed if the archive insert errors), so
  the old render survives as history instead of vanishing. Issue page now lists archived versions with links
  to a read-only snapshot view; the issues list shows a "regenerated (N archived)" badge. Chose this over
  letting `digest_issues` hold multiple rows per day specifically to avoid touching
  `claim_digest_issue`/`due_digests` — smaller blast radius for the same outcome.
- **Files/commits:** `supabase/migrations/20260801190000_digest_issue_versions.sql` (applied),
  `apps/digest/lib/digest/build.ts`, `apps/digest/components/IssueContentView.tsx` (new, extracted),
  `apps/digest/app/issues/[id]/page.tsx`, `apps/digest/app/issues/[id]/versions/[versionId]/page.tsx` (new),
  `apps/digest/app/digests/[id]/issues/page.tsx`. Uncommitted (part of the still-uncommitted `apps/digest/`
  tree).
- **PM impact:** none ranked — same uncommitted digest app as the prior entry below.

## 2026-08-01 — Digest: persist every pulled post (`digest_posts`) `[ship]`
- **What:** Fetched items were ephemeral — only what shipped survived, inside `digest_issues.content`. New
  `digest_posts` (migration `20260801180000`) keeps every post any section pulls, with its extracted body,
  source, section, image and published date. Unlocks the three things that were impossible: **visibility**
  (`/digests/:id/posts`, with a per-source used/pulled hit rate — the unused half is the evidence for
  whether a feed earns its place), **reuse** (stored bodies skip re-extraction), and **ranking** (the
  "pick 3 of 40" gap is now at least implementable).
  It **subsumes `digest_items_seen`** rather than sitting beside it: same `(digest_id, url_hash)` grain,
  strict subset of columns — two tables at one grain is drift waiting to happen. "Seen" became
  `used_at is not null`; the 14 existing rows were migrated with delivered-state intact before the drop.
  Regenerate now *un-uses* posts instead of deleting them, so the corpus outlives a rebuild.
  **Invariant held explicitly:** dedupe keys on delivered, never fetched — otherwise anything pulled and
  passed over would be blacklisted forever. Previews record posts but never mark used.
  Verified: corpus 14 → 24 across two previews, 10 fetched-but-unused posts now visible, dedupe correctly
  surfaced the *next* items from each feed. Body reuse saves r.jina.ai calls, not wall-clock (19.9s warm vs
  21.8s cold — extraction overlaps the parallel writes), and that's how it's documented.
- **Files/commits:** `supabase/migrations/20260801180000_digest_posts.sql` (applied),
  `apps/digest/lib/digest/{build,types,adapters}.ts`, `app/digests/[id]/posts/page.tsx`,
  `app/digests/[id]/page.tsx`, README. Uncommitted.
- **PM impact:** none ranked.

## 2026-08-01 — Digest: content-quality review, no code changes `[chore]`
- **What:** Owner asked how to improve digest content quality. Read the pipeline (adapters/write/README's
  own Known gaps) and gave a ranked recommendation: (1) feed recency cutoff — highest leverage, cheap,
  currently a correctness bug (evergreen archives surface as "today"); (2) source-quality domain allow/deny
  list as a hard backstop to the existing soft prompt-only prior; (3) an editorial ranking pass within a
  feed (selection, not just newest-N); (4) per-claim citation attribution; (5) cross-source clustering;
  (6) the 👍/👎 feedback loop, correctly last since it amplifies whatever selection quality already exists.
  Owner has not yet picked which to implement.
- **Files/commits:** none — analysis only.
- **PM impact:** none.

## 2026-08-01 — Digest: regenerate a delivered day; Daily Stoic / James Clear / Marginalian feeds `[ship]`
- **What:** **Regenerate** (`?force=1` + a button) for days that returned `already_sent`. The non-obvious
  part: a naive rebuild produces an EMPTY issue, because the first build marked its own items seen and the
  dedupe layer then eats them — correct behaviour in the one case you don't want it. Added
  `digest_items_seen.issue_id` (migration `20260801170000`, `on delete set null` so dedupe memory outlives a
  deleted issue) and regenerate deletes exactly that issue's rows first. Kept the unforced no-op: that guard
  is what stops a watchdog retry or double tick from mailing twice, so overriding it is a separate button
  with a confirm. Verified: unforced → `already_sent`; forced → `sent`, 4/4 sections, 11 items, ~29s.
  Added the three requested feeds (probed first — `jamesclear.com/feed` works, `/feed.xml` 404s).
  **Owner correction applied:** quote-plus-commentary is a legitimate newsletter format, not a defect — my
  section instruction *and* the digest voice were both rejecting it; both rewritten, and that section now
  ships (it was the one silently returning NOTHING_TODAY). Also fixed double-encoded feed titles
  (`&#8220;` → `“`) by extracting `entities.ts` (dependency-free, so it is directly testable) — 7 cases pass.
- **Files/commits:** `supabase/migrations/20260801170000_digest_items_seen_issue_id.sql` (applied),
  `apps/digest/lib/digest/{build,adapters,entities}.ts`, `app/api/digests/[id]/run/route.ts`,
  `app/digests/[id]/RunNowButton.tsx`, README. Uncommitted.
- **PM impact:** none ranked. New known gap: feeds have no recency filter, so evergreen-archive feeds
  (jamesclear.com) surface years-old posts as today's.

## 2026-08-01 — Digest: web search behind an opt-in flag; RSS becomes the default path `[ship]`
- **What:** `search` is the only gather path that bills every run (Opus 5 + web_search server tool) —
  `feed`/`serial`/`prompt` cost nothing but fetches. Added `digests.web_search_enabled` (migration
  `20260801160000`, **default false**, existing rows included) enforced inside `searchAdapter` itself so no
  future caller can reach the paid path by accident; exposed as a checkbox on create + edit, with a "⚠
  skipped" note on search sections while it's off, and the section-kind dropdown now defaults to `feed`.
  **Fixed a real feed bug found while configuring multi-feed sections:** the old loop drained feed 1 to the
  cap before ever reading feed 2, so with `max_items: 3` the later feeds were never read at all — and it
  paid for article extraction on candidates the cap then discarded. Now reads all feeds, interleaves
  round-robin, caps, and only then extracts. Probed 11 candidate feeds (10 live, theartnewspaper 404) and
  reconfigured digest #1 to 3 RSS sections + the reflection. Verified with **preview** (no send, no state):
  200, 3 sections, 7 items, 1 image, ~25s, **zero Opus calls**.
- **Files/commits:** `supabase/migrations/20260801160000_digests_web_search_flag.sql` (applied),
  `apps/digest/lib/digest/{types,adapters,build}.ts`, `app/digests/{actions.ts,new/page.tsx,[id]/page.tsx}`,
  README. Uncommitted.
- **PM impact:** none ranked. Open: a philosophy section with 7.7k tokens of material still returned
  NOTHING_TODAY — likely an over-strict per-section instruction, worth a second look.

## 2026-08-01 — Digest: local preview loop (compile without sending) `[ship]`
- **What:** There was no way to see a digest without mailing yourself a Kindle document, so testing meant
  ad-hoc scripts. Split `compile()` (①–⑤) out of `buildIssue` (persistence + delivery) and added
  `previewIssue` + `GET /api/digests/:id/preview` + a Preview button: compiles today's issue through the
  **same** code path the 6am job uses and returns it as a web page — no mail, no `digest_issues` row, no
  seen-items; preview spend lands in `ai_calls` with `task_id = null`. `?ignoreSeen=1` compiles as if
  nothing had been delivered, because a preview right after a real send correctly dedupes to nothing and
  reads as a broken pipeline. Verified by minting a session via admin `generate_link` and driving the route:
  200, 2 sections, 5 items, 3 citations, and confirmed zero DB side effects afterwards. Both auth gates
  (preview session, tick secret) return 401 unauthenticated. README now documents the three run modes.
- **Files/commits:** `apps/digest/lib/digest/build.ts`, `app/api/digests/[id]/preview/route.ts`,
  `app/digests/[id]/RunNowButton.tsx`, README. Uncommitted.
- **PM impact:** none ranked.

## 2026-08-01 — Digest: Sonnet for writing, grounded images, small citations `[ship]`
- **What:** Three owner-requested changes. (1) **Model split** — gather stays Opus 5 (drives web_search +
  judges source quality, where a mistake poisons everything downstream), write moves to Sonnet 5, which is
  where the daily token volume lives; `callClaude` takes a per-call model and `ai_calls` logs the one that
  actually ran. (2) **Images, grounded the same way citations are** — `og:image` discovered deterministically
  at gather time (top 3 items/section); the writer may reference `![](item:N)` by INDEX and can never author
  a URL, so a fabricated image is structurally impossible; referenced images are inlined as `data:` URIs so
  nothing depends on Amazon making outbound fetches. (3) **Citations render small/grey** via `<small
  class="src">` + a terse-link-text rule in the constitution. Renderer behaviour checked on 6 cases incl. the
  adversarial one (model-authored image URL → dropped). Issue #6 delivered (~49s); a forced image issue also
  delivered to prove the inlining path, since the writer declined to use an image on its own.
- **Files/commits:** `apps/digest/lib/digest/{llm,types,adapters,write,render,build}.ts`,
  `app/issues/[id]/page.tsx`, README. Uncommitted.
- **PM impact:** none ranked. Open question for the owner: does Amazon's converter render `webp`?

## 2026-08-01 — Digest: stoicism/art/meditation config + source-quality and reflection fixes `[ship]`
- **What:** Reconfigured digest #1 to the owner's actual interests and shipped issue #5 to the Kindle (~51s,
  3 sections). Three fixes made it readable: (1) **source-quality prior** in the gather prompt — prefer
  primary sources/criticism/institutions, silently discard SEO listicles and content farms, report empty
  rather than build on slop; without it these beats are all "10 Stoic quotes to start your day". (2) New
  **REFLECTION_CONSTITUTION** for `prompt` sections — the grounding constitution deadlocked them (nothing to
  cite ⇒ nothing may be said); the binding rule flips to "quote no one, attribute nothing", since the failure
  mode there is an invented Marcus Aurelius line, not an unsourced claim. (3) **Renderer ate backslash
  escapes** — a magazine named `Wallpaper\*` rendered as "Wallpaper\"; escapes are now parked before the
  emphasis passes and restored after, with the four cases checked.
- **Files/commits:** `apps/digest/lib/digest/{adapters,write,render}.ts`. Uncommitted.
- **PM impact:** none ranked — still a live prototype.

## 2026-08-01 — Digest: full pipeline compiled and delivered a real issue `[ship]`
- **What:** Ran the whole thing through the *scheduler* path (not the manual button): `due_digests` →
  `claim_digest_issue` → gather (Anthropic web_search) → dedupe → per-section write → verify → assemble →
  render → Mailgun → Kindle → mark-seen. Issue #4 landed on the device; 2 sections in parallel, ~74s.
  Three bugs found by exercising it: (1) `max_uses: 5` on web_search exhausted by dynamic filtering's
  fan-out, so sections shipped empty; (2) `NOTHING_TODAY` was too easy to reach — the writer bailed on real
  material because the constitution framed the escape hatch as a virtue; now an emptiness test, not a
  quality bar; (3) the researcher's process narration ("I'll run three searches…") was being read verbatim
  as source material and poisoning the writer's judgement. Prose quality with the voice applied is good and
  properly sourced. Biggest remaining gap: **source quality** — best available source was an SEO aggregator.
- **Files/commits:** `apps/digest/lib/digest/{llm,write,adapters}.ts`, `apps/digest/README.md`. Uncommitted.
- **PM impact:** none ranked — M1 items still own the Now slots; this is a live prototype, not a product.

## 2026-08-01 — Digest: delivery leg proven on a real Kindle `[ship]`
- **What:** Wired env (Mailgun + service role) and ran the render→Mailgun→Kindle path for real. Amazon
  returned `delivered / OK` and the issue opened on the device — approved sender, `.html` attachment, and
  Amazon's HTML→book conversion all confirmed, which is what justifies deferring EPUB to v1.
  **Caught a silent-failure bug pre-send:** `deliver.ts` used `mailgun@pensive.me` (copied from
  notify-task-done); the approved sender is `hello@pensive.me` (what send-kindle-verification and
  BookInfo.tsx both use). Wrong From = Send-to-Kindle drops the mail with no bounce, so every digest would
  have vanished silently. Gather + write remain unexercised — blocked on ANTHROPIC_API_KEY.
- **Files/commits:** `apps/digest/lib/digest/deliver.ts`, `apps/digest/README.md`, `apps/digest/.env.local`
  (gitignored). Uncommitted.
- **PM impact:** none yet — the riskiest leg is de-risked, but no issue has been compiled end to end.

## 2026-08-01 — Digest: full compile pipeline + config UI landed (unexercised) `[wip]`
- **What:** Built the whole gather→filter→write→verify→assemble→render→deliver path. 4 source adapters
  behind one contract (search via Anthropic `web_search` server tool; feed via RSS/Atom + r.jina.ai
  extraction; serial off the long-unused `books.digest_bookmarked_page_index` cursor; prompt). One LLM
  chokepoint (`lib/digest/llm.ts`, Anthropic direct, logs to `ai_calls` with source='digest'). Three-tier
  instruction stack — immutable constitution / per-digest voice / per-section. Sections mapped in parallel
  so 6 cost ~1 section's latency. Mailgun→Kindle as HTML (EPUB deferred; the builder is browser-only).
  pg_cron→/api/cron/tick + a "Run now" button, both through `claim_digest_issue` so neither can double-send.
  Config UI + issue reader. **Tagged wip, not ship: never run end-to-end** — needs ANTHROPIC_API_KEY,
  MAILGUN_*, SUPABASE_SERVICE_ROLE_KEY and a real Kindle. Builds clean; canonicalization, RSS/Atom parsing
  and markdown→HTML verified directly.
- **Files/commits:** `apps/digest/**` (18 new source files + README), `@anthropic-ai/sdk` added. Uncommitted.
- **PM impact:** none beyond the decision entry below — nothing shippable until the delivery leg is proven.

## 2026-08-01 — Digest: new app decided + schema and scaffold landed `[decision]`
- **What:** Ratified `digest.pensive.me` as a **separate bounded context, shared kernel** — its own
  Next app/UI/tables, but the same Supabase project so it inherits `auth.users`, the shared
  `.pensive.me` session cookie, the OTP-verified Kindle addresses, and the approved Mailgun sender.
  Landed the spine: 3 tables + timezone-local scheduler (`due_digests`) + atomic claim
  (`claim_digest_issue`, `unique(digest_id, issue_date)` as the idempotency lock), pushed live.
  Scaffolded `apps/digest` (Next 14, builds clean). SPA now accepts a cross-origin `returnTo` on
  `*.pensive.me` (host allow-listed against open redirect) so digest can bounce to it for sign-in —
  the SPA keeps sole ownership of token refresh, avoiding the cross-subdomain rotation race.
- **Files/commits:** `supabase/migrations/20260801120000_digest_schema.sql` (applied),
  `apps/digest/**` (new), `apps/web/src/pages/auth/Auth.tsx`. Uncommitted.
- **PM impact:** DECISIONS (new product surface + seam). Not ranked into ROADMAP Now — author's call.

## 2026-08-01 — Morning Digest: system design (no code) `[wip]`
- **What:** Designed a daily "morning digest → Kindle" feature. Core stance: the digest is
  *compiled* from grounded sources, not *generated* — inverse of the DNA pipeline. Gather (no LLM)
  → dedupe → per-section write (map) → verify → assemble → render → Mailgun. 3 new tables
  (`digests`, `digest_issues`, `digest_items_seen`), 4 source adapters, stays on Supabase edge
  (parallel fan-out fits the ~150s cap), v0 sends HTML not EPUB. Awaiting author go/no-go — not
  ratified, not ranked into the roadmap.
- **Files/commits:** `doc_1785565352472.md`, `learning_1785565352472_morning_digest_design.md` (uncommitted, untracked).
- **PM impact:** none — proposal only.

## 2026-07-29 — Admins can commit/publish books they don't own `[ship]`
- **What:** Book 1326 404'd on pensive.me — not a slug bug (bare-id URL 404'd too) but no published
  version. Root cause of *that*: `create_book_version` + `publish_version` hand-rolled a bare
  `owner_id = auth.uid()` guard while `check_book_access`, `user_can_edit_book` and the RLS policies
  had all learned about `admin_users` — authorization predicate drift. Admin could edit and toggle
  visibility, then get stonewalled at commit, leaving `is_public=true` + `published_version_id=NULL`,
  which the marketing reader correctly serves as 404. Added an admin bypass to both publish-path
  functions; verified live via a `BEGIN…ROLLBACK` dry-run impersonating a non-owner admin.
- **Files/commits:** `d886df9` — `supabase/migrations/20260729120000_version_fns_admin_override.sql`
  (applied to prod *before* it was committed, so repo history trails the live schema here).
  Diagnosis touched `apps/marketing/lib/public-books.ts:194-196`.
- **PM impact:** none — standalone bug fix, no Now slot. Two follow-ups logged below, neither blocking.
  - `book_versions` SELECT policies aren't admin-aware (7 policies, duplicated) → unpublished commits
    invisible to admins in version history. Publishing works regardless.
  - No constraint enforces `is_public = true ⇒ published_version_id IS NOT NULL` — the invariant whose
    violation produced the silent public-facing 404.
  - Deliberately NOT done: widening to `user_can_edit_book` (would let invited editors publish
    publicly) and widening `rollback_to_version` (its restore loop stamps `owner_id = auth.uid()`,
    which would reassign page ownership to the admin).

## 2026-07-29 — Committed the AgentRail redesign session `[chore]`
- **What:** Squashed the day's seven-pass AgentRail thread (header-overflow fix, left dock, canvas/
  chrome split, drag-resize, border cleanup, minimal scrollbars) into one commit on
  `agent-rail-self-sufficient`. All prior passes already have their own WORKLOG entries above; this
  entry just records the commit itself.
- **Files/commits:** `38f5ab6` — AgentRail.tsx, search.tsx, DnaTreePage.tsx, pm/WORKLOG.md.
- **PM impact:** none — same UI-polish scope as the entries above, now landed.

## 2026-07-29 — AgentRail: scrollbar flush against the rail's true right edge `[ship]`
- **What:** Seventh pass, same thread. The conversation scrollbar sat with a visible gap from the
  rail's edge (the shell's own `px-3.5` plus the scroll div's `pr-1` stacked to ~18px of inset).
  Cancelled the shell's contribution with `-mr-3.5` on the conversation wrapper and moved that same
  inset onto the scroll div's own `pr-3.5`, so the scrollbar now sits flush at the true edge while text
  keeps its original alignment. Verified via geometry (scroll div's right edge === rail width, exactly).
- **Files/commits:** `apps/web/src/features/dna/components/AgentRail.tsx` — uncommitted, verified live
  (`tsc --noEmit` clean, no console errors).
- **PM impact:** none — UI polish on AgentRail, no roadmap/State change.

## 2026-07-29 — AgentRail: minimal scrollbars on rail/search/canvas `[ship]`
- **What:** Sixth pass, same thread. The default OS scrollbar (thick, opaque) looked out of place next
  to the flat/borderless redesign. Reused the app's existing `.sidebar-scroll` utility (already used
  elsewhere: 6px, transparent track, 20%-opacity thumb) on the rail's conversation + past-chats list,
  the search results list, and the canvas's own scroll container — matching the Lovable reference.
- **Files/commits:** `apps/web/src/features/dna/components/AgentRail.tsx`,
  `.../components/tree/search.tsx`, `.../pages/DnaTreePage.tsx` — uncommitted, verified live (CSS
  rules confirmed applied via devtools, `tsc --noEmit` clean, no console errors).
- **PM impact:** none — UI polish on AgentRail, no roadmap/State change.

## 2026-07-29 — AgentRail: drop the last border lines for a continuous rail/canvas surface `[ship]`
- **What:** Fifth pass, same thread. Removed the canvas card's remaining `border` stroke (color +
  rounded corners alone now read as the card) and made the resize handle's idle-state line transparent
  (was a faint permanent `T.border` line) — visible only on hover/drag. Rail and canvas now read as one
  continuous surface at rest, per feedback that the leftover border broke that continuity.
- **Files/commits:** `apps/web/src/features/dna/pages/DnaTreePage.tsx` — uncommitted, verified live
  (`tsc --noEmit` clean, no console errors).
- **PM impact:** none — UI polish on AgentRail, no roadmap/State change.

## 2026-07-29 — AgentRail: fixed-viewport shell, sticky header, canvas as inset card `[ship]`
- **What:** Fourth pass in the same-day AgentRail redesign thread. The whole page used to be one
  long window-scroll, so the title bar/tab-strip scrolled away with tree content. Converted the shell
  to a fixed-height flex layout: title bar pinned, tab strip `sticky` inside the canvas's own
  `overflow-y:auto` container (rail's chat already scrolled independently). Per follow-up feedback,
  restored the canvas as a rounded/bordered inset card (nested inside the "control panel," not flush
  edge-to-edge) and matched the rail-header/title-bar heights (44px) with no border between them — the
  drag-resize handle now starts below that shared strip, sitting exactly on the canvas card's own left
  edge instead of cutting through the merged header.
- **Files/commits:** `apps/web/src/features/dna/pages/DnaTreePage.tsx` (fixed-viewport `base`, sticky
  tab strip, canvas card + `HEADER_H`/`CANVAS_MARGIN` consts), `.../components/AgentRail.tsx` (header
  height/border matched to `HEADER_H`) — uncommitted, verified live (independent scroll confirmed,
  `tsc --noEmit` clean, no console errors).
- **PM impact:** none — UI polish on AgentRail, no roadmap/State change.

## 2026-07-29 — AgentRail: drop card borders, make the rail edge a real drag-to-resize handle `[ship]`
- **What:** Third pass in the same-day AgentRail redesign thread. Per feedback that the two card
  borders (chatbox + canvas) read as clutter next to Lovable's flat reference, removed both — rail
  and canvas are now flat regions distinguished by color only (`T.surface` vs `T.raised`). Replaced
  the static rail width with real drag-to-resize on the rail/canvas edge itself (hover tooltip +
  accent highlight, clamped 320–760px, persisted per-book in localStorage) — also closes the original
  "width isn't adjustable" complaint from earlier today, this time for real.
- **Files/commits:** `apps/web/src/features/dna/components/AgentRail.tsx`,
  `.../pages/DnaTreePage.tsx` (`railWidth` state + drag handlers, replacing the fixed `RAIL_W` const)
  — uncommitted, verified live (hover/drag/persist + `tsc --noEmit` clean, no console errors).
- **PM impact:** none — UI polish on AgentRail, no roadmap/State change.

## 2026-07-29 — AgentRail: merge top chrome with rail header, card the chatbox `[ship]`
- **What:** Follow-up to the same-day left-dock/canvas redesign. Per a Lovable UI reference, unified
  AgentRail's own header (Agent/manual-auto/fast-deep/close) with the tree's title bar into one
  continuous top strip (both now on `T.surface`/`--pv-surface-2`, no color seam), then wrapped the
  conversation + next-step nudge + composer in their own bordered, distinctly-toned "chatbox" card —
  mirroring the canvas card already carved out on the tree side.
- **Files/commits:** `apps/web/src/features/dna/components/AgentRail.tsx` (dropped the outer `Panel`,
  added a bordered chatbox wrapper), `.../pages/DnaTreePage.tsx` (rail container bg `T.raised` →
  `T.surface`, `borderRight` softened) — uncommitted, verified live + `tsc --noEmit` clean.
- **PM impact:** none — UI polish on AgentRail, no roadmap/State change.

## 2026-07-29 — AgentRail: fix header overflow, redock left, canvas/chrome visual split `[ship]`
- **What:** Traced 3 reported bugs (wand icon vanishing, close button off-screen, "width not
  adjustable") to one flexbox overflow in the rail header — `shrink-0` guards + a width bump fixed
  it (a concurrent session landed the same header fix independently as commit `2aef127`; converged
  cleanly). Then, on live redirect, moved AgentRail to the left dock (Search swapped to the right),
  replaced the "Editor" text toggle with an icon-only pane button next to the book title, redesigned
  the "next step" nudge as a compact row (icon + label + step badge + Continue), and wrapped the
  tab strip + all tab bodies in one rounded `T.raised` "canvas" card against a `T.surface` "chrome"
  page background (title bar/rail read as controls around it) — matching a Lovable reference the
  user shared mid-task.
- **Files/commits:** `apps/web/src/features/dna/components/AgentRail.tsx`,
  `.../components/tree/search.tsx`, `.../pages/DnaTreePage.tsx` (uncommitted, verified live via
  browser + `tsc --noEmit`, no console errors).
- **PM impact:** none — UI polish on an already-shipped surface (AgentRail), no roadmap/State change.

## 2026-07-29 — Committed + pushed the DNA tree skeleton fix `[chore]`
- **What:** Committed the already-catalogued ghost-skeleton fix (below) plus the pending AgentRail Wand2/shrink-0 cleanup, and pushed `agent-rail-self-sufficient` to origin (new branch, upstream set).
- **Files/commits:** 2aef127 "DNA tree: default-open empty skeleton, fix ghost opacity compounding".
- **PM impact:** none — same work already logged, this entry just closes the commit/push loop.

## 2026-07-29 — DNA tree: default-open the empty skeleton, fix ghost opacity compounding `[ship]`
- **What:** The DNA tree's ghost-preview machinery (dnaSkeleton.ts/GhostRows) already existed but was invisible on a revisited book — the SEED node defaults collapsed (openSet is opt-in for childless nodes) unless freshly bootstrapped this session. Now the loader auto-opens any seed/premise/act whose ghost preview has content, so a book with an empty tree shows its forecasted shape (premise→pillar→cast→acts→template beats) on load, no click needed. Also fixed a real bug found while verifying: each recursive GhostRow wrapped itself in its own `opacity:0.6` div, so nested opacity compounded per depth (0.6, 0.36, 0.216...) fading deeper ghost rows toward invisibility — moved the opacity to one wrapper in GhostRows.
- **Files/commits:** apps/web/src/features/dna/pages/DnaTreePage.tsx, apps/web/src/features/dna/components/tree/GhostRows.tsx (uncommitted).
- **PM impact:** none — small UX fix, not a roadmap item.

## 2026-07-29 — Rename Wand2 → WandSparkles in AgentRail `[chore]`
- **What:** Replaced deprecated lucide-react `Wand2` alias with its canonical `WandSparkles` name (import + 2 usages).
- **Files/commits:** apps/web/src/features/dna/components/AgentRail.tsx (uncommitted).
- **PM impact:** none.
## 2026-07-28 — Resume-chat RPC + optimistic restore, and an RLS row-lock bug `[ship]`
- **What:** Did the twin flagged below. `resumeAgentSession`'s five dependent statements (SELECT thread → SELECT target → INSERT archive → DELETE target → UPDATE thread, non-atomic — a mid-chain failure could **delete an archived chat without restoring it**) are now one `resume_agent_session` RPC. The rail predicts the *content* here, not just a blank: the session's steps are already in hand from the "Past chats" fetch, so the restored chat paints at **25ms**. Generalised the optimistic layer from `clearing: boolean` to `predicted: {steps, proposals, since}`, where `since` is the row's `updated_at` at click time — a BEFORE UPDATE trigger bumps it, making "updated_at moved" the exact "our write committed and came back" signal (strictly better than v1's "release when the row reads empty", which only worked because new-chat's destination is unique). **Bug found and fixed en route:** the first resume RPC locked the session row with `SELECT … FOR UPDATE` and silently restored nothing — twice — while *appearing* to work, because the optimistic prediction was never released (nothing wrote → `updated_at` never moved); only a reload showed the truth. Cause: **PostgreSQL applies a table's UPDATE policies to a locking `SELECT … FOR UPDATE`**, and `book_agent_sessions` has SELECT/INSERT/DELETE policies but **no UPDATE policy**, so the lock matched zero rows and the function took its "target gone" branch. `book_agent_runs` has `editors update agent runs`, which is why the identical lock on the thread row — and `start_new_agent_session` — was fine. Fix: drop the session lock (the thread lock already serialises), and change the return `bigint`→`boolean` because NULL had meant both "nothing to archive" (success) and "target gone" (no-op) — that ambiguity is what let it masquerade. Client now clears the prediction and says so on `false`. **Standing lesson: an optimistic UI can hide a total server failure — verify optimistic paths by reloading, never by reading the screen.**
- **Files/commits:** `supabase/migrations/20260728130000_resume_agent_session_rpc.sql` + `20260728140000_resume_agent_session_rls_lock_fix.sql` (both **pushed**), `apps/web/src/features/dna/lib/agentThread.ts`, `components/AgentRail.tsx`, `doc_1785234486000.md` (§10). Uncommitted on `agent-rail-self-sufficient`. Typecheck clean; round-tripped both directions on book 1276 with reload-verified server truth, book left exactly as found.
- **PM impact:** none — same reasoning as below. Both chat mutations are now single atomic RPCs; **still not exercised by hand: the mid-turn guard on either RPC and the empty-thread no-op.**

## 2026-07-28 — "New chat" archive collapsed into one atomic RPC `[ship]`
- **What:** Did the thing the entry below said it wasn't doing. `startNewAgentSession`'s SELECT → INSERT → UPDATE chain is now one `start_new_agent_session(p_thread_id)` Postgres function; the client is a single `supabase.rpc`. **SECURITY INVOKER** (default, same as `snapshot_book_tree`) so the caller's RLS still governs — this buys round trips, not reach. Three wins beyond speed: (1) `SELECT … FOR UPDATE` closes the **check-then-act race** the client had — it read `status`, then wrote with nothing holding the row, so a turn starting in between would be archived out from under the edge function; (2) INSERT-archive and UPDATE-thread-empty are now **one transaction**, closing the crash-leaves-a-duplicated-chat window flagged yesterday; (3) the mid-turn guard + "nothing to archive" no-op moved into SQL, guard message kept verbatim so the toast is unchanged. Measured on book 1276: one 412ms `rpc/start_new_agent_session` replaces the chain, server settles ~1.1s (was ~2.5s), click→blank still 3ms; verified by reload that the thread is empty and exactly one archive exists. **`resumeAgentSession` is untouched and still six round trips** with the same non-atomic shape — the symmetric twin, obvious next candidate. **Not exercised by hand:** the mid-turn guard and the empty-thread no-op (same logic, moved).
- **Files/commits:** `supabase/migrations/20260728120000_start_new_agent_session_rpc.sql` (new, **pushed to remote**), `apps/web/src/features/dna/lib/agentThread.ts` (18 lines → 4), `doc_1785234486000.md` (§9). Uncommitted on `agent-rail-self-sufficient`. Typecheck clean.
- **PM impact:** none — same reasoning as below; no Now slot, no project row. The atomicity gap noted yesterday is now closed for new-chat, still open for resume.

## 2026-07-28 — Optimistic "New chat" in AgentRail: 1.9s frozen frame → 4ms `[ship]`
- **What:** Acted on the trace diagnosis below. `newChat` now predicts its outcome instead of waiting for it: a `clearing` flag renders `steps`/`proposals` empty the moment the author clicks, and the three dependent writes run underneath. The flag is released only when the row itself reads empty over Realtime — which also **masks the stale Realtime snapshot of the old chat** that lands mid-flight — and is rolled back (with the optimistically-bumped Past-chats count) if the archive throws. It doubles as the double-click guard. Repointed the two proposal writes at `rowProposals` (server truth) rather than the displayed `proposals` (a prediction); the invariant is *predict on screen, mutate what the server has*. **Measured on book 1276: click → rail blank = 4ms, one frame**, down from a 1,924.6ms frozen frame; verified the prediction matched reality by reloading (thread genuinely empty server-side, archive landed). Consciously NOT done: the Postgres RPC. The three round trips still happen and the non-atomic INSERT-then-UPDATE window (crash → duplicated chat) is unchanged — they are just off the author's critical path now.
- **Files/commits:** `apps/web/src/features/dna/components/AgentRail.tsx` (+35/-7), `doc_1785234486000.md` (§8 Resolution). Uncommitted on branch `agent-rail-self-sufficient`. Typecheck clean (`tsc -p tsconfig.app.json`), no new console errors.
- **PM impact:** none — opportunistic fix on an existing surface, no Now slot consumed and no project row changed. The atomicity gap remains uncatalogued as work; it stays a note here.

## 2026-07-28 — Diagnosed "New chat" latency in AgentRail: a 3-RTT waterfall, not a CPU cost `[chore]`
- **What:** Read a DevTools performance trace of clicking "+ New chat" on book 1276. Verdict: **latency-bound, not CPU-bound** — ~440ms of main-thread work inside a ~3.1s window (~85% idle), and the Frames track shows a single **1,924.6ms frame**, i.e. the rail is visibly frozen for ~2s. Cause is `startNewAgentSession` (`agentThread.ts:312-329`) issuing three *dependent* round trips — `SELECT book_agent_runs` → `INSERT book_agent_sessions` → `UPDATE book_agent_runs` — whose own JS costs 0.3ms total; the UPDATE then fires Realtime, fanning out into ~4 more refetches (thread row + session count). Two follow-ups identified but **not applied**: (a) optimistic UI — blank the rail on click, reconcile after — hides all three RTTs for free; (b) collapse the three statements into one Postgres RPC, which also makes archiving atomic (today a crash between the INSERT and the UPDATE leaves a duplicated chat). Also noted a minor non-composited `color` animation (304ms) flagged red in the Animations track. No code changed — analysis + teaching write-up only.
- **Files/commits:** `doc_1785234486000.md` (trace-reading walkthrough + diagnosis), `learning_1785234096258_profile_new_chat.md` (gitignored). No source edits, no commits.
- **PM impact:** none — diagnosis only, no product surface changed and no priority proposed. The duplicated-chat-on-crash atomicity gap is the one item here worth escalating if it is ever observed in the wild.

## 2026-07-28 — Groom worktree: headless eval tooling + accumulated session docs `[chore]`
- **What:** Worktree had a week of uncommitted work sitting loose (two new headless eval scripts, a bridge export, an architecture doc, and five `doc_*.md` session notes). Grouped by relation and committed separately rather than one dump: (1) `dna-short-story.mjs`/`.mts` — drives a complete short story through the full DNA ladder incl. prose, headless, then grades it with novelDna's own lints + observed meter trace (needed a new `runReadMeters` export from `eval-bridge.mjs`); (2) `eval-logline.mjs` + task suite — single-turn eval of the deployed brief→logline forge (code graders + deployed judge + `ai_calls` metrics); (3) `agent-architecture-diagram.md` — visual companion to the existing architecture docs; (4) five standalone `doc_*.md` design/diagnosis notes from 07-14 through 07-24 (Frontier Engine options, RAG trade-offs, mobile PKCE bug, agent-hardening framing, Craft Notes tab design) that hadn't been committed yet. Also gitignored the `.dna-short*.out` scratch run logs the short-story script produces (same pattern as existing `.dna-*.json`/`.md` scratch rules).
- **Files/commits:** `b7891dc` (short-story pipeline), `6d6dec9` (logline eval), `ad7a23e` (architecture diagram), `d491cee` (session notes) — all on branch `agent-rail-self-sufficient`, not pushed.
- **PM impact:** none — bookkeeping/tooling, no product surface changed. The two eval scripts are candidate evidence-gate tooling for Now item #1 (read-round-trip counts) but weren't run as part of this task.

## 2026-07-25 — AgentRail self-sufficiency: staged options + `@` mentions in the chat `[ship]`
- **What:** The rail could not resolve everything the agent handed back. Staged options (`propose_options` → `book_nodes.proposals`) were pickable ONLY at the tree row — the seam followed *storage* (run-column vs node-column) instead of the user's task — so the chat rendered a "jump to the tree" card. Added `agentRail/OptionsCard`, the rail-native twin of the tree's `ProposalPicker`: presentational duplication only, both share the write (`lib/dnaProposals`) and the diff (`describeOps`). Also generalised `Composer`'s slash popover into a `ComposerMenu` and added an `@` trigger that attaches a context anchor without leaving the chat (the tray could previously only *detach*). **Invariant now recorded in `features/dna/FEATURE.md`:** every decision the agent puts to the author — proposal · question · staged options — must be resolvable in the rail. Verified live on book 1324 (pick-from-chat commits + clears both surfaces + logs its turn); synthetic test data restored exactly. Deliberately left: stale accept/discard (tree-computed state, not an agent-staged decision — needs a design answer for what occasions the card) and render/read (already global chrome).
- **Files/commits:** one commit at the tip of branch **`agent-rail-self-sufficient`** (not merged to main, not pushed) — `apps/web/src/features/dna/components/agentRail/OptionsCard.tsx` (new) · `components/AgentRail.tsx` · `components/agentRail/Composer.tsx` · `components/agentRail/StepBubble.tsx` · `components/tree/proposalOverlay.tsx` · `pages/DnaTreePage.tsx` · `features/dna/FEATURE.md` · `doc_1784985294531.md`. Fold in with `git merge --ff-only agent-rail-self-sufficient`.
- **PM impact:** none — a UI-completeness fix inside the existing AgentRail pillar, not a Now-slot item. Neither Now item (live full-book build re-run; monetization rails v1) is advanced or displaced.
## 2026-07-25 — Brief intake: "Skip the brief" now fully dismisses `[ship]`
- **What:** In `BriefIntakeSheet`, the skip button said "Skip this" but only advanced one step at a time — no way to bail out of the whole brief in one click. Renamed to "Skip the brief" and changed `skip()` to call `onOpenChange(false)` directly, same path as dismissing the dialog (Esc/overlay), which the caller (`NewBook.tsx`'s `closeIntake`) already routes into the manual/Studio choice fork. `Next` already had no validation blocker (unchanged).
- **Files/commits:** `apps/web/src/components/book/BriefIntakeSheet.tsx`. Uncommitted.
- **PM impact:** none — small UX fix, not Now-slot work.
## 2026-07-24 — Logline eval + it caught 3 prod bugs (incl. an outage) `[ship]`
- **What:** Built a single-turn eval for brief → logline (`knowledgebase/agents/eval.md` applied): grades the *deployed* `dna-expand` target=logline with a hybrid stack — code checks (shape + must_mention/avoid regex + Jaccard anti-restate) × the deployed `read-logline` LLM-judge × tokens/latency from `ai_calls`; reports pass@1 / pass^k. 8 balanced tasks each with a reference solution (`--refs` fairness mode). **The eval earned its keep immediately — surfaced 3 real bugs unit tests couldn't:** (1) **prod outage** — `ai_provider="auto"` routed every call to MuleRouter (negative balance) → all AI 402-failing; set switch to `deepseek`; (2) logline forge `max_tokens:400` + no effort bound → DeepSeek-v4 reasoning (counts inside max_tokens) burned the budget, returned empty; fixed `effort:"low"`+`max_tokens:3000`; (3) same truncation in `read-logline` judge (1200→3000). Path went 100% broken → 24/24 pass@1, all pass^3.
- **Files/commits:** `scripts/eval-logline.mjs` + `scripts/eval-logline-tasks.json` (new), `supabase/functions/dna-expand/index.ts` + `supabase/functions/read-logline/index.ts` (reasoning-headroom fixes, both deployed), `.gitignore` (+`scripts/.eval-*`), `doc_1784887217516.md`. DB: `admin_settings.ai_provider` auto→deepseek. Uncommitted.
- **PM impact:** DECISIONS (provider switch — see below). Adjacent to M1 Now-slot "live full-book build" (that path runs on this same DeepSeek config) but not the slot itself; Now unchanged. **Owner action pending:** keep `deepseek` or top up MuleRouter + revert to `auto`.
## 2026-07-24 — Craft Notes: prose note + expansion configs; backlog committed `[ship]`
- **What:** Closed the coverage gap the earlier Craft Notes entry left. (1) Added the **Prose** craft note — the richest craft in the engine (fourth-wall voice rule, anti-repetition law, anti-tic budgets) was inline in dna-expand and unexposed; extracted to `PROSE_CRAFT` + wired through `craftBody`. (2) Added a second **"Structure generation"** section exposing the config-driven passes that have no code craft const (cast/world/relationships/set-pieces/threads/games/acts/beats/scenes/voice_profile/pillar): their `role` + `count` from the global `node_type_configs` table are now overridable per book via new `books.expansion_overrides`; the generic expander merges override-over-config. `schema_json`/`slots` deliberately NOT editable (output contract); `premise` excluded (special-cased). Defaults read live from `node_type_configs` — its own SSOT, so no mirror/lock needed (unlike the code-const notes). (3) Also committed the pre-existing **ai_calls observability + speak-and-act** backlog at the owner's direction — the two threads are entangled in `advance.ts` so they went in as one honestly-labelled commit (not authored/verified this session).
- **Files/commits:** `bd88b94` (craft notes tab + prose), `e2bc43d` (expansion configs, migration `20260724130000`), `db05196` (ai_calls + speak-and-act, migrations `20260723*`), `9798a0b` (this catalogue). main is 6 ahead of origin — **not pushed**.
- **PM impact:** none — authoring-quality feature, not an M1 Now-slot item (Now stays: live full-book build · monetization rails). Verified: web tsc + edge deno check clean, migrations pushed, dna-expand deployed. **Gap: never click-tested in-browser** — both automation paths were offline; the Structure section's `node_type_configs` read is unconfirmed visually.
## 2026-07-24 — agent-tree doc: guard/wire-format/turn-cluster nodes committed `[chore]`
- **What:** Committed the three doc follow-ups from the prior two chore entries (guard-clause explanation, transcript-vs-steps wire-format clarification, and the new turn-cluster node + its "not stored in the DB" child) as one commit, since they'd accumulated uncommitted across several clarifying-question exchanges on the same file.
- **Files/commits:** apps/web/src/pages/docs/AgentTree.tsx — commit 7caf579.
- **PM impact:** none. pm/WORKLOG.md itself was NOT committed this round — it currently carries substantial unrelated uncommitted work from a concurrent session (Craft Notes tab, dev inspector, cache instrumentation) that this session didn't touch and won't sweep into a commit.


## 2026-07-24 — Craft Notes tab: per-book overrides of tier-1 craft `[ship]`
- **What:** New "Craft Notes" tab in the DNA studio (`/dna/tree/craft`) lists the 5 generation stages that carry distilled craft (logline/premise/beats·causality/beats·polarity/scene·direction), shows the code default, and lets the author rewrite each PER BOOK. Overrides persist to a NEW `books.craft_overrides` jsonb (kept off the research-map `craft_notes`) and actually change generation: both write paths read them — `dna-expand` via `craftBody(key, over)` in each stage prompt, `book-agent` via a `<craft_overrides>` context block that supersedes its default-craft skills. `craft-kb.ts` stays SSOT; web reads a committed `craftNotes.json` mirror locked by `craftNotes.artifact.test`. Judges (read-logline/read-premise) deliberately kept on the tier-1 default so a bad note can't self-approve.
- **Files/commits:** migration `20260724120000_books_craft_overrides.sql` (pushed); `_shared/craft-kb.ts` (CRAFT_NOTES/craftBody/craftOverrideBlock); `dna-expand/index.ts` + `book-agent/context.ts` (deployed); web `features/dna/lib/craftNotes.json` + `.artifact.test.ts`, `components/tree/CraftNotesPane.tsx`, `pages/DnaTreePage.tsx`. Not yet committed. `doc_1784833613000.md` writes it up.
- **PM impact:** none (adjacent authoring-quality feature; not an M1 Now-slot item). Verified: web tsc + vitest green, edge deno check clean, migration pushed, fns deployed. In-browser click-through still pending (debug profile was busy).
## 2026-07-24 — Speak-and-act verified on claude-local `[chore]`
- **What:** Bridge restarted (shim + functions serve); combined interview exchange verified on the claude-local path: ONE call (#10614, 12.6s, tool_use:update_vision with the reply in its `reply` param) -> run idle, reply in feed. Same shape as deepseek (#10612). The reply-param mechanism is provider-independent, as designed.
- **Files/commits:** none (runtime verification only).
- **PM impact:** none.


## 2026-07-24 — Speak-and-act v2: reply rides IN the tool call `[chore]`
- **What:** Deepseek ignored the "text alongside tool" instruction (ai_calls 10609/10610 — reasoning tiers rarely emit text+tool_use together), so the combine is now deterministic: update_vision gained a `reply` param; advance.ts surfaces it as the chat note and the result-blind rule idles on it. Verified: one call per interview exchange (#10612, 13.4s, run→idle, reply in feed) vs the old two-call ~22s. Executor unaffected (VISION_SECTIONS whitelist ignores `reply`).
- **Files/commits:** book-agent/{advance,tools,prompts}.ts, _shared/agent-skills.ts (deployed); shim already supports text-alongside-tool for local.
- **PM impact:** none.


## 2026-07-24 — Cache instrumentation + speak-and-act (result-blind) rule `[ship]`
- **What:** (1) ai_calls now logs the prompt-cache split: cache_read_tokens / cache_write_tokens, normalized at the llm.ts chokepoint (Anthropic cache_read_input_tokens · DeepSeek prompt_cache_hit_tokens · OpenAI cached_tokens); dev inspector shows a "cached" column (+%) and modal fields. (2) Combined the interview's two-call shape into one: update_vision is RESULT-BLIND (result always "ok"), so an interactive turn with reply text + only result-blind tools now executes the write and goes idle — no continuation call (measured before: 2nd call doubled input billing +~5s/exchange, ai_calls 10606/10607). Prompts updated (tool desc, SYSTEM_THREAD §5, vision-interview skill) to put the reply IN THE SAME message; claude-local shim envelope extended with optional text-alongside-tool. Auto mode unchanged.
- **Files/commits:** supabase/migrations/20260723140000_ai_calls_cache_tokens.sql (pushed), _shared/llm.ts, _shared/agent-skills.ts, book-agent/{advance,tools,prompts}.ts (deployed), scripts/claude-local-shim.mjs (needs local shim restart), DnaDevPage.tsx (uncommitted).
- **PM impact:** none.


## 2026-07-23 — ai_calls.output_json: full completion blocks logged `[ship]`
- **What:** `output` is a text-only projection (textFromLLM), so a pure-tool_use completion logged as 0 chars — the claude-local shim's tool replies carry no text block at all, making agent turns' most important output invisible. New jsonb column output_json = the completion's raw content blocks (text/tool_use/thinking), written at the llm.ts chokepoint (both terminal paths). Dev inspector modal now shows "output — full completion (text + tool calls)" flattened + raw blocks; legacy rows keep the text-only view with an honest caveat. Known remaining gap: claude-local tokens are null because the shim runs plain `claude -p` (no usage) — fixable later via --output-format json.
- **Files/commits:** supabase/migrations/20260723130000_ai_calls_output_json.sql (pushed), supabase/functions/_shared/llm.ts (book-agent redeployed; other fns pick it up on their next deploy — additive, no behavior change), apps/web/src/features/dna/pages/DnaDevPage.tsx (uncommitted).
- **PM impact:** none (observability infra).


## 2026-07-23 — ai_calls.transcript_index: exact call↔turn correlation `[ship]`
- **What:** Systematic fix for turn↔call pairing (index arithmetic mis-chipped turns whenever a done call produced no message in the current slice). New column ai_calls.transcript_index recorded AT EMIT TIME by advance.ts (baseTranscript.length = the slot the assistant reply lands in) through the llm.ts CallMeta chokepoint. Dev inspector joins exactly (slice-windowed by session boundaries, newest attempt wins); legacy rows fall back to backward index pairing, honest ∅ otherwise. Principle: record correlations at the source, never reconstruct them.
- **Files/commits:** supabase/migrations/20260723120000_ai_calls_transcript_index.sql (pushed), supabase/functions/_shared/llm.ts, supabase/functions/book-agent/advance.ts (deployed), apps/web/src/features/dna/pages/DnaDevPage.tsx (uncommitted).
- **PM impact:** none (observability infra).


## 2026-07-23 — Dev inspector: TriggerCard at the top of every cluster `[chore]`
- **What:** Every turn-cluster now opens with a bordered trigger banner: WHO (AUTHOR green — typed message / answered parked question; HARNESS amber — auto-accept applied+resumed; UNKNOWN — mid-slice) + the full trigger message, with harness text riding the same message (AUTO-VERIFY verdict) as a labeled collapsible and a "+N tool results" note for carried results. TriggerCard consumes the cluster's first user message (renderMessage skips it). Verified on 1229 #25.
- **Files/commits:** apps/web/src/features/dna/pages/DnaDevPage.tsx (uncommitted).
- **PM impact:** none.


## 2026-07-23 — Dev inspector: cluster trigger moved to the top `[chore]`
- **What:** The ✓ apply-ack now STARTS the auto-resume cluster (it's the trigger evidence — the first thing the resumed model call reads, often sharing a message with the AUTO-VERIFY verdict) instead of dangling at the previous cluster's tail. Labels now carry the applied proposal's own summary ("applied prose render 'Third render attempt for scene 19…' → resumed") + kind-tag tooltips explaining ask/answer/auto-resume/mid trigger semantics; outcome shows "term → applied live" read from the next cluster's opening ack. Verified on 1229 #25.
- **Files/commits:** apps/web/src/features/dna/pages/DnaDevPage.tsx (uncommitted).
- **PM impact:** none.


## 2026-07-23 — Dev inspector: auto-resume clusters made self-describing `[chore]`
- **What:** Fixed the "incomplete" auto-resume view: cluster label = the actual ✓ ack that closed the previous cluster (not boilerplate) + "serving <standing ask>"; carried-in tool_results at a cluster's start render compactly instead of vanishing; ⚠ banner on thread runs whose earlier slices were archived to book_agent_sessions (transcript = current slice only); SENTINEL now matches the real "🔎 AUTO-VERIFY" literal (was [verify]-shaped) so verify injections no longer mint spurious ask-clusters. Verified on book 1229 run #25 (9 bogus clusters → 6 true ones).
- **Files/commits:** apps/web/src/features/dna/pages/DnaDevPage.tsx (uncommitted).
- **PM impact:** none.


## 2026-07-23 — Dev inspector: transcript grouped by turn-clusters `[chore]`
- **What:** /dna/tree/dev now reconstructs the implicit turn-cluster (no schema column exists; `turns` spans ask→answer parks so it's unusable) the same way the engine does: cluster starts at real author input (non-sentinel typed text, or a HUMAN tool_result answering a parked ask_author — auto's "AUTONOMOUS mode" synthetic answer excluded) and closes at quiescence (next input, or the auto "✓ Applied/STAGED" ack before an idle→resume bounce, labeled auto-resume). One collapsible section per cluster: trigger · kind · turn count · outcome (terminal tool / reply / parked / applied live) · aggregate tokens+latency; newest cluster open. Verified live.
- **Files/commits:** apps/web/src/features/dna/pages/DnaDevPage.tsx (uncommitted).
- **PM impact:** none.


## 2026-07-23 — Dev inspector: guaranteed per-turn full-context inspection `[chore]`
- **What:** Every model turn now carries a "full context ▸" chip (or an explicit `call ∅` marker when no ai_calls row is in the fetch window) opening the whole context as sent: system prompt, readable flattened messages (flattenInput), raw wire JSON, output, artifacts. Pairing anchored backward from newest call (robust to the 500-call window); archived sessions now pair via thread_id + archive-time cutoff and get their own calls table. Verified live in browser.
- **Files/commits:** apps/web/src/features/dna/pages/DnaDevPage.tsx (uncommitted).
- **PM impact:** none.


## 2026-07-23 — Dev inspector made skimmable (trace-view pass) `[chore]`
- **What:** Reworked /dna/tree/dev transcript rendering: tool_result folded into its tool_use as one collapsed `name · input → result` row (expand = full pair), narration prose stays visible, thinking collapses, result-only user messages vanish, harness sentinel nudges tagged, tool names in turn headers, long scalar chips truncated. Verified live in browser (magic-link-minted cookie session for flyingversen; @supabase/ssr = cookie storage, not localStorage).
- **Files/commits:** apps/web/src/features/dna/pages/DnaDevPage.tsx (uncommitted).
- **PM impact:** none.


## 2026-07-23 — Admin dev inspector at /dna/tree/dev `[ship]`
- **What:** Admin-only flight recorder per book: /books/:slug/dna/tree/dev lists all book_agent_runs + book_agent_sessions + ai_calls (Realtime signal→refetch, light-columns list / heavy-blobs on demand). Run view renders the transcript turn-by-turn (text/thinking/tool_use/tool_result) and pairs each assistant turn with its ai_calls row (model @ provider, tokens, latency, stop_reason); call modal shows full system/input/output/artifacts; raw row JSON always available.
- **Files/commits:** apps/web/src/features/dna/pages/DnaDevPage.tsx (new), apps/web/src/App.tsx (route, AdminRoute-gated; uncommitted). Typecheck clean; live browser test deferred per author.
- **PM impact:** none (dev tooling; no roadmap slot).


## 2026-07-23 — agent-tree doc: clarified "LLM wire format" + transcript/steps split `[chore]`
- **What:** User asked what "LLM wire formats" meant in the transcript/steps node, and was unsure whether transcript and steps are separate stored entities. Confirmed (grounded in advance.ts) they're two separate fields on the same row, written in parallel from the same LLM response, not one derived from the other — then updated the "Why both a transcript and a step feed?" node in AgentTree.tsx with that clarification + the concrete wire-format shape vs. the flat steps shape. User also gave a standing instruction ("always update the doc when I ask clarifying qns") — saved as a feedback memory (feedback_update_docs_on_clarifying_questions.md) so this pattern applies automatically going forward.
- **Files/commits:** apps/web/src/pages/docs/AgentTree.tsx. Uncommitted (further follow-up to commit 39f12a3, same file as the prior "guard" chore entry). Memory: ~/.claude/projects/.../memory/feedback_update_docs_on_clarifying_questions.md.
- **PM impact:** none. Note: apps/web/src/App.tsx and apps/web/src/features/dna/pages/DnaDevPage.tsx are also uncommitted in the tree but were NOT touched by this session — unrelated concurrent work, not catalogued here.


## 2026-07-23 — agent-tree doc: filled in the "guard" node `[chore]`
- **What:** User asked what "guard" meant in the turn-loop node's one-liner (Load row → guard → one LLM call → dispatch). Explained the three early-exit checks (row status='running', cancel_requested, turn ceiling) as a guard-clause pattern, then added that detail into the "What does one turn of the loop actually look like?" node in AgentTree.tsx: a new body paragraph naming the pattern + a new leaf child for the one guard (ownership/'running' check) that had no existing child node. tsc + dev-server compile verified.
- **Files/commits:** apps/web/src/pages/docs/AgentTree.tsx. Uncommitted (small follow-up to commit 39f12a3).
- **PM impact:** none.


## 2026-07-23 — /docs pipeline converted to MDX + the tree report ported in as a page `[ship]`
- **What:** Swapped the /docs store's rendering pipeline from react-markdown (runtime string parsing) to @mdx-js/rollup (build-time compile) — mdx plugin wired into vite.config.ts ahead of the React plugins, all 4 docs renamed .md→.mdx, registry.ts now imports compiled components instead of raw strings, Markdown.tsx→MdxContent.tsx supplies the same mermaid-fence/internal-link overrides via MDXProvider. Verified: tsc clean, production build clean, eslint clean, dev server confirmed live-compiling via curl, and a scratch file proved raw HTML (`<details>/<summary>`) now survives untouched — the actual reason for the switch. Then cashed that in immediately: ported the standalone `doc_1784810600000_agent_tree.html` (collapsible Q&A tree of the agent architecture) into `/docs/agent-tree` — extracted the body markup + CSS into a new `AgentTree.tsx` component (scoped styles, real onClick handlers replacing inline `onclick=`, `.dark`-class dark mode instead of prefers-color-scheme, `not-prose` to escape Tailwind Typography), with a thin `agent-tree.mdx` wrapper.
- **Files/commits:** apps/web/vite.config.ts, apps/web/src/vite-env.d.ts, apps/web/src/pages/docs/{registry.ts,DocsPage.tsx,MdxContent.tsx (was Markdown.tsx),AgentTree.tsx (new)}, apps/web/src/pages/docs/content/*.mdx (renamed + agent-tree.mdx new), apps/web/package.json (+@mdx-js/rollup, +@mdx-js/react). Uncommitted.
- **PM impact:** none (infra/tooling + docs content, not a roadmap item).


## 2026-07-23 — Fractal Q&A tree report of the agent `[chore]`
- **What:** Collapsible self-similar tree report (HTML, details/summary) of the agent architecture: each node = one level's understanding + the questions it raises; children answer them. Read to any depth → coherent picture at that altitude. Standalone file (docs renderer strips raw HTML, so not a /docs page).
- **Files/commits:** doc_1784810600000_agent_tree.html (root, untracked by convention).
- **PM impact:** none.


## 2026-07-23 — /docs page: "Inside the Agent — a Builder's Tour" `[chore]`
- **What:** New in-product docs page (`/docs/agent-internals`, "Under the hood") documenting the book-agent purely as an agent-engineering artifact — durable-row loop, terminal-vs-non-terminal tools, staged proposals, context assembly (cache prefix discipline, digest+drill-down, intent hydration, skills), auto-mode distributed loop, anti-stall backstops — story domain abstracted away. Companion to the user-facing /docs/the-agent; grounded in book-agent/* + docs/agent-runtime-architecture.md.
- **Files/commits:** apps/web/src/pages/docs/content/agent-internals.md (new), apps/web/src/pages/docs/registry.ts (uncommitted).
- **PM impact:** none.

## 2026-07-23 — Headless short-story build + real-engine eval (book 1275) `[wip]`
- **What:** Drove a COMPLETE short story down the whole DNA ladder with NO UI, via the bridge (`runDnaExpand` → free `claude -p`). New driver builds every rung + fills the gaps the bridge lacks: minted game-twin meters (replicated pure `gameTwins`) + 2 shape meters w/ target curves, all foundations (cast/world/relationships/set-pieces/voice/games), acts/threads/global beat-sheet/22 scenes, then prose for all 22 (18.6k words). New eval runs the app's OWN `novelDna.ts` (`validate`/`analysisText`/`openObligations`) under tsx against the live tree + observed-meter read + assembled manuscript + editor's-read against the fiction rubric. Structure graded strong: pacing 27/50/77/100% vs 25/50/75/90%, closed causal DAG, 6/6 registry threads paid. Both the DNA lints AND the human read converged on the SAME defect: redundancy — climax rendered 3× + midpoint discovery 4–5× (prose_echo fired 60+; mystery-meter never resolved). Verdict: exceptional prose/premise, over-written (19k vs 5k brief) → compress not reconceive.
- **Files/commits:** NEW `scripts/dna-short-story.mjs`, `scripts/dna-short-story-eval.mts`; `scripts/eval-bridge.mjs` (+1 export: `runReadMeters`); `doc_1784796988488.md`; `reports/1275-goodbye-machine-read.md` + `reports/1275-read.json`. No commits. Book 1275 (dev). `[[project_novel_dna]]` `[[project_dna_meters]]` `[[project_dna_verify_layer]]` `[[eval-bridge is NOT the dev path]]`.
- **PM impact:** none (exploratory, local scripts + dev book — no prod code). Latent M1 relevance: proves a repeatable headless "build + grade a whole book" harness (the golden-book regression path named in the 2026-07-23 chore entry) — AND that the automated DNA verify-layer and a full human rubric read land on the same top defect, which is real evidence the lints track quality. Fidelity caveat: bridge ≠ prod (DeepSeek) engine, so grades/costs are indicative only.

## 2026-07-23 — Academic framing: how pensive benefits from agent hardening + evals `[chore]`
- **What:** Conceptual Q&A (no code). Mapped agent-hardening (constrained action space=validateOps, grounding=ledger, reliability=durable tasks) and agent-evals (outcome=rubric, trajectory=ai_call_evals/read-round-trips, inline critics=verify lints) onto existing machinery. Key gap named: no golden-book **regression suite** — the thing that would de-risk the DeepSeek provider switch.
- **Files/commits:** `doc_1784794417663.md` + `learning_*` (both gitignored, unstaged). No code touched.
- **PM impact:** none — analysis only. Latent connection to Now#1 (the read-round-trip evidence gate is a trajectory-eval metric) if a regression harness is later scoped.

## 2026-07-20 — Fixed mobile-only Google sign-in (PKCE double-exchange) `[wip]`
- **What:** Found the real root cause of `AuthPKCECodeVerifierMissingError` (supersedes the earlier panic-clear hypothesis below — that was wrong). Console trace shows mobile bounces the OAuth `code` through the site root (`/?code=`) before `/auth/callback`. At root, `@supabase/ssr`'s default `detectSessionInUrl` auto-fires the PKCE `/token` exchange, consuming the single-use code and deleting the `-code-verifier` cookie — so the explicit `exchangeCodeForSession` in `Auth.tsx` finds no verifier. Fix = make the explicit callback handler the *sole* exchanger: `detectSessionInUrl:false` in the client, and route root `?code=`/`?error=` into `/auth/callback` via SPA nav (preserves the verifier cookie) instead of bouncing to marketing. Typechecks clean; not yet committed/deployed/verified on device.
- **Files/commits:** `apps/web/src/integrations/supabase/client.ts` (detectSessionInUrl:false), `apps/web/src/components/IndexRoute.tsx` (forward code/error to callback). No commits. `[[project_supabase_auth_gotchas]]`.
- **PM impact:** none — not M1/GTM Now work; verify on mobile + strip AUTH-DEBUG diagnostics as follow-up. Also worth confirming Supabase Redirect URLs allowlist includes `/auth/callback` (so mobile stops falling back to root at the source).

## 2026-07-20 — Diagnosed mobile-only Google sign-in failure (AuthPKCECodeVerifierMissingError) `[wip]`
- **What:** User reported Google sign-in fails on mobile only with `AuthPKCECodeVerifierMissingError`. Traced through `client.ts`'s cookie-based Supabase auth setup and `Auth.tsx`'s callback handler; ruled out double-mount/viewport branching/One Tap (none exist). Leading hypothesis: the `panicClearAuthCookies()` circuit breaker (built for the earlier "Invalid Refresh Token: Already Used" storm) also deletes the PKCE `-code-verifier` cookie whenever any refresh-token call 400s/401s — a stale mobile session's auto-refresh can race the callback's `exchangeCodeForSession`, and the breaker's cleanup wipes the verifier out from under it. No code changed — asked user to confirm via a console check (`panic-clear executed` log between the exchange call and the error) before scoping the breaker to spare the verifier cookie.
- **Files/commits:** investigated `apps/web/src/integrations/supabase/client.ts`, `apps/web/src/pages/auth/Auth.tsx`. No commits. Wrote `doc_1784553716619.md` (full diagnosis) — not staged.
- **PM impact:** none yet — fix pending user confirmation of the hypothesis.

## 2026-07-18 — stream-prose moved off Vercel to a Supabase edge fn (Hobby maxDuration build failure) `[ship]`
- **What:** The push above triggered a Vercel build failure: `api/stream-prose`'s `maxDuration: 300` exceeds Hobby plan's 60s cap. That 300s was deliberate (escapes the ~150s Supabase free-plan worker ceiling that used to kill ~54% of prose calls) — dropping it to 60 would reopen the original problem, and we're not upgrading the Vercel plan. Since the Supabase project IS on a paid plan, moved the whole proxy there instead: new `supabase/functions/stream-prose/index.ts` ports `_proseProxy.ts`'s provider-routing/SSE-parsing/heartbeat logic to Deno (reusing `_shared/llm.ts`'s `resolveRoute` instead of duplicating the provider tables), authenticates via `_shared/task.ts`'s `userClient().auth.getUser()`. Client (`dnaExpand.ts` streamText) now fetches the edge function URL directly (new `functionUrl()` helper in `localFn.ts`, new exported `SUPABASE_ANON_KEY` for the required `apikey` header) instead of same-origin `/api/stream-prose`. Deleted the now-dead Vercel proxy (`api/stream-prose.ts`, `api/_proseProxy.ts`, `vite-plugin-stream-prose.ts` + its vite.config.ts wiring). Deployed `stream-prose`+`dna-expand`; smoke-tested the auth gate (401 on no token, confirms clean boot). Full authenticated live-generation run NOT yet exercised (needs login + real API spend) — flagged to the user, not run this session.
- **Files/commits:** supabase/functions/stream-prose/index.ts (new), supabase/config.toml, supabase/functions/dna-expand/index.ts (comments only), apps/web/src/features/dna/lib/dnaExpand.ts, apps/web/src/lib/localFn.ts, apps/web/src/integrations/supabase/client.ts, apps/web/vite.config.ts, deleted apps/web/api/{stream-prose,_proseProxy}.ts + apps/web/vite-plugin-stream-prose.ts. Uncommitted as of this entry.
- **PM impact:** none beyond unblocking the Vercel build; no priority/scope change. Worth a STATE.md/DECISIONS.md note if the live-generation re-test (Now item #1) surfaces a problem with this path — flag then, not now.

## 2026-07-18 — Committed jump-to-picker + new /docs page; pushed branch `[ship]`
- **What:** Closed out the 2026-07-15 "uncommitted" jump-to-node card (staged-options step in AgentRail now clickable, reveals target node in tree) — verified it was still the working tree's uncommitted diff, committed it. Also picked up a separate uncommitted addition: a public `/docs` + `/docs/:slug` route (`apps/web/src/pages/docs/`: DocsPage, Markdown, Mermaid renderer, content registry, 3 markdown pages) wired into App.tsx. Branch was already even with `origin/main` (no merge needed). Pre-push typecheck/tests/lint all passed; pushed `feat/story-craft-research`.
- **Files/commits:** b13a581 "Add /docs route and jump-to-node from staged-options steps" — apps/web/src/App.tsx, features/dna/{components/AgentRail.tsx, components/agentRail/StepBubble.tsx, lib/agentThread.ts, pages/DnaTreePage.tsx}, supabase/functions/book-agent/{advance,proposals}.ts, apps/web/src/pages/docs/** (new).
- **PM impact:** none beyond closing the prior ship's "uncommitted" caveat — no priority/scope change.

## 2026-07-15 — AgentRail "Staged options" → clickable jump-to-picker `[ship]`
- **What:** The propose_options step said "Staged N options … in the tree" — a passive reference to another surface; author had to hunt for the picker. Fixed the locus-of-attention mismatch: the plan step now carries the target `nodeId` and renders as a clickable card that reveals+scrolls to that node's picker (reuses existing `jumpTo`). Copy → "N options ready for … — tap to pick one in the tree." Edge fn deployed; web client needs rebuild for the card to render.
- **Files/commits:** supabase/functions/book-agent/{proposals,advance}.ts (proposeOptions returns nodeId; step carries it), apps/web/src/features/dna/lib/agentThread.ts (AgentStep.nodeId), components/agentRail/StepBubble.tsx (jump card), components/AgentRail.tsx + pages/DnaTreePage.tsx (onJump=jumpTo). Uncommitted.
- **PM impact:** none — UX polish on the shipped AgentRail; no Now-slot/roadmap change.

## 2026-07-15 — RAG-in-the-agent teaching/analysis `[chore]`
- **What:** Teaching Q&A on how best to implement RAG in book-agent. Conclusion: don't RAG the book's own DNA (fits the window, hot mutating corpus, addressed by known handle → `read_node`+`search_nodes` already win); the only corpus passing the 3-part test is open-world craft/genre reference, where `research_web`+`craft_notes` is already agentic RAG *missing a persistent index*. Sketched the minimum fill: `craft_chunks` (pgvector already enabled) + `gte-small` embed on research ingest + a `search_craft` tool. No product code changed.
- **Files/commits:** doc_1784114270000.md, learning_1784114270000_rag-in-agent.md (both local-only, unstaged).
- **PM impact:** none — analysis only; the `search_craft`/`craft_chunks` build is a candidate, not ratified.

## 2026-07-15 — In-product /docs documentation store (MVP) `[ship]`
- **What:** Shipped a browsable, public `/docs` route in the web app — a stakeholder-facing documentation store explaining how the product works. Sidebar + index + per-doc pages; markdown rendered by react-markdown+remark-gfm with a custom ```mermaid fence → lazy mermaid renderer (diagrams follow light/dark). Seeded 3 docs authored from NORTH_STAR: overview (the pitch), how-it-works (DNA method), the-agent (AI editor). Content is plain `.md` imported via Vite `?raw` + a hand-maintained registry, so adding a doc = drop a file + one row. Verified: tsc clean, prod build (mermaid code-split into lazy chunks), dev-server module transforms + `/docs` 200.
- **Files:** `apps/web/src/pages/docs/` (DocsPage, Markdown, Mermaid, registry + content/*.md), `apps/web/src/App.tsx` (routes), `apps/web/package.json`+`pnpm-lock.yaml` (mermaid).
- **PM impact:** DECISIONS line added (markdown-over-MDX for MVP; docs store as a public in-product route). Not a ranked Now project — net-new author-directed surface; left roadmap ranking untouched.

## 2026-07-15 — Agent architecture diagram doc `[chore]`
- **What:** Added a diagram-first doc mapping the book-agent runtime (7 mermaid diagrams: whole-system, entry paths, durable loop, tool dispatch, context assembly, row state machine, proposal channel). Companion to agent-runtime-architecture.md; grounded in the current book-agent source.
- **Files:** `docs/agent-architecture-diagram.md` (new).
- **PM impact:** none (documentation only).

## 2026-07-15 — Story-craft web research: B (precompute→craft_notes) + A (inline agent tool) `[wip]`
- **What:** Built + deployed a web-research capability for the DNA engine. Shared core
  (`_shared/research.ts`) = one Anthropic `web_search` server-tool call (`web_search_20260209`, GA/no beta
  header) that distills the web to a few concrete craft constraints; pinned to `claude-opus-4-8` so it routes
  to Anthropic passthrough even while the tier is DeepSeek (server tools don't survive the OpenAI-conversion
  path). No new key — ANTHROPIC_API_KEY already present. **B** = `dna-research` fn → writes `books.craft_notes`
  (precompute, out of the hot path). Activated the **dormant** `craft_notes` column (existed since 2026-06-18,
  injected nowhere) by adding a `<craft_notes>` anchor block to `book-agent/context.ts`. **A** = `research_web`
  read-class tool in book-agent that researches mid-turn AND persists to the same store, so A/B converge.
  Distillation gate is the point — raw "how-to" SEO results poison prose; prompt reframes to reference/comps.
- **Files:** `supabase/functions/_shared/research.ts` (new), `dna-research/index.ts` (new),
  `book-agent/{tools,exec-tools,context}.ts` (modified). Deployed: `dna-research` + `book-agent`. No migration
  (column pre-existed). Typechecks clean (only pre-existing `EdgeRuntime` ambient noise in `task.ts`).
  Design/learning: `doc_1784114198000.md`, `learning_1784114198000_research-agent.md`.
- **PM impact:** none yet — NOT live-verified (web_search call bills + needs a book/JWT) and no client UI for B.
  Adjacent to M1 (build quality) but a new capability, not on a Now slot. Remaining: (1) live smoke test,
  (2) tree-editor "Research" button + editable craft_notes field, (3) optional craft_notes into dna-expand prose.

## 2026-07-15 — One-command local claude-local bridge restart `[chore]`
- **What:** Diagnosed a `book-agent 503` in dev — Supabase stack was up but the `functions serve`
  edge-runtime container had died, so Kong had no upstream (`.env.local` points the client's local
  book-agent URL at it). Built a quick-access script that fully restarts the bridge (claude-local
  -shim :8788 + `supabase functions serve`), preflights the stack/env, and health-gates on a real
  HTTP reply (≠503/502/000). Verified end-to-end: 503→502→401.
- **Files/commits:** `scripts/restart-local-bridge.sh` (new), `package.json` (`bridge:restart`). Uncommitted.
- **PM impact:** none (dev tooling).

## 2026-07-15 — Design chat: story-craft research agent (RAG into craft_notes) `[wip]`
- **What:** Explored giving the DNA agent a web-research capability (e.g. "how to write a vampire hook").
  Recommended shape: a `dna-research` pass (precompute, not inline hot-path) that fan-out-searches, distills to
  a few concrete constraints/comps, and writes to `books.craft_notes` (tier-2) as an editable proposal in the
  agent rail. Key risk surfaced: generic "how-to" SEO sludge poisons generation → reframe queries toward
  reference/genre material + a distillation/source-ranking gate (reuse deep-research pattern). No code written.
- **Files/commits:** none (conversation only; pre-existing uncommitted tree changes are unrelated).
- **PM impact:** none — not ratified; parked as an idea pending author go-ahead to wire against the tool loop.

## 2026-07-15 — Seam contract shipped + book 1250 continuity repaired `[ship]`
- **What:** Implemented #1+#2 of the seam-contract fix (prior session's decision) and applied it to a live
  book. Generation now carries a per-scene `link` (continuous | cut | same_moment_new_pov) on the sketch and
  injects a SEAM block into prose gen — the previous scene's exit text + a link-specific instruction to move
  the story FORWARD from it (bridge a cut, never silently drop a charged open moment). Retagged `<previous_page>`
  to voice-only so anti-echo no longer masquerades as anti-continuity. Then repaired book 1250: an LLM seam-scan
  over all 28 scene seams found 8 sev-2 dropped-thread breaks (+ the reported 10→11); regenerated each affected
  scene through the fixed engine. Re-scan: **0 sev-2 breaks remain** (down from 9). e.g. scene 5 now opens
  "…not the joke. It was the fact that she hadn't laughed" — paying off scene 4's "sound of a woman not laughing".
- **Finding (→ DECISIONS):** DeepSeek (chat AND reasoner) *ignores* the SEAM=CUT bridge instruction that Claude
  obeys on the identical prompt. All 9 successful bridges were Claude (claude-local shim). The active prod tier
  is deepseek — so the seam fix underdelivers on the shipped model until the instruction is hardened.
- **Files:** `supabase/functions/dna-expand/index.ts` (seam block + helpers + prompt), both twins
  `_shared/novel-dna.ts` & `features/dna/lib/novelDna.ts` (`SceneLink` type), `dnaSchema.ts` +
  regenerated `_shared/dna-schema.json`; deployed. Book 1250 = DB-only content regen (no repo change).
  Design record: `doc_1784059899060.md`.
- **PM impact:** DECISIONS updated (seam contract ratified #1+#2 → shipped; + new DeepSeek-obedience finding).
## 2026-07-15 — Inline named scene prose in agent intent hydration `[ship]`
- **What:** Agent felt slow because a "look at scene N" ask (continuity/wording) hydrated the named scene's PLAN but stripped prose, forcing an extra `read_node` turn — a whole self-chain link (row write + cold reinvoke + full prefill) — before it could answer. `context.ts` intent hydration now inlines named scenes' prose (bounded: ~1200w whole, longer keeps head+tail for the continuity seam), collapsing that ask class from two turns to one. Deno-checked, deployed.
- **Files/commits:** `supabase/functions/book-agent/context.ts` (1511b86).
- **PM impact:** none — a latency refinement inside the shipped agent rail; no project-row/roadmap change (adjacent to the Now #1 read-round-trip evidence gate but not that work).
## 2026-07-15 — Cross-scene continuity: diagnosed the "seam contract" gap `[decision]`
- **What:** Investigated reported continuity loss between scenes on book 1250. Traced two failure modes to
  one root cause — the prose writer's only cross-scene signal (`buildProseDigest`, `dna-expand/index.ts:218`)
  fuses *don't reuse the WORDS* with *don't continue the STORY* into one voice-only `<previous_page>` tag.
  That conflation produces both **dropped cliffhangers** (scene 10→11: charged door-close never paid off)
  and **re-narrated overlaps** (scene 27→28: same hand-clasp rendered twice). No node computes/enforces the
  scene-seam invariant — continuity is a cross-node property but every constraint is intra-node.
  Proposed a 3-layer "seam contract" fix (prose-prompt split · sketch `link` type threading exit→opening ·
  deterministic seam lint). Not yet implemented — awaiting scope decision (#1 alone vs #1+#2).
- **Files/commits:** `doc_1784059899060.md` (diagnosis + fix design). No code changed.
- **PM impact:** DECISIONS.md (root-cause + proposed direction recorded); no ROADMAP re-rank (M1 build quality).

## 2026-07-14 — `KIND_STAGE` node→stage map added to `dnaJourney.ts` `[wip]`
- **What:** A `KIND_STAGE: Record<NodeKind, StageKey>` map landed in `dnaJourney.ts` (12 lines) — one lookup from a node kind to the stage/surface that edits it, so reports (issues/obligations/lints) can turn a node id into a jump-link. This change appeared mid-session from outside this conversation (likely a concurrent session also working the DNA feature) — cataloguing it as observed, not authored here.
- **Files/commits:** `apps/web/src/features/dna/lib/dnaJourney.ts` (uncommitted).
- **PM impact:** none — no context on completion status; flagging as wip pending its own session's wrap-up.

## 2026-07-14 — `/books/dna/new`: name-only book creation `[ship]`
- **What:** Added a fast path into the DNA studio — asks for just a book name, inserts the row (`brief: {}`, everything else defaults), and navigates straight to `/books/{id}/dna/tree`, which self-bootstraps its root `book_nodes` via existing `ensureSeed` on first load. No cover/subtitle/author step; the full `/books/new` flow is untouched for that.
- **Verified:** `tsc -p tsconfig.app.json` clean; dev server confirms the route resolves (200). Live browser click-through was skipped — the shared chrome-devtools-mcp profile was locked by other concurrent sessions.
- **Files/commits:** `apps/web/src/features/dna/pages/DnaNewBookPage.tsx` (new), `apps/web/src/App.tsx` (route registered above `/books/:bookSlug`) — both uncommitted.
- **PM impact:** none — small UX addition, not a Now-slot item.

## 2026-07-14 — Analytics tab split off Overview `[ship]`
- **What:** Lifted the read-only ANALYTIC projections (census/shape/story-map/promises) out of `DnaOverview` into a new `components/tree/analyticsPanels.tsx`, so `DnaOverview` stays the ACTIONABLE half (next move · threads · issues · navigable tree) and the `analytics` tab becomes the one place to comprehend the whole book. `FEATURE.md` updated to match.
- **Files/commits:** `apps/web/src/features/dna/components/tree/analyticsPanels.tsx` (new), `apps/web/src/features/dna/components/DnaOverview.tsx`, `apps/web/src/features/dna/pages/DnaTreePage.tsx`, `apps/web/src/features/dna/FEATURE.md` (all uncommitted).
- **PM impact:** none — internal tree UI reorganization, not a Now-slot item.

## 2026-07-14 — Frontier engine design: options, not one next step `[wip]`
- **What:** Design session on the guidance layer's core flaw: `currentObjective` is a serial single-anchor scheduler, but the tree's true state is a *frontier* — the set of all legal advancing moves (fill leaf, add children, expand act/beat, prose scene, settle promise, deepen pillar). Proposed `frontier(nodes,brief)→Move[]` (pure, twinned) + `rank(moves,mode)` policy layer — the agent's two modes (fulfill user objective vs drive to completion) become two policies over one mechanism; completion = zero required moves. Confirmed the count-based done-gate bug: `stageComplete.scenes = scenes.length>=1`, so beats with no scenes are invisible to "prose complete" — `stageProgress` already computes the coverage chain but was never wired into the gates. 3-phase migration sketched (frontier read-only + dev pane → objective rides it → `<available_moves>` injection + options UI).
- **Files/commits:** `doc_1784029961843.md` (design doc, uncommitted); no code changed.
- **PM impact:** none yet — awaiting author's go on Phase 1.

## 2026-07-14 — Vision panel: the interview gets a read/edit surface `[ship]`
- **What:** Closes the write-only gap found earlier today. `brief.vision` (the interview's capture) now renders in the tree as a collapsible `VISION — THE INTERVIEW` section under the brief origin — all 8 sections, each inline-editable, with a status line (`6 of 8 sections · compiled 7/14/2026`) and a `vision ✓` marker in the collapsed brief summary so it stays discoverable on a past-premise book. Edits merge section-wise (same shape as the agent's `update_vision`), so a hand edit and an agent capture are indistinguishable downstream; `compiled_at`/`skipped` are shown as status, never edited. Presentation-only — no schema, no edge fn, no new fetch (the brief was already Realtime-subscribed).
- **Verified:** typecheck clean (`tsc -p tsconfig.app.json`); driven live in Chrome on book 1257 — vision renders with all 6 captured sections; hand-edited an empty section and confirmed the write round-tripped to `books.brief.vision` in the DB with `compiled_at` + sibling sections preserved. Test edit reverted afterward.
- **Files/commits:** `apps/web/src/features/dna/components/tree/BriefSection.tsx` (uncommitted).
- **PM impact:** none — a UX gap fix, not a Now-slot item; M1 priorities unchanged.

## 2026-07-14 — Interview vision is write-only: saved but never surfaced `[wip]`
- **What:** Investigated "where did the interview answers go?" on book 1257. They ARE saved — `books.brief.vision` is fully populated and compiled (`compiled_at 2026-07-14T07:58Z`: characters, world_setting, plot_points, influences, open_questions, notes). The write path (agent `update_vision`) works. The gap is presentation: `brief.vision` is consumed only as the journey done-gate (`dnaJourney.ts`) and as prompt context (`_shared/brief.ts` `opts.vision`), while the visible brief panel `BriefSection.tsx` renders only the 7 structured fields (idea/genre/audience/tone/success_criteria/word_target/content_type) and has no `vision` branch. So the interview is a write-only artifact from the author's POV. Fix is small + additive: a read/edit block for `brief.vision` under `BriefOrigin`. No code changed this session.
- **Files/commits:** none (investigation). Relevant: `apps/web/src/features/dna/components/tree/BriefSection.tsx`, `apps/web/src/features/dna/lib/dnaJourney.ts`, `supabase/functions/_shared/brief.ts`, `supabase/functions/book-agent/exec-tools.ts`.
- **PM impact:** none (wip — finding recorded, fix not yet built or scheduled).

## 2026-07-14 — Paginated admin AI Calls table `[chore]`
- **What:** `/admin/ai-calls` was a flat "latest 200" list with client-side fn filtering. Switched to server-side pagination (50/page, `range()`+`count:"exact"`), moved fn filter into the query (was silently only filtering whatever 200 rows happened to be loaded), added Prev/Next controls, and scoped the evals fetch to just the visible page's call ids instead of a flat recent-400 guess. Verified live in Chrome: paging and fn-filter+paging compose correctly (e.g. `dna-expand-stream` → 246 rows / 5 pages).
- **Files/commits:** `apps/web/src/pages/admin/AiCalls.tsx` (uncommitted).
- **PM impact:** none — internal admin/debug tool, not roadmap-tracked.

## 2026-07-14 — Explained seed/premise separation in the DNA tree `[chore]`
- **What:** User asked why the SEED node only has `logline` and why it isn't merged with premise. Answered from `docs/dna/01-seed-premise.md`: seed.logline (concrete: protagonist/inciting/goal/obstacle/stakes) and premise.dramatic_question (deliberately wider) are different resolution-ladder rungs with separate accept/lock checkpoints (`dnaJourney.ts` derived state machine gates premise on seedDone) — merging would collapse two jobs into one field and lose the staged handoff. No code changed.
- **Files/commits:** none (docs read only); wrote `doc_1784013394436.md` (explanation) and `learning_1784013394436_seed-premise-merge.md` (gitignored) to the repo root.
- **PM impact:** none.

## 2026-07-14 — Merged `feat/ai-provider-switch` to `main` and pushed `[ship]`
- **What:** Landed the branch: DeepSeek provider switch, claude-local shim extended to structure/prose roles (closes the wip below), vision→structure agent work, and the interview-first guidance system — 6 commits, no conflicts. Working tree had pending edits from the prior wip entry; committed those first (`0413327`), fast-forwarded local `main` to `origin/main` (was 46 behind), merged `--no-ff` (`4cf4ba6`), pre-push typecheck/tests/lint all passed, pushed to `origin/main`.
- **Files/commits:** merge commit `4cf4ba6` (47 files); pre-merge commit `0413327` on the feature branch. `feat/ai-provider-switch` now fully in `main`.
- **PM impact:** none beyond closing out the wip below — no priority/roadmap change, just landing already-planned work. Noted in passing: another concurrent Claude Code session was live-editing `supabase/functions/book-agent/prompts.ts` during the merge; left untouched/uncommitted, flagged to the user.
## 2026-07-14 — Traced + removed orphaned scene-image/portrait edge fns behind stray `google/gemini-3-pro-image-preview` OpenRouter calls `[chore]`
- **What:** User saw a Gemini-3-Pro *image* model ("nano-banana-pro") in OpenRouter logs for a feature we no longer have. Traced it: the old scene-image / character-portrait stack (deleted from the repo in `1643c3c` on 2026-07-09) was **still ACTIVE on Supabase** — `generate-scene-image` (v38) + `generate-character-portrait` (v26), last deployed 2026-07-08. `git rm` deletes source but does NOT undeploy; the public fn URLs stayed live and any hit fired a billed Gemini image call. The `gemini-3 → google/gemini-3-pro-image-preview` map lived in the deleted `_shared/image.ts`. **Fixed:** `supabase functions delete`'d both (verified gone from `functions list`); stripped the dead image-look block from `apps/web/src/lib/foundations.ts` (`art_direction`/`art_theme`/`image_model` fields + `ART_THEMES`/`ArtTheme` + `IMAGE_MODEL_OPTIONS`/`ImageModelOption`/`DEFAULT_IMAGE_MODEL` — no consumers outside the file; `tsc -p tsconfig.app.json` clean).
- **Files/commits:** `apps/web/src/lib/foundations.ts` (uncommitted). Two Supabase fns undeployed (no repo change — already deleted in git).
- **PM impact:** none (chore). Lesson worth carrying: repo-delete of an edge fn ≠ undeploy — audit `functions list` vs the repo periodically for orphans.
## 2026-07-14 — Route the whole high tier (not just agent) to claude-local in local dev; fix 3 stacked sketch/prose bugs `[wip]`
- **What:** Driving scene sketch+prose gen on book 1250 surfaced `Sketch generation returned unparsable JSON`. Root-caused to THREE stacked bugs and fixed each: (1) **routing** — `resolveRoleModels` only defaulted the *agent* role to `claude-local` when the shim is up; `structure`/`prose` still hit the admin provider (DeepSeek), which bills reasoning inside `max_tokens` at default-high effort → the 1200-tok sketch was 100% reasoning, empty output, unparsable. Now all three high roles default to `claude-local` under `localBridgeUp` (per-role overrides still win); tests updated (12/12 pass). (2) **shim** — `claude-local-shim.mjs` demanded a `{tool}/{text}` envelope, but no-tools calls (sketch/prose) return raw domain JSON/prose. Now passes non-tool completions through verbatim as a text block; `buildUserPrompt` no longer tells no-tool calls to "follow the JSON reply format". (3) **prose streaming** — `_proseProxy.ts` had no `claude-local` route (would misroute to Anthropic); added a non-streaming shim branch. But the shim blocks ~74s with zero bytes and the browser's `streamText` aborts at 45s idle → every prose render got DISCARDED by auto-accept. Added 20s heartbeats while the shim runs. **Verified on 1250:** scene 9 sketch (call 9889), scene 8 sketch (9893), scene 8 prose (9908, 74.7s, 11.2k chars) all on `claude-local`. **Remaining:** persist scene 8/9 prose through the agent with the heartbeat fix live (browser extension dropped when Vite restarted for the proxy change — needs reconnect to finish); prose nodes not yet re-saved.
- **Files/commits:** `supabase/functions/_shared/model-config.ts` (+ `.test.ts`), `scripts/claude-local-shim.mjs`, `apps/web/api/_proseProxy.ts` (all uncommitted). Local-only `doc_1783962985209.md` + `nohup.out` untouched; pre-existing `scripts/dna-analyze-1171.mjs` deletion carried over, not mine.
- **PM impact:** none yet (wip). Flagged for a follow-up ROADMAP line: the SAME DeepSeek reasoning-truncation breaks sketch generation **in production** (localBridgeUp false → structure role = deepseek-v4-pro, 1200 tok, no effort cap) — every prod sketch currently returns unparsable JSON. User explicitly deferred the prod fix this session (chose "not now"); the local-dev routing was the chosen fix.
## 2026-07-13 — Diagnosed post-fix dna-expand 502; traced to digest-fold wall-clock, not the auth fix `[wip]`
- **What:** After the auth fix landed, user retried the render flow and hit a 502 (not 401) plus a burst of `claude exited 1` errors in the shim log. Diagnosed both from `docker logs supabase_edge_runtime_pensive-books`: (1) the `claude exited 1` burst coincided with the user's `/login` ("Remote Control disconnected") disrupting the shim's spawned `claude -p` auth state — transient, self-recovered (shim succeeding again by end of log). (2) The 502 is `dna-expand`'s prepare-mode continuity-digest fold (`FOLD_BUDGET_MS = 100_000`, per-prior-page, via DIGEST_MODEL/qwen) exceeding the LOCAL Docker edge-runtime's wall-clock limit before it can hand off to the off-worker `/api/stream-prose` path — unrelated to today's auth/JSON fixes. Each fold is persisted immediately (`authoring.prose_digest`) so retries warm the cache incrementally (3/7 → 4/7 pages observed) — recommended the user retry a few more times to let book 1250's digest fully warm rather than treating it as a new bug. No code changed this turn; also cleaned up a stray `nohup.out` left from an earlier `nohup node scripts/claude-local-shim.mjs` invocation.
- **Files/commits:** none (investigation only).
- **PM impact:** none yet — if the wall-clock ceiling turns out to be a recurring local-dev blocker (not just cold-cache latency), it'd be a follow-up worth a ROADMAP line; flagging here for now, not promoting.

## 2026-07-13 — Restarted claude-local-shim.mjs `[chore]`
- **What:** Killed and relaunched the local shim process (nohup, backgrounded) after user request; no code changes.
- **Files/commits:** none (process-only). Pre-existing uncommitted diff (`pm/WORKLOG.md`, deleted `scripts/dna-analyze-1171.mjs`) carried over from before this session, untouched.
- **PM impact:** none.

## 2026-07-13 — Committed the claude-local + local-dev-auth fixes `[chore]`
- **What:** Landed the three preceding entries' work (claude-local shim JSON-extraction fix, config.toml verify_jwt gap, 10-function userClient fix) in one commit. Left out `scripts/dna-analyze-1171.mjs` (pre-existing unrelated deletion) and the local-only `doc_*.md` ritual file.
- **Files/commits:** `b303b27` — "Fix claude-local tool-call parsing and local-dev auth for 10 edge functions".
- **PM impact:** none.

## 2026-07-13 — Fix root cause of dna-expand 401: 10 functions hand-rolled the wrong Supabase project `[chore]`
- **What:** The earlier config.toml `verify_jwt=false` fix (previous entry) got the request PAST the local gateway, but the user retried and still hit 401 — a second, deeper bug. `dna-expand` (and 9 siblings: `dna-chat`, `evaluate-ai-call`, `read-confusion/facts/logline/meters/premise/shape/synopsis`) each hand-built their own user-scoped Supabase client from the raw `Deno.env.get("SUPABASE_URL"/"SUPABASE_ANON_KEY")` — the platform-reserved vars, which are always the LOCAL project when running under `supabase start`. So `auth.getUser()` tried to validate the browser's HOSTED-project session JWT against the LOCAL project's auth server — always fails. `book-agent` already had this right: it uses `_shared/task.ts`'s `userClient()` helper, which resolves through `hostedEnv()` (honoring `LOCAL_DEV_HOSTED_SUPABASE_*` in `supabase/functions/.env`) to the SAME hosted project that minted the token. Switched all 10 functions to that shared helper, removed the now-unused direct `createClient` imports, verified `deno check`/`deno lint` clean (only pre-existing unrelated `EdgeRuntime` ambient-type noise), restarted the local stack. Awaiting the user's live retry to confirm end-to-end.
- **Files/commits:** `supabase/functions/{dna-expand,dna-chat,evaluate-ai-call,read-confusion,read-facts,read-logline,read-meters,read-premise,read-shape,read-synopsis}/index.ts` (uncommitted).
- **PM impact:** none — local-dev-only correctness bug, no roadmap/state change.

## 2026-07-13 — Fix local-dev 401s on dna-expand + 9 sibling functions `[chore]`
- **What:** Live repro while testing the claude-local fix: applying a dna-expand proposal in the browser threw "Couldn't apply — dna-expand 401." Root cause: `apps/web/src/lib/localFn.ts` (the VITE_LOCAL_FUNCTIONS_URL dev bridge) sends the app's session token — signed by the HOSTED/production project, since `integrations/supabase/client.ts` always points there — to the LOCAL edge gateway. Local Kong's default `verify_jwt=true` validates against the LOCAL JWT secret, which never matches a production-signed token, so it 401s before the function runs. `book-agent`/`dna-decompose` already solved this (gateway verify_jwt=false + the function's own getUser() against the hosted project via `_shared/task.ts` hostedEnv); `dna-expand` and 9 other functions the local bridge also redirects (`dna-chat`, `evaluate-ai-call`, `read-confusion/facts/logline/meters/premise/shape/synopsis`) were missing that same config.toml entry — a wiring gap from whenever they joined the bridge list, not a regression from today's work. Added `verify_jwt = false` for all 10, restarted the local stack, and confirmed via response-shape diff (Kong's `{"msg":"Error: Missing authorization header"}` vs. the function's own `{"error":"Unauthorized"}`) that dna-expand now reaches its own auth check instead of being gated at the gateway.
- **Files/commits:** `supabase/config.toml` (uncommitted).
- **PM impact:** none — local-dev-only config gap, no roadmap/state change.

## 2026-07-13 — Fix claude-local shim: raw tool-call JSON leaking into AgentRail chat `[chore]`
- **What:** User reported `propose_prose_render` (and presumably other) tool calls occasionally rendering as a literal wall of JSON in the chat instead of a proposal card, only on the `claude-local` tier. Root cause: `claude-local-shim.mjs`'s `extractEnvelope` used `indexOf("{")`/`lastIndexOf("}")` to scrape the prompted JSON tool-call envelope out of `claude -p`'s raw stdout; any narration the model appended after the JSON with its own stray `}` made `lastIndexOf` grab the wrong brace, the slice failed to parse, and `book-agent/advance.ts`'s "any text block is genuine narration" assumption (safe for native tool-calling providers, not safe for this prompted-JSON path) surfaced the raw JSON as a chat note. Replaced the naive match with a balanced-brace scanner (`extractBalancedObject`) that tracks nesting depth and ignores braces inside JSON string literals; verified against the failing case plus fenced/nested-brace cases with a standalone repro script.
- **Files/commits:** `scripts/claude-local-shim.mjs` (uncommitted); `doc_1783962985209.md` + `learning_1783962985209_claude-local-json-leak.md` (local-only, gitignored).
- **PM impact:** none — dev-tooling bugfix, no roadmap/state change.

## 2026-07-13 — Shipped Vision→Structure (all phases of docs/vision-to-structure.md) `[ship]`
- **What:** The vision now grounds the derivation engine and gets audited back. P1: `MeterKind` + `mystery`/`violence`/`levity` in both novelDna twins, dnaSchema select, `METER_KINDS` whitelist, dna-schema.json regenerated via its artifact lock. P2: all 4 `briefContext` calls in dna-expand gain `vision:true`; contract v2 prompt derives from BRIEF+MANDATE+VISION (vision outranks genre), two-source tentpoles with `source:"genre"|"vision"` provenance (post-parse default "genre"), 2–5 meters with vision-shaped target curves; client `contractDelta`/`persistContract`/ops-exit now carry full tentpole content objects (name+source — previously even `name` was dropped, only summary persisted); `source` registered in dnaSchema (genOnly select) so get_schema documents it and the tree editor renders it. P3: pillar/contract/cast/beats recipes appended with vision guidance (verbatim in both dna-journey twins); SYSTEM_THREAD's vision item now also teaches the living-document rule + audit_vision checkpoints. P4: new `_shared/vision-craft.ts` exporting `VISION_RUBRIC` (structural-carrier sufficiency test); `vision-fulfillment` skill embeds it; `audit_vision` non-terminal LLM-judge tool (tools.ts schema + exec-tools handler: vision sections vs a compact foundations/structure digest incl. per-tentpole PLACED/UNPLACED, meters' target-set flags; 120s signal, effort medium). P5: contract STEP_TEACH copy mentions the vision; meters page verified kind-agnostic. Gates: web tsc clean, full vitest 1227 passed/0 failed, parity+journey tests green, deno check clean (pre-existing EdgeRuntime noise only); `dna-expand` + `book-agent` deployed. Honest scope note: dna-expand's shared ctx also feeds its prose/sketch prepare path, so streamed prose prompts now carry the vision (within D1's ratified wording, flagged in the plan doc). NOT done: the live e2e exercise on a real book (interview → contract → audit) — flagged in the plan header.
- **Files/commits:** `supabase/functions/_shared/{novel-dna,agent-skills,vision-craft,dna-schema.json,dna-journey}.ts|.json`, `supabase/functions/dna-expand/index.ts`, `supabase/functions/book-agent/{tools,exec-tools,prompts}.ts`, `apps/web/src/features/dna/lib/{novelDna,dnaSchema,dnaExpand,dnaJourney}.ts`, `apps/web/src/features/dna/components/agentRail/journeyContent.ts`; uncommitted.
- **PM impact:** decision already in DECISIONS.md (prior entries); plan doc header flipped to IMPLEMENTED with the live-e2e gap named. STATE: rides the guidance-system line.

## 2026-07-13 — Shipped D9: state-injected vision-interview skill (fixes the mid-interview craft hole) `[ship]`
- **What:** Implemented + deployed Phase 3b of `docs/vision-to-structure.md` ahead of the rest of that plan because the hole was live: the shipped three-state injection omits the objective (and `STEP_RECIPE.interview` with it) on concrete messages — and an interview ANSWER is a concrete message — while its story nouns ("protagonist") tripped character-craft's node-editing playbook mid-interview. Added the `vision-interview` skill (elicitation funnel, capture-as-you-go, author's-words-first) to `agent-skills.ts`; in `threadSystem`, a `discovering` predicate (vision neither compiled nor skipped + building not started — mirrors the journey twins' interview gate incl. the widened grandfather) pins that skill every turn and suppresses ask-triggered skills. First STATE-injected skill — establishes the fourth skill channel (index · ask-triggered · objective-fallback · state-pinned). Verified via a mocked-threadSystem harness (4 cases: discovery injects interview + suppresses character-craft; compiled/skipped/grandfathered all restore ask-triggered skills — ALL PASS); `deno check` clean (pre-existing EdgeRuntime noise only); `book-agent` deployed.
- **Files/commits:** `supabase/functions/_shared/agent-skills.ts`, `supabase/functions/book-agent/context.ts`, `docs/vision-to-structure.md` (Phase 3b marked shipped); uncommitted.
- **PM impact:** none new — D9 was already promoted to DECISIONS in the prior entry; STATE unchanged (rides the guidance-system row).

## 2026-07-13 — Shipped the guidance system: interview-first discovery + three-state objective `[ship]`
- **What:** Implemented `docs/agent-guidance-system.md` end to end. The journey's premise stage now opens
  with an **Interview** rung (Interview → Seed → Premise) whose artifact is `books.brief.vision` (a jsonb
  section, no migration), written by a new **non-terminal, direct-write `update_vision` tool** — the first
  deliberate break from proposals-only, because it records the author's own words. `<current_objective>` is
  now injected in **three states**: omitted on a concrete typed ask (the intent-pollution fix), injected on
  the Next-nudge / an empty ask, and ALWAYS injected in auto mode (it's auto's work queue). The vision
  renders into the agent's `<brief>` only behind a new `briefContext` opt (`vision:true`), so every other
  prompt in the codebase stays byte-identical. Live-verified on a scratch book: interview asked, captured 5
  sections, compiled, journey advanced to Seed on its own, and the logline it then proposed carried the
  vision. Verified in `ai_calls` that all three injection states behave.
- **Scope change en route:** the plan's grandfather clause (`seedDone` ⇒ interview moot) was too narrow —
  a live drafted book (1235, 141 scenes) whose seed was never *accepted* regressed into an interview.
  Grandfather now keys on "any non-seed node exists" (a fresh book is minted with the seed alone).
- **Files:** `_shared/brief.ts` (+`BriefVision`/`VISION_SECTIONS`/`vision` opt), both dna-journey twins
  (+interview substep, `STEP_RECIPE.interview`, `brief` param), `book-agent/{context,tools,exec-tools,
  prompts}.ts`, `apps/web/src/lib/brief.ts`, `AgentRail.tsx`/`DnaOverview.tsx` (+skip affordance)/
  `TreeOverviewTab.tsx`/`DnaTreePage.tsx`/`journeyContent.ts`; parity + journey tests extended (751 green).
  `book-agent` deployed. Committed `f66c831` (bundled the concurrent D9 vision-interview follow-on,
  which had layered onto the same `context.ts`/`agent-skills.ts` and was inseparable; combined tree
  typechecks + journey/parity green before commit).
- **PM impact:** new STATE row (Agent section); DECISIONS amended with the grandfather widening.
## 2026-07-13 — Ratified + spec'd Vision→Structure (executable plan) `[decision]`
- **What:** Second guidance-system rung, decision-maker session (owner delegated choices). The vision now grounds the derivation ENGINE, not just the agent chat: every `briefContext` call in dna-expand gets `vision:true`; contract v2 compiles vision plot points into `source:"vision"` tentpoles (enforced free by the existing `tentpole_unplaced` lint) and derives 2–5 meters (palette + `mystery`/`violence`/`levity`; heat = sexual content with `content_type` as ceiling) with vision-shaped target curves; a new non-terminal `audit_vision` LLM-judge tool closes the loop at recipe checkpoints. No journey changes; recipes carry the nudging. Key planning discovery: the meter cascade (`target_drift`/`read_gap`/`targetGap`) already exists — the plan feeds it, doesn't rebuild it. 6 phases with gates, written for a smaller-model implementer.
- **Files/commits:** `docs/vision-to-structure.md` (new, uncommitted); promoted to `pm/DECISIONS.md`.
- **PM impact:** DECISIONS.md entry added. Implementation queued behind the guidance-system implementation; not slotted into Now (Now ≤ 2 holds).

## 2026-07-13 — Merged feat/ai-provider-switch to main; fixed the prod build break it exposed `[ship]`
- **What:** Executed the merge decided in the prior entry (one deployed SSOT instead of two divergent branches). Committed the incident-response fix (dna-chat restore + dna_chats migration), then pushed straight to `main` — the pre-push hook (typecheck+tests) caught 2 failures, traced to a concurrent session's uncommitted WIP polluting the shared working tree (not anything in the 73 commits being merged); verified clean via an isolated `git worktree` checkout of just the target commit. That surfaced one real pre-existing failure: `bookAgentDigestFields.test.ts` had a hardcoded path to `book-agent/index.ts`, broken since an earlier refactor moved `DIGEST_FIELDS` to `context.ts` — fixed the path rather than bypass the hook. Pushed clean (fast-forward, `main` now at the same commit as this branch). Immediately after, the user reported the actual production build error the stale `main` had been hiding: `api/stream-prose.ts` failing `TS2835` (relative import needs an explicit extension) — `apps/web`'s `"type": "module"` makes Vercel compile `api/*.ts` as native Node ESM (node16/nodenext resolution), which requires `.js` on relative specifiers even for `.ts` sources. This is very likely why production deploys had been erroring for 5+ days (unrelated to any of today's work — pre-existing on `main`, just never fixed since main wasn't being pushed to). One-line fix (`"./_proseProxy"` → `"./_proseProxy.js"`), verified clean typecheck, pushed the same isolated-worktree way.
- **Files/commits:** `1185604` (test path fix), `fdbede1` (stream-prose.ts fix) on `main` (= `feat/ai-provider-switch`). Also lands `99578e6` (dna-chat restore, already logged in the prior entry) since it rode the same push.
- **PM impact:** `main` and this branch are now identical — the branch-divergence root cause from the near-miss entry above is resolved. Open: confirm the next Vercel prod deploy actually goes green (not verified in-session — Vercel builds asynchronously); `dna_chats` recovery from backup still open.

## 2026-07-13 — Fixed: DNA→pages chaptering was per-beat, not per-act `[ship]`
- **What:** `renderPages` (novelDna.ts) was already correctly designed as section-per-chapter + one text page per beat + "***" scene breaks — but `realizeScenesFromBeat` (dnaExpand.ts) stamped `chapter_start` on EVERY beat's first scene (its `startPosition === 0` guard was dead: every caller always passed literal `0`), so every beat rendered as its own chapter instead of one section per act. Fixed by keying off `beatNode.position` (0-indexed per act already, via `persistBeatSheet`) instead of the unused `startPosition` param, and by sourcing the chapter title from the ACT's own `title` field (new `chapterTitleFromAct`) rather than the first beat's summary, since the chapter now represents an act. Verified: `tsc -p tsconfig.app.json --noEmit` clean; `vitest run dnaExpand.test.ts novelDna.parity.test.ts novelDna.test.ts` — 858/858 pass (3 new tests added covering act-boundary + no-op-for-non-first-beat + act-title-wins).
- **Files/commits:** `apps/web/src/features/dna/lib/dnaExpand.ts`, `apps/web/src/features/dna/lib/dnaExpand.test.ts` — uncommitted, not yet committed (user hasn't asked to commit).
- **PM impact:** STATE.md "Structure-as-render" row corrected (its "paginates by beat, not chapter" note described the bug, not the intent).

## 2026-07-13 — Near-miss: "zero callers" audit trusted the wrong branch; dna_chats data lost `[decision]`
- **What:** Continuing the eval-bridge dead-fn audit, discovered the real methodology gap: `main` (43 commits behind this branch) is what Vercel `pensive` actually deploys to production (confirmed via the `pensive-git-main-...` alias on the last successful prod deploy, 16 days old; several more recent prod deploy attempts have been erroring). My "zero live callers" check only grepped THIS branch's client code — but this branch has already deleted UI (`ladder.ts`, `revisionChat.ts`, `beatSheet.ts`) that unmerged `main` still ships. Checked actual `ai_calls` invocation timestamps (the real evidence, not static analysis) and found `dna-chat` was called 2026-07-10 and `revise-chat` as recently as 2026-07-11 22:08 — both real, multi-book traffic. Impact: `dna-chat` had already been deleted + undeployed in an earlier session-turn — **restored** (`git show` the last committed version, redeployed, confirmed ACTIVE again, version reset to 1). `revise-chat` was on the candidate list but not yet executed — caught in time, untouched. The `dna_chats` **table drop from the prior turn is NOT recoverable in place** — checked non-empty (15 rows) before dropping but never checked recency; given the 07-10 dna-chat calls, some rows were likely days old, not historical junk. PITR is disabled on this project (confirmed via `supabase backups list`); only daily logical backups exist, latest 2026-07-13 08:30 (this morning, likely pre-drop). Recovery requires the Supabase Dashboard's backup-restore flow to a NEW project (to avoid clobbering current data) — not attempted, handed to the author. Halted the remaining ~21-function audit entirely pending a corrected methodology (check `ai_calls` recency per candidate, not just branch-local grep). Root cause is being addressed separately: merging this branch to `main` so there's one deployed SSOT instead of two divergent realities.
- **Files/commits:** `supabase/functions/dna-chat/index.ts` restored + redeployed (uncommitted, version 1); `supabase/migrations/20260713180000_drop_dead_dna_chats.sql` (already applied, table gone — data loss risk, not reverted).
- **PM impact:** promoted to `pm/DECISIONS.md` (methodology lesson: verify against real invocation logs + the actually-deployed branch, not static grep on the branch in front of you). Open item for the author: recover `dna_chats` from the 07-13 08:30 backup or accept the loss.

## 2026-07-13 — Ratified + spec'd the guidance-system redesign (executable plan) `[decision]`
- **What:** Owner delegated the four open design decisions ("you are the decision maker"); all ratified with leans (vision at `books.brief.vision`, direct-write `update_vision` tool, visible+skippable Interview substep with grandfather clause, full objective omission on concrete asks — with an AUTO-mode exception added: auto always injects, the objective is its work queue). Wrote the executable plan for a smaller-model implementer: 6 phases with per-phase verification gates, verbatim `STEP_RECIPE.interview` + tool schema drafts, exact file paths, and a gotchas fence (twin parity, prompt byte-stability, non-terminal tool semantics, StepBubble rendering).
- **Files/commits:** `docs/agent-guidance-system.md` (new, uncommitted); promoted to `pm/DECISIONS.md`.
- **PM impact:** DECISIONS.md entry added. Implementation is a new work item — candidate for a Now slot after the live full-book build re-exercise; not slotted yet (Now ≤ 2 holds).

## 2026-07-13 — Guidance-system design session (interview-first agent rail) `[wip]`
- **What:** Design-only session, no code. Proposed the agent-rail guidance redesign: two axes (book REGIME: discovery vs build; turn INITIATIVE: author-led vs agent-led), an interview-first discovery phase capturing a structured vision doc at `books.brief.vision`, interview as a new premise-stage substep (Interview → Seed → Premise) with its own STEP_RECIPE + skill brief, three-state `<current_objective>` injection (omit on concrete ask · directive on Next-nudge/`context_follow_objective` · proactive interview opener on fresh discovery threads), and a direct-write `update_vision` tool. Four decisions pending author ratification (vision location, direct-write vs proposal, JourneyStrip visibility, full omission vs status line). Design doc in session scratchpad only (`doc_1783943126220.md`) until ratified.
- **Files/commits:** none (also in tree: `docs_12.txt` conversation export, untracked; `scripts/dna-analyze-1171.mjs` deletion from another session).
- **PM impact:** none yet — promote to `decision` + `docs/` spec once the author ratifies.

## 2026-07-13 — Deleted the dead dna-chat edge function (code + deploy) `[chore]`
- **What:** Follow-up to the eval-bridge cleanup: with `sendDnaMessage` and its `dna_chats` session wrapper already deleted client-side (zero callers), the `dna-chat` edge function itself was confirmed to have zero live callers anywhere too. Deleted `supabase/functions/dna-chat/index.ts` and ran `supabase functions delete dna-chat` — confirmed removed from the deployed project. Deliberately did NOT drop the `dna_chats` Postgres table: it holds 15 real rows (actual historical per-stage-chat conversations pre-dating the AgentRail pivot), checked via a direct REST count before touching anything. A table drop destroys data irreversibly where a code/deploy deletion is git-reversible, so that's parked pending the author's call (keep as inert dead weight, export-then-drop, or drop). Also surfaced, not investigated: ~20 other deployed edge fns (`beats-agent`, `revise-chat`, `revise-scaffold`, `objective-options`, `ai-run`, `spine-options`, `beat-to-objective`, `objectives-to-spine`, `revise-node`, `generate-voice`, `auto-revise`, `spine-to-objectives`, `beat-to-prose`, `revise-prose`, `revise-outline`, `objective-to-beat`, `prose-to-beat`, `brief-to-spine`, `revise-beats`, `generate-book`, `generate-page`, `build-revision`, `flesh-out-book`) look like the same class of Build-Studio-pivot leftover as dna-chat, from eyeballing `supabase functions list` — none individually verified for zero-callers yet; that's a real audit, not a hunch-based deletion.
- **Files/commits:** `supabase/functions/dna-chat/index.ts` deleted (uncommitted); Supabase deploy: `dna-chat` function deleted (live, not git-tracked). No DB migration.
- **PM impact:** none yet. Two open decisions for the author: (1) drop `dna_chats` table or leave it, (2) greenlight a full zero-caller audit across the ~20 other candidate fns.

## 2026-07-13 — Committed the objective-driven skill fallback fix `[chore]`
- **What:** Committed the change described in the entry immediately below (already deployed prior to this commit).
- **Files/commits:** `b365ac7` on `feat/ai-provider-switch` — same 9 files as the entry below. (`docs_12.txt`, an unrelated leftover terminal-transcript dump in the working tree, left untracked/uncommitted.)
- **PM impact:** none beyond what's already promoted to `pm/STATE.md`.

## 2026-07-13 — Gated objective-driven skill fallback behind the explicit "Next" click `[ship]`
- **What:** Shipped (supersedes the "in-progress"/wip entry immediately below, which undersold it as read-only — this session wrote and deployed the change). Root cause: server-side, `liveObjective` is recomputed fresh from the tree on EVERY turn regardless of what the client sends (by design, for auto-mode resume fidelity) — so `matchSkills`'s fallback (`askSkills.length ? askSkills : matchSkills(liveObjective)`) was injecting a playbook on essentially every turn where the ask's own text missed the trigger regexes, including free-typed messages unrelated to the guided flow. Fixed by threading an explicit signal end-to-end: the client's "Next" nudge click now passes `isNextStep: true` (`AgentRail.tsx` `send()`/`sendAgentMessage()`); the server persists it as `book_agent_runs.context_follow_objective` (new column, same per-turn-persisted pattern as `context_objective`/`context_auto` so it survives auto-mode's chain links); `context.ts`'s skill-match fallback now only fires when `followObjective` is true. A free-typed composer message that misses every trigger now gets NO skill brief (the agent can still self-serve via `read_skill`) instead of silently inheriting whatever the current guided-flow rung matches. Scope, per the author's explicit calls: auto-mode chain links are NOT exempted (they inherit whatever flag started that arc, same as manual mode); the `<current_objective>` prompt block itself stays unconditional — only the skill-brief fallback is gated. Migration applied (`supabase db push`) + `book-agent` redeployed (`supabase functions deploy`); not yet committed to git.
- **Files/commits:** uncommitted — `supabase/migrations/20260713165731_agent_runs_follow_objective.sql` (new), `supabase/functions/book-agent/{index,advance,context,shared}.ts`, `apps/web/src/features/dna/lib/agentThread.ts`, `apps/web/src/features/dna/components/AgentRail.tsx`.
- **PM impact:** promoted to `pm/STATE.md` under "Agent instruction-following (task anchor + intent hydration)".

## 2026-07-13 — In-progress: `context_follow_objective` threading (agent_runs_follow_objective) `[wip]`
- **What:** Uncommitted, in-progress feature: thread a new `book_agent_runs.context_follow_objective` column end-to-end so the client can signal "this turn was explicitly started by the Next-objective nudge" vs a free-typed ask. In `context.ts`'s `threadSystem`, this gates whether skill-brief matching falls back to the live objective's text when the author's ask itself doesn't hit a skill trigger — narrower than "does the agent follow the objective," it's specifically about which skill playbook gets pre-injected. This session did no code changes — only read/explained the existing diff (advance.ts/context.ts dispatch + prompt-assembly logic) in answer to a question; wrote local, gitignored `learning_*`/scratchpad docs only.
- **Files/commits:** uncommitted — `supabase/functions/book-agent/{advance,context,index,shared}.ts`, `apps/web/src/features/dna/{components/AgentRail.tsx,lib/agentThread.ts}`, new migration `supabase/migrations/20260713165731_agent_runs_follow_objective.sql`.
- **PM impact:** none yet — flagging so this in-progress diff doesn't sit uncatalogued; promote on commit/ship.

## 2026-07-13 — Reverted the NodeGroup shaded-band tweak `[chore]`
- **What:** User asked to revert the prior "shaded band + top rule" styling on the DNA tree's `NodeGroup` header (bb44a4a). Reverted via `git revert`.
- **Files/commits:** `apps/web/src/features/dna/components/tree/Subtree.tsx`.
- **PM impact:** none — visual polish only, now undone.

## 2026-07-13 — Made eval-bridge redundant for the web app; killed the dead dna-chat client `[chore]`
- **What:** Investigated whether `scripts/eval-bridge.mjs` (the browser's dev-only Claude-Code-as-backend bypass) could be retired in favor of the claude-local shim, since the shim rides the REAL edge functions instead of a hand-maintained reimplementation. Built it: `apps/web/src/lib/localFn.ts` (`invokeFn`, new) is a drop-in for `supabase.functions.invoke` that redirects to a locally-served fn (`VITE_LOCAL_FUNCTIONS_URL`) when set, mirroring book-agent's existing `VITE_LOCAL_BOOK_AGENT_URL` escape hatch. Paired with local-only `claude-local` defaults added to `getActiveModels()` (model-config.ts) and a new `getJudgeModel()` (judge.ts) — both gated on `CLAUDE_LOCAL_URL` being present in the worker's OWN env (never true when deployed), so prod's shared `admin_settings.ai_model_tier` is never touched. Migrated 9 call sites off the `if (BRIDGE)` branch onto `invokeFn`: `loglineRead`, `confusionRead`, `shapeRead`, `meterRead`, `premiseRead`, `synopsisRead`, `factLedger`, `dnaExpand`, `AiCalls.tsx`'s judge button. Deleted `apps/web/src/lib/bridge.ts` (zero remaining importers). Found genuine dead code along the way: `dnaChat.ts`'s `sendDnaMessage` + the whole `dna_chats` session wrapper (`applyDnaProposal`/`clearDnaProposal`/`startNewDnaSession`/`resumeDnaSession`) had zero callers — the per-stage reviser was superseded by AgentRail; deleted, keeping the file's still-live `applyNodeOps`/`validateOps`/`describeOps` machinery. `scripts/eval-bridge.mjs` itself was NOT deleted — it's still a load-bearing utility module for 6 standalone analysis scripts (dna-causality-probe.mjs etc.) and prose-context-experiment.mjs's HTTP harness; only its header + FEATURE.md/DnaArchitecturePage.tsx docs were updated to stop claiming it's the web app's route.
- **Files/commits:** `apps/web/src/lib/localFn.ts` (new), `apps/web/src/lib/bridge.ts` (deleted), `apps/web/src/features/dna/lib/{loglineRead,confusionRead,shapeRead,meterRead,premiseRead,synopsisRead,factLedger,dnaExpand,dnaChat}.ts`, `apps/web/src/pages/admin/AiCalls.tsx`, `apps/web/.env.local`, `supabase/functions/_shared/{model-config,judge}.ts`, `supabase/functions/evaluate-ai-call/index.ts`, `supabase/functions/dna-expand/index.ts` (comment), `apps/web/src/features/dna/FEATURE.md`, `apps/web/src/features/dna/pages/DnaArchitecturePage.tsx`, `scripts/eval-bridge.mjs` (header only). Verified: web typecheck clean, edge `deno check` clean (pre-existing EdgeRuntime noise only), 1158/1160 web tests pass (1 pre-existing unrelated failure — `bookAgentDigestFields.test.ts` expects `DIGEST_FIELDS` in `book-agent/index.ts`, moved to `context.ts` by an earlier, separately-committed refactor).
- **PM impact:** none directly, but flagged one real finding for the author to decide: the `dna-chat` edge function + `dna_chats` table now have **zero live callers** anywhere (confirmed via grep) — candidate for deletion, deliberately left alone since undeploying a function is a bigger, less-reversible step than a client cleanup. Noted in FEATURE.md.

## 2026-07-13 — Root-caused the skill-loading false positives to a stringly-typed round-trip `[wip]`
- **What:** Continuation of the earlier same-day skill-loading investigation. User supplied a concrete repro: a fresh chat, one "next" click, and the same 3 playbooks loaded. Traced the actual message sent: `AgentRail.tsx`'s `nextStepMessage` (line ~301-305) stringifies the guided-flow decision into prose — `Write "${nodeLabel(draftTarget.scene)}".` — where `nodeLabel()` (`dnaChat.ts:34`) pulls the scene's plan `goal`/`summary` text (arbitrary story content). That prose is sent as the literal chat message, and `matchSkills` regex-triggers against it server-side. Root cause: the client already knows the action type (the ternary that built the string IS the classification) but discards that typed fact, round-trips it through free text, and the server re-derives it via regex — which then also picks up coincidental verb collisions from ordinary narrative prose ("calls," "checks," "reviews" as plot content, not editorial intent). Proposed fix: thread the client's already-known action/skill hint alongside the message so `matchSkills` prefers it over regex-sniffing the label text; regex stays only as the fallback for genuine free-typed asks. Not implemented — awaiting go-ahead.
- **Files/commits:** no diff from this session — read-only trace of `apps/web/src/features/dna/components/AgentRail.tsx`, `apps/web/src/features/dna/lib/dnaChat.ts`, plus the earlier session's `agent-skills.ts`/`context.ts`/`transcript.ts` read.
- **PM impact:** none yet. Supersedes/refines the earlier same-day "stale-ask" wip entry below — the manual-mode repro shows the more precise root cause; the auto-mode staleness finding still stands as a second, related bug.

## 2026-07-13 — localFn dev-bridge replacement (uncommitted, in progress) `[wip]`
- **What:** Not this session's work (this session was a read-only UX Q&A on the DNA tree's PILLAR-field-vs-child-group display, no files touched) — cataloguing pre-existing uncommitted changes so they don't go un-logged. New `apps/web/src/lib/localFn.ts` adds `invokeFn()`, a drop-in for `supabase.functions.invoke` that redirects to a locally-served edge fn (`VITE_LOCAL_FUNCTIONS_URL`) when set, superseding the old `BRIDGE`/`bridgeFetch` pattern ([[project_dev_bridge_mirror]]). 7 DNA read callers (confusionRead/dnaExpand/factLedger/loglineRead/meterRead/premiseRead/shapeRead/synopsisRead) switched from `bridgeFetch` to `invokeFn`. On the edge side, `judge.ts`/`model-config.ts` add a `CLAUDE_LOCAL_URL`-gated default so local dev rides the `claude-local` shim (subscription-billed) instead of a metered API; `evaluate-ai-call/index.ts` updated to call `getJudgeModel()` instead of the fixed `JUDGE_MODEL` const. Prod path unaffected (env var only ever set in a gitignored local `.env`).
- **Files/commits:** uncommitted — `apps/web/src/lib/localFn.ts` (new), `apps/web/src/features/dna/lib/{confusionRead,dnaExpand,factLedger,loglineRead,meterRead,premiseRead,shapeRead,synopsisRead}.ts`, `supabase/functions/_shared/{judge,model-config}.ts`, `supabase/functions/evaluate-ai-call/index.ts`.
- **PM impact:** none yet — not committed, not verified this session. Flagging so it isn't lost; next session should confirm it works end-to-end (or commit) before it goes stale.

## 2026-07-13 — Diagnosed stale-ask skill loading in auto-mode AgentRail `[wip]`
- **What:** User asked why the same 3 playbooks (prose-patch/render-brief/editorial-read) load every AgentRail turn regardless of what the turn is doing. Traced it: `matchSkills` runs against `authorAsk`, which `latestAuthorAsk()` freezes to the human's original kickoff message for the whole auto run (it skips auto-continue sentinels, so no later text ever replaces it). The turn-accurate signal, `liveObjective` (re-derived every chain link), is only consulted as a fallback when `askSkills` is empty — which in auto mode it never is. No code changed yet; proposed fix is to prefer `liveObjective` for skill matching in auto mode. Awaiting go-ahead to implement.
- **Files/commits:** no diff from this session — read-only investigation of `supabase/functions/_shared/agent-skills.ts`, `book-agent/context.ts`, `book-agent/transcript.ts`. (Unrelated pre-existing uncommitted changes in the tree — `confusionRead.ts`, `loglineRead.ts`, `judge.ts`, `model-config.ts`, `evaluate-ai-call/index.ts`, new `localFn.ts` — are from other work, not this session.)
- **PM impact:** none yet — no fix landed. Revisit once the auto-mode skill-matching fix ships.

## 2026-07-13 — claude-local shim: stop leaking narration as chat text `[chore]`
- **What:** User showed a screenshot of AgentRail displaying raw agent narration ("Assistant: I'll set up scene 8's render... search_nodes({...})") as if it were a real reply. Root cause: `claude -p` (the claude-local dev bridge) mimics the flattened "Assistant: ..."/"User: ..." transcript lines it's shown as history instead of emitting the required `{tool}`/`{text}` JSON envelope, and the shim's fallback silently returned the whole raw narration as a legitimate text reply. Fixed `scripts/claude-local-shim.mjs`: `toolEnvelopeBlock` now tells the model that format is a log, not a template (with a wrong/right example); `toAnthropicResponse` now throws on a malformed envelope instead of dumping raw text, routing through the same error path any other provider failure takes.
- **Files/commits:** `scripts/claude-local-shim.mjs` — commit `a3b2afd`.
- **PM impact:** none — dev-only bridge bugfix, no roadmap item.

## 2026-07-13 — book-agent: finish removing the aspect-scope fence `[chore]`
- **What:** User noticed `body.scope` in `book-agent/index.ts` was dead (client never sends it since the DNA context-model pivot — [[project_agent_context_model]]) and asked to remove all dead code. Traced the full thread and deleted it end-to-end: `shared.ts` (`Aspect`/`ASPECTS`/`ASPECT_KINDS`/`scopedKinds`, `context_scope` off `RunRow`/`ROW_COLS`), `context.ts` (`threadSystem`'s `scope` param, the `<hidden>`/`scope_note` branches, always-true `inScope`), `proposals.ts` (`scope` param + `allowed()` off `proposeNodeOps`/`proposeOptions`), `tools.ts` (`threadToolsFor`'s unused `_scope` param), `advance.ts` + `index.ts` + `ack.ts` (every call site + the `body.scope` request parsing). `ALL_NODE_KINDS` kept (still does real kind validation). Left the `book_agent_runs.context_scope` DB column alone — dropping it is a migration decision, not code cleanup. Verified with `deno check` (clean but for pre-existing unrelated `EdgeRuntime` global-typing noise).
- **Files/commits:** `supabase/functions/book-agent/{index,advance,context,proposals,shared,tools,ack}.ts`. Uncommitted.
- **PM impact:** none — pure dead-code removal, no behavior change.

## 2026-07-13 — claude-local shim tab task; AdminPromptPeek tag-tree view; book-agent scope-fence cleanup `[chore]`
- **What:** Three bundled items. (1) Diagnosed a `claude-local` agent-tier failure ("Network is unreachable" hitting `host.docker.internal:8788`) — the laptop-side `claude-local-shim.mjs` sidecar wasn't running; started it and confirmed `/health`. Added `.vscode/tasks.json` ("Claude Local Shim" task, dedicated panel) so it launches in its own VS Code terminal tab in one Command-Palette step instead of a manual `pnpm dev:claude-local-shim` in a spare terminal; `dev:all` already excluded it, no change needed there. (2) `AdminPromptPeek.tsx` rewritten from a raw JSON/text dump into a collapsible, per-tag colored section tree (parses the `<tag note="...">` XML wrapping context.ts already emits) plus a fullscreen modal — makes the admin debug peek actually legible. (3) `book-agent/{context,proposals,shared,tools}.ts` drop the last server-side remnants of the aspect-scope fence (`context_scope` column read, `Aspect`/`scopedKinds`, the scope param threaded through `threadSystem`/`proposeNodeOps`/`threadToolsFor`) — completes "whole book always visible" ([[project_agent_context_model]]); scope was already unused client-side.
- **Files/commits:** `.vscode/tasks.json` (new); `apps/web/src/features/dna/components/agentRail/AdminPromptPeek.tsx` (rewrite); `apps/web/src/features/dna/components/AgentRail.tsx`; `supabase/functions/book-agent/{context,proposals,shared,tools}.ts`. All uncommitted.
- **PM impact:** none — dev-tooling fix + debug-UI polish + dead-code cleanup, no product behavior change.

## 2026-07-13 — AdminPromptPeek: persist after the turn finishes `[chore]`
- **What:** The admin raw-request peek was gated on `running`, so it fetched nothing and unmounted the moment a turn finished — useless for reviewing what was just sent. Dropped `running` from both the `useLatestAiCall` `enabled` flag and the render condition in AgentRail; it now fetches/shows the run's latest `ai_calls` row regardless of live/finished state, still admin-gated only.
- **Files/commits:** `apps/web/src/features/dna/components/AgentRail.tsx` (uncommitted).
- **PM impact:** none — debug-UI-only.

## 2026-07-13 — Remove the Anthropic-key parameter from callLLM (all edge fns) `[chore]`
- **What:** Extends the book-agent-only fix below to the root. Every edge fn was forced to read `ANTHROPIC_API_KEY` and hand it to `callLLM(apiKey, …)`, but callLLM's only use of it was `?? apiKey` as the Anthropic-route fallback — redundant (that route already reads the same env) and wrong for other routes. Dropped the `apiKey` param from `callLLM` (+ the transitive chain: `judgeProse`/`judgeAgainstPlan`/`runMandateGate`/`foldDigest`/`buildProseDigest`/book-agent's `advance`/`maybeEagerAck`/`maybeTitleThread`/`maybeInjectRenderVerify`/`planConformanceSummary`) and removed the per-fn `if (!ANTHROPIC_API_KEY) 500` startup guards. Provider + key are now chosen entirely inside callLLM (ai_provider switch → resolveRoute → route.keyEnv). No behavior change for any configured provider; a real misconfig surfaces as that provider's own auth error.
- **Files:** 15 — `_shared/{llm,mandate-gate,plan-gate}.ts`, `book-agent/{index,advance,ack,verify,exec-tools}.ts`, `dna-expand`, `dna-chat`, `dna-decompose`, `evaluate-ai-call`, `read-{facts,synopsis,logline,premise,confusion,shape,meters}`. Verified: `deno check` clean on all 12 fn entries (only pre-existing EdgeRuntime-global noise); zero `apiKey` references remain.
- **PM impact:** none directly; removes the last hard `ANTHROPIC_API_KEY` dependency so a full non-Anthropic run is possible. Relevant to [[project_model_stack_openrouter]] + the ai_provider switch.

## 2026-07-13 — book-agent: drop the Anthropic-key hard coupling `[chore]`
- **What:** book-agent 500'd at startup (and check_against_contract returned "unavailable") whenever `ANTHROPIC_API_KEY` was unset — a false dependency, since the provider is chosen per-call in callLLM (ai_provider switch + resolveRoute) and each route supplies its own key. `apiKey` was only ever the Anthropic-route fallback. Removed both guards; default `apiKey` to `""` so a genuine misconfig surfaces as the active provider's own auth error. Running purely on DeepSeek/OpenRouter no longer requires an Anthropic key. No behavior change for the current deepseek config.
- **Files:** `supabase/functions/book-agent/{index,exec-tools}.ts`. Verified: `deno check` clean (only pre-existing EdgeRuntime-global noise).
- **PM impact:** none (removes a latent blocker for a full Anthropic-key-less run; relevant to [[project_model_stack_openrouter]] / the ai_provider switch).

## 2026-07-13 — AdminPromptPeek: tag-aware collapsible render + fullscreen modal `[chore]`
- **What:** Followed up the escaped-JSON fix with real formatting. `context.ts` already wraps each context kind in its own XML tag (`<book_state>`, `<brief>`, `<current_objective>`, `<story_analysis>`, `<dna_tree>`, etc. — comment at context.ts:252 says this is deliberate, for the model's benefit). Added a bounded parser that splits on those top-level tags and renders each as a colored, collapsible section (big reference blocks like `dna_tree`/`skill_briefs`/`story_analysis` start collapsed, payload blocks start open). Added a maximize button opening a shadcn `Dialog` with the same tree at full width/height for comfortable reading.
- **Files/commits:** `apps/web/src/features/dna/components/agentRail/AdminPromptPeek.tsx` (uncommitted). Verified: `tsc -p tsconfig.app.json --noEmit` and `eslint` both clean on the file.
- **PM impact:** none — debug-UI-only.

## 2026-07-13 — Thin book-agent index.ts to the HTTP router `[chore]`
- **What:** Follow-up to the 8-module split — index.ts was still 845 lines because the durable-loop engine lived there. Moved advance()+chain+ackWith+rejectAndChain+sleep → `advance.ts` (400), the eager-ack/titling passes → `ack.ts` (137), and the transcript pure-helpers (compaction, sentinels, cache-breakpoints, book-state injection) → `transcript.ts` (141). index.ts is now **184 lines** = just the Deno.serve request router. Verbatim block-move via build script; behavior unchanged.
- **Files:** `supabase/functions/book-agent/{index,advance,ack,transcript}.ts`. Verified: `deno check` on the entry (whole graph) clean bar the pre-existing EdgeRuntime-global noise; every moved symbol defined exactly once.
- **PM impact:** none.

## 2026-07-13 — Fix AdminPromptPeek escaped-JSON soup `[chore]`
- **What:** The admin raw-request peek in AgentRail rendered `messages` via one blind `JSON.stringify(input, null, 2)`, so every text block's real newlines/quotes got re-escaped into unreadable `\n`/`\"` soup. Rewrote to walk the Anthropic-shaped message array structurally: per message role, per content part — text parts render as plain wrapped text (real newlines), non-text parts (tool_use/tool_result/etc.) get their own pretty JSON. `system` unchanged (was already a raw string).
- **Files/commits:** `apps/web/src/features/dna/components/agentRail/AdminPromptPeek.tsx` (uncommitted). Verified: `tsc -p tsconfig.app.json --noEmit` clean.
- **PM impact:** none — pure debug-UI readability fix.

## 2026-07-13 — Split book-agent/index.ts into 8 modules `[chore]`
- **What:** Full file split of the 1974-line edge function into a clean import DAG: `shared.ts` (types/constants/nodeHandle/schema), `prompts.ts`, `tools.ts` (tool schemas), `exec-tools.ts`, `verify.ts`, `proposals.ts`, `context.ts` (threadSystem+digest), `index.ts` (router+advance loop, now 845 lines). Follows the earlier `ackWith`/`rejectAndChain`/`chain` dedup. Pure verbatim block-move (build script sliced ranges — no prompt-string retyping); behavior unchanged. Also removed a stray `/` typo at `advance(...);/` that a concurrent IDE edit left in, breaking compilation.
- **Files:** `supabase/functions/book-agent/{index,shared,prompts,tools,exec-tools,verify,proposals,context}.ts` (uncommitted). Verified: `deno check` on the entry (whole graph) clean — only the pre-existing `EdgeRuntime`-global noise; every moved symbol defined exactly once.
- **PM impact:** none (no behavior/scope change).

## 2026-07-13 — Admin-only raw LLM request peek in AgentRail `[ship]`
- **What:** User wanted to see the actual request sent to the LLM (right before the "thinking…"
  loader), admin-only, with no added latency. Reused existing infra rather than inventing new
  storage: `ai_calls` already logs the full `system`/`input` for every call (including a 'running'
  row inserted before the network call even starts) and is already Realtime-published
  (20260713100000_ai_calls_realtime). New `useLatestAiCall` hook scopes that to one `task_id`
  (Realtime event as signal, refetch one row — same discipline as `admin/AiCalls.tsx`'s
  heavy-columns-on-demand pattern, so cost is one small query per turn, only for admins, never for
  everyone else). New `AdminPromptPeek` component: collapsed one-liner (model/tokens), expands to
  full system+messages. Gated on the existing `useAdmin()` hook + `running`.
- **Files/commits:** new `apps/web/src/features/dna/hooks/useLatestAiCall.ts`,
  `apps/web/src/features/dna/components/agentRail/AdminPromptPeek.tsx`; wired into
  `AgentRail.tsx`. No backend/RLS changes needed. `vite build` clean. Uncommitted.
- **PM impact:** none — admin debug tooling, not a product surface.

## 2026-07-13 — book-agent advance() dispatch readability refactor `[chore]`
- **What:** Extracted two helpers in the agent chain-link dispatch — `ackWith()` (terminal-call/sibling tool_result builder, was inlined 3×) and `rejectAndChain()` (the identical toolResults→push→update→chain block ending all 4 `propose_*` reject paths). Pure dedup, behavior byte-identical; net −11 lines, flatter dispatch. `chain()` + `groundingLabels` already landed via a parallel session's commit (a5e1941).
- **Files/commits:** `supabase/functions/book-agent/index.ts` (uncommitted). Verified: `deno check` clean (only the pre-existing `EdgeRuntime`-global noise, 28→6).
- **PM impact:** none (no behavior/scope change).

## 2026-07-13 — Fix grounding-line repetition (live-reported bug) `[ship]`
- **What:** User saw the same-day grounding line (turn-grounding ship, above/earlier) repeat 10x
  identically in the rail ("Step 5/5 · Prose — Scenes — Scene 8 of 10..."). Root cause: the line
  collapsed to just the objective headline whenever focus/mentioned/skill were empty (the common
  case on auto-continue turns), so it repeated verbatim every turn. Fix: dropped the objective
  headline (redundant with the "next step" card); now emits one entry per concrete action
  ("Loaded the scene-craft playbook.", "Loaded scene "X" in full."), matching the existing
  read_node/read_skill tool-step phrasing, and deduped against steps since the last user/answer
  message so a multi-turn auto action doesn't re-announce unchanged context every turn.
- **Files/commits:** `supabase/functions/book-agent/index.ts` (threadSystem + call site),
  `docs/agent-turn-grounding.md` rewritten with a "first attempt, and why it was wrong" section.
  Deployed to prod.
- **PM impact:** none beyond the existing AgentRail STATE.md row (already covers the grounding-line
  ship; this is a same-day correction, not a new capability).

## 2026-07-13 — Per-node content history + revert `[ship]`
- **What:** Fine-grained node audit log so an author can see a single node's content timeline, tell
  exactly what an AI op changed, and revert one node to an earlier state. New `book_node_revisions`
  table + `SECURITY DEFINER` trigger on `book_nodes` captures every content-changing write
  (source-agnostic: agent / manual / bridge); state-based full-content snapshots; keep-50/node;
  precise AI attribution (`ai_call_id` set only when `last_ai_call_id` changes on that write).
  `NodeHistory` timeline wired into the existing `NodeDetailsModal` with field-level diff + restore.
  Verified end-to-end at the DB layer (trigger fires/skips correctly, attribution, forward-moving
  revert); UI typechecks but not yet browser-driven.
- **Files:** `supabase/migrations/20260713110000_book_node_revisions.sql` (pushed),
  `apps/web/src/features/dna/lib/nodeRevisions.ts`, `components/tree/modals.tsx` (NodeHistory + shared
  `specRows`). Uncommitted.
- **PM impact:** none — adjacent to M1 (author trust/transparency), not a Now-slot item. No promotion.

## 2026-07-13 — Agent turn grounding line `[ship]`
- **What:** The rail showed only a generic "thinking…" spinner during a turn's model call (up to
  ~100s). `threadSystem()` (book-agent/index.ts) already computes everything needed for a status
  line as a byproduct of context assembly — it now also returns `grounding` (focus/mentioned counts,
  objective headline, matched skill brief), written as a `{t:"read"}` step folded into the existing
  pre-call `turns` update (no extra DB round-trip). Client needs no changes — `StepBubble` already
  renders `read` steps as a muted activity line. Always emitted, no turn-to-turn dedup.
- **Files/commits:** `supabase/functions/book-agent/index.ts` (threadSystem + call site), new
  `docs/agent-turn-grounding.md`. Deployed to prod (`supabase functions deploy book-agent`).
- **PM impact:** addendum on the AgentRail row in `pm/STATE.md`.

## 2026-07-13 — Composer: drop the "/ for commands" idle hint `[chore]`
- **What:** Removed the small "/ for commands" hint line (and its now-unused `Slash` icon import)
  that showed under the composer when idle and empty. Editorial tweak, no behavior change to the
  slash-command menu itself.
- **Files/commits:** `apps/web/src/features/dna/components/agentRail/Composer.tsx` — uncommitted.
- **PM impact:** none.

## 2026-07-13 — DNA architecture challenge brief `[chore]`
- **What:** wrote `docs/dna-architecture-challenge-brief.md` — a red-team briefing doc (system-as-built
  first, our own self-critique last, to avoid anchoring) meant to be handed to an independent/stronger
  model to challenge the DNA architecture. Poses 6 pointed open questions (is structure the real
  bottleneck vs. prose craft, is tree-as-truth earning its complexity, cache-hostile agent context,
  auto-accept convergence, modal-story ceiling, single load-bearing assumption).
- **Files/commits:** `docs/dna-architecture-challenge-brief.md` (new, uncommitted).
- **PM impact:** none — a review artifact, not a shipped change. Worth reading before/alongside the
  Now-1 "re-exercise the live full-book build" item, since its own §6 Q1 questions whether that item is
  attacking the real bottleneck.

## 2026-07-13 — AgentRail split into subcomponents `[chore]`
- **What:** Pure readability refactor, no behavior change. AgentRail.tsx (896 lines) shrunk to a 431-line
  orchestrator; header controls, composer, and the step/proposal/session display pieces moved into a new
  `agentRail/` folder (AgentRailControls, Composer, DiffRows, ProposalCard, ResolvedCard, SessionHistory,
  StepBubble, journeyContent, opSummary). Typecheck + eslint clean; only importer (DnaTreePage) unaffected.
- **Files/commits:** `apps/web/src/features/dna/components/AgentRail.tsx` (rewritten), new
  `apps/web/src/features/dna/components/agentRail/*` (9 files) — uncommitted.
- **PM impact:** none.

## 2026-07-12 — DNA tree: ghost-preview the default skeleton before anything is generated `[ship]`
- **What:** User wanted the tree to show the book's shape (3 acts, minimum cast, etc.) before any
  generation — a scaffold-first view instead of the current one-rung-unlocks-the-next journey. Investigation
  found most of the UI for this already existed (the pillar's `alwaysShow` entity/story groups), gated only
  on the pillar node existing for real, which it doesn't until first generated. Rather than materializing
  empty draft `book_nodes` rows (risky: `dnaJourney.stageComplete()` gates acts/beats on mere row EXISTENCE,
  not content — a real empty act would have silently marked "structure" done), built a pure client-side
  render overlay: new `lib/dnaSkeleton.ts` derives ghost premise→pillar→{2-person min cast, Weiland's 3 acts
  with their 9 template-slotted beats (hook/inciting/plot points/pinches/midpoint/climax/resolution)} from
  the current tree + `structureForBook()`; new `components/tree/GhostRows.tsx` renders them dashed/faint,
  read-only. A rung ghosts only while ENTIRELY empty and disappears for good the moment any real node lands
  there (matched by sibling position, not title, so a renamed act still gets its slot's beats). Locations/
  world/threads/tentpoles/games/relationships have no template count anywhere in the schema, so those got
  one honest "registry" note instead of fabricated numbers. Wired into `Subtree.tsx` at 4 injection points.
  Verified live on book "tes" (1251) via chrome-devtools MCP — full 3-act/9-beat/2-cast skeleton renders
  correctly at the empty-tree state from the user's screenshot; `tsc --noEmit` clean; existing
  `novelDna.test.ts` + `dnaJourney.test.ts` (131 tests) still pass.
- **Files/commits:** `apps/web/src/features/dna/lib/dnaSkeleton.ts` (new),
  `apps/web/src/features/dna/components/tree/GhostRows.tsx` (new),
  `apps/web/src/features/dna/components/tree/Subtree.tsx` (uncommitted).
- **PM impact:** none — a UX/discoverability improvement on the existing DNA tree, not a Now-item change.

## 2026-07-12 — Beat-sheet quality fixes + shim leak actually plugged `[wip]`
- **What:** Three fixes surfaced while re-exercising live beat-sheet generation on the deepseek-v4
  path (Now #1). (1) `dna-expand`'s beat sheet prompt now converts the Weiland template's cumulative
  act `target_pct` into per-act SPANS and tells the model to allocate beats proportionally — root-fixes
  the starved-Act-2 failure (beats were split evenly across acts instead of ~half landing in the ~50%-
  of-book Act 2). (2) `max_tokens` 8000→16000 on both the beat-sheet prepare and repair calls — a
  reasoning model (deepseek-v4-pro) counts its thinking phase INSIDE max_tokens, so 8000 was silently
  truncating the JSON mid-array (root cause of book 1237's unslotted sheet). (3) The repair prompt now
  branches by issue class (causal vs structure-slot) and — for slot issues only — is allowed to
  insert/reorder beats to fill a genuinely missing signpost, instead of a one-size prompt that forbade
  adding beats even when a slot was structurally absent. Separately: `claude-local-shim.mjs`'s prior
  "isolate spawned claude" fix (`--system-prompt`, committed in f1895de) was re-verified and found
  NOT sufficient — the global `~/.claude/CLAUDE.md` and plugin SessionStart blobs still leaked into
  book-agent's persona. `--safe-mode` (not `--bare`, which forces API-key-only auth) actually
  disables ambient CLAUDE.md/skills/plugins/hooks/MCP while keeping subscription auth — verified with
  a leak probe returning clean. `eval-bridge.mjs`'s default prose model also flipped opus→sonnet.
- **Files/commits:** `supabase/functions/dna-expand/index.ts`, `scripts/claude-local-shim.mjs`,
  `scripts/eval-bridge.mjs` (all uncommitted, edge fn not yet redeployed).
- **PM impact:** none yet — feeds directly into Now #1's "re-exercise the live full-book build"
  evidence gate (ROADMAP.md); not itself a ship.

## 2026-07-12 — Seed logline: stop auto-generating from brief idea `[chore]`
- **What:** The DNA tree's seed logline was being silently prefilled from `brief.idea` and then
  auto-drafted via an AI call the moment the idea field was saved (`bootstrapLoglineFromBrief`).
  Removed that entirely — the seed's logline now starts empty; the author writes it or asks the
  agent explicitly. `ensureSeed()` no longer takes/prefills an idea.
- **Files/commits:** apps/web/src/features/dna/lib/dnaExpand.ts,
  apps/web/src/features/dna/pages/DnaTreePage.tsx, apps/web/src/components/book/BookBriefSection.tsx
  (uncommitted).
- **PM impact:** none — small UX correction to the brief→seed derivation, not a Now-item change.

## 2026-07-12 — AgentRail: fix markdown tables rendering as raw pipe text `[chore]`
- **What:** User-reported bug — GFM tables (e.g. Weiland beat-sheet analysis) in AgentRail chat
  rendered as literal `| a | b |` text instead of a table. Root cause: `ReactMarkdown` in
  `AgentRail.tsx` had no `remark-gfm` plugin, so GFM-only syntax (tables) fell back to plain
  paragraph text. Installed `remark-gfm`, wired `remarkPlugins={[remarkGfm]}`, and wrapped the
  `table` renderer in `overflow-x-auto` (rail is a narrow fixed panel). Verified live on book 1249
  ("3 acts") — table now a real 11×3 DOM `<table>` with styled headers.
- **Files/commits:** `apps/web/src/features/dna/components/AgentRail.tsx`, `apps/web/package.json`,
  `pnpm-lock.yaml` (added `remark-gfm` dep). Uncommitted.
- **PM impact:** none — isolated UI bug fix, not tied to a roadmap item.

## 2026-07-12 — eval-bridge: add `sketch` target + isolate spawned-claude from repo hooks `[chore]`
- **What:** In-app "generate sketch" failed with `Unknown expand target "sketch"`. Root cause was
  dev-path routing: `VITE_EVAL_BRIDGE_URL` is set, so the client routes `/dna-expand` to the local
  eval-bridge, which mirrored `logline/prose/beatsheet` but not `sketch` → fell through to the
  catch-all. Added the `sketch` branch mirroring `dna-expand/index.ts:706` (SCENE_DIRECTION_CRAFT
  inlined, `runClaude`). Then hit a 2nd failure — `unparsable JSON`: the bridge's `runClaude` spawns
  `claude -p` in repoRoot loading ALL setting sources, so the sub-instance fired this repo's PROJECT
  PM Stop hook and answered the `/wrap` nag instead of emitting JSON. Fix: default CLAUDE_FLAGS now
  `--dangerously-skip-permissions --setting-sources user` — drops the project hook while keeping
  user-level OAuth. (`--bare` also kills the hook but broke auth → "Not logged in", so reverted.)
  Verified the flag combo returns clean JSON via a direct `claude -p` probe.
- **Files:** `scripts/eval-bridge.mjs` (sketch branch ~3733; CLAUDE_FLAGS L27-33).
  Uncommitted, bridge restarted. Deployed `dna-expand` already had sketch — no edge change needed.
- **Verify:** routing + auth + clean-JSON confirmed server-side; final in-app sketch render pending an
  authenticated browser retry (book 1249, node n_gif4aamnn).
- **PM impact:** none (dev-tooling; bridge is not the required dev route).

## 2026-07-12 — claude-local bridge context bleed fixed with `--safe-mode` `[ship]`
- **What:** Book-agent calls via the `claude-local` shim were inheriting this coding harness's
  global `~/.claude/CLAUDE.md` (PM `/wrap` ritual, "teach me", chime) + enabled-plugin SessionStart
  hooks (Vercel blob) — contaminating the novelist persona (surfaced as a logline reply narrating a
  coding session). Root cause: on CLI 2.1.207 `--system-prompt` does NOT suppress ambient
  CLAUDE.md/plugins (the old comment's claim was empirically false). Fix: add hardcoded `--safe-mode`
  to the `claude -p` spawn — disables all customizations WITHOUT `--bare`'s ANTHROPIC_API_KEY-only
  auth restriction, so subscription billing survives. Verified worst-case (cwd=repo, key unset) →
  leak probe returns `NONE`, auth intact; and end-to-end through the restarted HTTP shim.
- **Files/commits:** `scripts/claude-local-shim.mjs` (+22/−15; `--safe-mode` in `runClaudeLocal`
  args + corrected header comments). Investigation `doc_1783843689012.md`,
  `learning_1783843689012_shim-safe-mode.md`. Not committed. (Also restarted the live shim: killed
  stale 1.5-day PID that predated the fix.)
- **PM impact:** none to promote — the bridge is dev-only tooling, not a curated STATE project row.
  Note: `supabase/functions/dna-expand/index.ts` shows modified in the tree but is NOT this task's
  work (left untouched).

## 2026-07-12 — Diagnosed Supabase egress-quota trip (Free tier hit 6.81/5.5GB) `[chore]`
- **What:** User hit a Supabase Free-plan egress quota email and had already upgraded to Pro;
  asked to find the root cause. Explore-agent audit of migrations + client found `book_nodes`
  has `REPLICA IDENTITY FULL` + is in the `supabase_realtime` publication — same shape as the
  previously-fixed `book_agent_runs` bug, but never generalized. `useBookNodesLiveSync.ts`
  refetches the *entire* DNA tree (`select("*")`) on any single node change, so one agent turn
  editing many nodes fires many full-tree broadcasts to every open tab. Secondary finding:
  `BookDetails.tsx` refetches `pages.select("*")` (incl. `embedding`, `old_content`) on every
  page write. No code changed — investigation only; fix proposed, awaiting go-ahead.
- **Files/commits:** doc_1783842088499.md (write-up); implicated: `supabase/migrations_archive/
  20260627120000_book_nodes_replica_full.sql`, `apps/web/src/features/dna/hooks/
  useBookNodesLiveSync.ts`, `apps/web/src/pages/books/show/BookDetails.tsx`. No commits.
- **PM impact:** none yet — candidate fix (revert `book_nodes` replica identity + incremental
  live-sync instead of whole-tree refetch) not promoted; needs author sign-off before it ships.

## 2026-07-12 — Slot badges on tree beat rows `[ship]`
- **What:** The structure-template slot names (hook / midpoint / climax…) now render as a small
  uppercase chip on each carrying beat's row in the tree — the tree reads like a beat board.
  Hover = the slot's target % + craft line. Pure display: `beatSlot()` in nodeDisplay.ts resolves
  labels across all templates; unresolved keys still display (underscores → spaces).
- **Files/commits:** components/tree/nodeDisplay.ts, components/tree/TreeRow.tsx (uncommitted).
- **PM impact:** appended to the Story structure templates row in STATE.md.

## 2026-07-12 — Fix stale bridge gate: beat sheets no longer require pre-declared threads `[chore]`
- **What:** Local dev bridge (`scripts/eval-bridge.mjs`, used when `VITE_EVAL_BRIDGE_URL` is set)
  still hard-gated beat-sheet generation on `threads.length`, throwing "generate the threads
  before the beat sheet." That check was removed from the edge fn (`dna-expand`) on 2026-07-02
  when threads became derived/minted by the beat sheet itself, but the bridge — documented as a
  special-case shim, not a kept-in-sync mirror — never got the update. Deleted the stale gate line
  (did not port the edge fn's full mint-threads/structure/lint pipeline — out of scope for this
  fix). Killed and restarted the running bridge process so the fix is live.
- **Files/commits:** `scripts/eval-bridge.mjs` (uncommitted).
- **PM impact:** none — dev-tooling bug fix, not a product-facing change.

## 2026-07-12 — Story structure templates: opinionated 3-act agent `[ship]`
- **What:** The agent now builds against K.M. Weiland's three-act / 8-beat structure by default,
  as swappable data (strategy pattern), not prompt prose. `StructureTemplate` const (9 slots with
  % positions + craft guidance-by-name) in both engine twins; `BeatContent.slot` marks the carrier
  beat; `pillar.structure` picks the method ("none" opts out, absent = default at read time).
  Beatsheet prompt lists the slots and demands each on exactly one beat; acts playbook fixes three
  acts with template target_pct. Verify half: slot_missing/duplicate/misplaced/misordered/unknown
  lints in validate() (fail-quiet for legacy trees) — also wired into the beat sheet's bounded
  repair turn. Honors the removed-Freytag decision: the opinion is explicit and swappable, never
  silent; other methods (Save the Cat…) = one more registry entry in both twins.
- **Files/commits:** novelDna.ts + _shared/novel-dna.ts (twins), dnaSchema.ts + dna-schema.json,
  dnaJourney.ts + _shared/dna-journey.ts, dna-expand/index.ts, book-agent/index.ts (digest),
  novelDna.test.ts (+8), novelDna.parity.test.ts (structureBook fixture, 671 assertions) —
  uncommitted on feat/ai-provider-switch. Deployed: dna-expand, book-agent, dna-chat, dna-decompose.
- **PM impact:** strengthens M1 (The First Read) — the live full-book build re-exercise (Now #1)
  will now generate against the template; watch slot lints in that run.


## 2026-07-12 — DNA tree: stop echoing summary/goal as the inline title `[chore]`
- **What:** Act/scene/beat rows in the tree editor showed the same text twice — the inline title next to the kind badge duplicated the SUMMARY (beat) or fell back to GOAL (act/scene) when no distinct title was set. `nodeTitle()` now only uses each kind's real short-title field (blank for beat, which has none; goal/summary stay visible in the expanded row).
- **Files/commits:** `apps/web/src/features/dna/components/tree/nodeDisplay.ts` (uncommitted).
- **PM impact:** none.

## 2026-07-12 — node details modal now shows all content fields `[chore]`
- **What:** User noticed `value_shift` (and every other plan field — goal/conflict/outcome/etc.)
  was invisible in the node "view details" modal — it only ever showed provenance (AI call/prompt)
  and derived analysis, never the node's actual schema content. Added a `ContentFields` block to
  `NodeDetailsModal` that iterates `editSpecs(node.kind)` + `hiddenFields()` and renders every field
  read-only, reusing the same `displayValue`/`hiddenFields` helpers the inline tree editor already
  uses (so refs resolve to node titles, not raw ids). No new fields added to the schema — this was
  a projection gap in the modal, not missing data.
- **Files/commits:** `apps/web/src/features/dna/components/tree/modals.tsx` (uncommitted).
- **PM impact:** none — small UI completeness fix, no roadmap/state change.

## 2026-07-12 — verified the brief/premise reads live, fixed a truncation bug `[ship]`
- **What:** Built on the "LLM reviewer for logline and premise" work (commit `8acc313`, already
  landed): deployed `read-logline`/`read-premise`/`dna-expand` to Supabase, then verified both
  new judges end-to-end against the real deployment — no browser available this session (both
  claude-in-chrome and chrome-devtools-mcp were unreachable), so instead scripted a throwaway
  smoke test: a disposable user + book + seed/premise nodes via service-role writes, a real
  signed-in session, direct HTTP calls to both edge functions, verdict inspected, then torn down.
  `read-logline` worked first try. `read-premise` 500'd with "Unexpected end of JSON input" —
  its response was getting truncated before the model could emit the closing JSON (the longest
  system prompt of the three reads: full `PREMISE_CRAFT` text + 7 axes, on the same 1400-token
  budget `read-shape`/`read-synopsis` use for less). Bumped `max_tokens` 1400 → 3000, redeployed,
  reran — both reads now return full, well-grounded verdicts. `logline_fixity` correctly caught a
  deliberately-planted obstacle swap (storm → rival keeper) in the test premise, scoring it 2/5
  with an accurate note — the exact new capability this axis was built for.
- **Files/commits:** `supabase/functions/read-premise/index.ts` (max_tokens fix, not yet
  committed — left for the user/next catalogue pass per the "never commit unless asked" rule).
- **PM impact:** none beyond what `8acc313` already covers; this entry documents the live
  verification pass and the one post-commit fix.

## 2026-07-11 — traced the logline review/accept loop for the user `[chore]`
- **What:** User asked how a generated logline gets reviewed and "closes the loop." Traced the
  existing (already-shipped) mechanism rather than proposing anything new: `dna-expand` generates
  the seed's logline from the brief idea; `verticalLints()` (`novelDna.ts`) runs two deterministic,
  warn-only checks (`logline_overlong`, `logline_static`) with no LLM-judge; the author's explicit
  Accept flips `seed.authoring.status`, which both unlocks the Premise stage
  (`dnaJourney.ts`) and becomes the FIXED contract premise/pillar generation must honor. No code
  changed, no design gap found worth flagging beyond noting the mechanical-only review (no
  semantic/LLM check on obstacle specificity or stakes).
- **Files/commits:** none (explanation only); `doc_1783756703717.md` +
  `learning_1783756703717_logline_review_loop.md` (local-only, not committed).
- **PM impact:** none.

## 2026-07-11 — stale-mechanism design question raised, not yet ratified `[wip]`
- **What:** User proposed replacing the tree's automatic parent→children staleness with an
  explicit write-time choice (nothing goes stale / mark children stale / discard children).
  Traced the current mechanism to ground the discussion: staleness is derived, not set —
  `isStale()` (`novelDna.ts`) hashes a node's live inputs and compares against the recorded
  `src_hash`; nothing ever "marks" a child, the mismatch just shows up on next read via the
  existing per-node stale-chip accept/discard UI (`staleActions.ts`). No code changed. Open
  question surfaced for the user: is this decision point for manual tree edits, the agent's edits
  (manual-accept/auto-accept), or both — and if manual, blocking modal vs. lighter inline
  affordance, since a modal on every parent save cuts against the no-edit-reflex bar (NORTH_STAR
  §2).
- **Files/commits:** none (discussion only); `doc_1783755713224.md` (local-only trace of the
  current mechanism + the tradeoffs, not committed).
- **PM impact:** none yet — no ROADMAP/DECISIONS entry until the user ratifies a direction.

## 2026-07-11 — clear all nodes: whole-tree discard option in the overflow menu `[ship]`
- **What:** Committed by a concurrent session, uncatalogued until now. Added an "everything" level
  to `DiscardStoryModal` (previously prose/scenes/beats/story) that snapshots the tree to History
  then deletes the true root node (`parent_id === null`) so `ON DELETE CASCADE` clears the whole
  tree, including foundations — wired to a new "✕ clear all" item in the tree's overflow menu
  (`DnaTreePage.tsx`). Fixes the modal's pre-existing `pillar`-vs-`seed` root confusion (pillar is
  a grandchild of the true root via seed → premise → pillar, so deleting it left seed/premise
  behind).
- **Files/commits:** `apps/web/src/features/dna/components/tree/modals.tsx`,
  `apps/web/src/features/dna/pages/DnaTreePage.tsx` — `95bfb5b`.
- **PM impact:** noted on the DNA tree editor row in STATE.md.

## 2026-07-11 — committed the tentpole guidance-by-name fix `[chore]`
- **What:** Landed the previously-catalogued tentpole fix (see the entry directly below) as commit
  `386769a`. No new work — just closing the loop from "not yet committed" to committed. Left the
  unrelated pre-existing WIP (`modals.tsx`/`DnaTreePage.tsx` "discard everything" feature,
  `doc_*.md`/`todo.md`) unstaged/untracked, out of scope for this commit.
- **Files/commits:** `386769a`.
- **PM impact:** none new — same as the entry below.

## 2026-07-11 — tentpoles: guidance-by-name, not verbatim-text matching `[ship]`
- **What:** `tentpole` was the only DNA entity with no short `name` field — its one `summary` field
  did double duty as both the beat-sheet generator's matching key (exact lowercase text match) and
  its content, so the prompt forced the model to quote a whole sentence back verbatim just to get a
  tentpole placed; a paraphrase silently dropped it (surfacing later as an unexplained
  `tentpole_unplaced` lint). Fixed by mirroring the thread/game/world_fact pattern: added a required
  `name` field, relabeled `summary` → "guidance" (a feel/turn to honor, not a line to quote), and
  switched the beat-sheet + brief-compile prompts in dna-expand to reference tentpoles BY NAME.
  Propagated through the agent's tree digest, tree UI title, obligation-ledger display name (both
  parity-locked novelDna twins), and the EPUB-import decompose path, with a legacy fallback so
  already-authored tentpoles (no `name` yet) keep resolving. Regenerated the checked-in
  dna-schema.json artifact. 600 web vitest tests pass (incl. 449 parity), tsc clean.
- **Files/commits:** `apps/web/src/features/dna/lib/dnaSchema.ts`,
  `apps/web/src/features/dna/lib/dnaSchema.artifact.test.ts`,
  `apps/web/src/features/dna/lib/novelDna.ts`, `apps/web/src/features/dna/components/tree/nodeDisplay.ts`,
  `supabase/functions/dna-expand/index.ts`, `supabase/functions/book-agent/index.ts`,
  `supabase/functions/dna-decompose/index.ts`, `supabase/functions/_shared/dna-decompose-core.ts`,
  `supabase/functions/_shared/novel-dna.ts`, `supabase/functions/_shared/dna-schema.json` — not yet
  committed or deployed.
- **PM impact:** none new (not a Now-list item; a scoped fix surfaced by the author reading the
  tentpole-realization code). Existing tentpoles in already-authored books now read as incomplete
  (missing `name`) until backfilled — expected, same as any new required field.

## 2026-07-10 — claude-local shim: per-call empty cwd; diagnosed two live-session incidents `[ship]`
- **What (requested):** Switched the shim's `claude -p` spawn from one shared tmpdir (created once,
  reused across every turn) to a fresh `mkdtempSync` directory per call, removed via `rmSync` once
  that call settles (success/error/timeout all clean up). Even with `--tools ""`, a reused cwd still
  gives Claude Code something to walk up from as ambient project context, and isn't guaranteed-empty
  over a long shim uptime. Verified text and tool_use round trips both still correct, no leftover
  directory after either.
- **What (incident response, same session):** User hit two problems live. (1) "Applied automatically
  without notice, no proposal" — traced via `ai_calls` to `fn: dna-expand, source: bridge, model:
  claude-code-local` — a completely different, pre-existing system (eval-bridge.mjs via
  `VITE_EVAL_BRIDGE_URL`), not book-agent or claude-local at all; not something this work touched.
  (2) Agent UI stuck after clicking Stop on book "mp5" (book_id 1238) — this one WAS my fault: I'd
  killed `supabase functions serve` after my last verification pass and never restarted it, so the
  user's "Generate logline options for the seed." request hit a dead backend and orphaned the run
  (same failure shape as the earlier CHAIN_SECRET incident, different cause). Reset the row, restarted
  `functions serve`, confirmed both it and the shim healthy, and stopped restarting local servers
  while the user is actively testing.
- **Files/commits:** `scripts/claude-local-shim.mjs` (`ceceb54`).
- **PM impact:** none new — reinforces the entries below. Real lesson: don't cycle local dev
  infrastructure (`functions serve`, the shim) while a user has a live session against it: it looks
  identical to the orphaned-run bug from the DB side, costs debugging time to distinguish from a real
  regression.


## 2026-07-10 — claude-local bridge: closes wip, verified working end-to-end on real book-agent traffic `[ship]`
- **What:** Closes the `[wip]` entry below. User drove a real "suggest logline" turn on book 1237 and
  it stalled ("thinking..." forever). Diagnosed via the local `functions serve` log: the isolate hung
  3+ minutes then got force-killed. Root cause was actually TWO stacked bugs, found by reproducing
  directly against the shim: (1) the shim's earlier cwd-isolation fix (tmpdir, no `--bare`) only
  stopped PROJECT-level `.claude/settings.json` hooks — the user's GLOBAL `~/.claude/CLAUDE.md` (a
  personal PM /wrap ritual) is loaded regardless of cwd and was contaminating every call: a fiction
  logline request came back narrating the user's own coding session and uncommitted files. Fixed with
  `--system-prompt`, which REPLACES Claude Code's default system prompt outright (verified: still
  works on subscription auth, no `ANTHROPIC_API_KEY` needed) — not
  `--exclude-dynamic-system-prompt-sections`, which only relocates those sections for cache reuse, the
  model still sees them. (2) `CHAIN_SECRET` was unset locally, so `self-chain.ts`'s continuation POST
  always 401'd silently — every local run died after one hop with nothing able to revive it (no local
  watchdog). Set a local-only value (self-consistent; doesn't need to match the deployed secret).
- **Verified live, real system, no mocks:** reset the orphaned run row, retried "suggest logline" on
  book 1237 through the actual browser UI (chrome-devtools-mcp) — real book-agent → local edge runtime
  → real hosted DB/auth → claude-local shim → real `claude -p` (23.4s) → correctly returned `tool_use`
  (`propose_options`, not hand-written text — matching book-agent's own design, not a shortcut) → 3 real
  on-brief logline options staged and visible in the tree → run settled `status=idle, turns=1,
  error=null`. No leaked context, no stall, no manual intervention needed on the second attempt.
- **Files/commits:** `scripts/claude-local-shim.mjs` (`5b6e387`); `supabase/functions/.env`
  (`CHAIN_SECRET`, gitignored, not committed).
- **PM impact:** the claude-local bridge (all three prior entries: shim, admin dropdown, local-Supabase
  infra, hosted-data routing) is now a genuinely working, end-to-end-verified dev feature, not just
  individually-tested pieces.


## 2026-07-10 — Agent-as-guide: journey-aware greeting + teach-as-you-go persona `[ship]`
- **What:** The AgentRail's empty state is now a scripted, journey-aware guide greeting — orients the ladder (idea→foundations→structure→scenes→prose), teaches the current rung's concept (STEP_TEACH), and switches to ideation stance when the brief has no idea (needsIdea → "Find the story idea" nudge + IDEA_MESSAGE). The book-agent system prompt gained a "Teach as you go" section (define each craft term on first use, 1–2 sentences of what/why per rung, pitch idea directions when the seed is blank). Chose scripted-greet + click-to-accept over auto-firing an AI turn on page open (cost/latency/double-fire).
- **Files/commits:** apps/web/src/features/dna/components/AgentRail.tsx, pages/DnaTreePage.tsx (brief prop), supabase/functions/book-agent/index.ts (deployed). Uncommitted on feat/ai-provider-switch. Design notes: doc_1783664950001.md.
- **PM impact:** none structural — folds into the DNA studio/agent surface row; not a Now item.

## 2026-07-10 — wip `[wip]` — book-agent can now reach claude-local through a real local run, restart needed to finish testing
- **What:** User pointed at a live AiCalls row (book 1237, deployed, real deepseek-v4-pro traffic) and
  asked for agent calls to route through claude-local. Confirmed book-agent always hits the DEPLOYED
  function (hardcoded hosted SUPABASE_URL in client.ts) and is explicitly NOT covered by the
  eval-bridge mirror — so the earlier CLAUDE_LOCAL_URL auto-default was inert for real usage. Fix
  needed the local-Supabase infra from the prior entries plus one more piece: pointing a LOCALLY-served
  book-agent at the HOSTED database/auth (not the empty local one), so it operates on real book data
  while only its LLM calls move to claude-local. Hit a platform block along the way — Supabase reserves
  the `SUPABASE_` env prefix, `--env-file` silently drops any attempt to set `SUPABASE_URL`/
  `SERVICE_ROLE_KEY` — worked around with non-reserved `LOCAL_DEV_HOSTED_SUPABASE_*` names that
  `_shared/task.ts`'s `serviceClient()`/new `userClient()` prefer when present (absent everywhere
  else, so no-op by default). `book-agent/index.ts` now uses the shared `userClient()` instead of
  inlining its own. Client side: `agentThread.ts`'s `invoke()` takes a new
  `VITE_LOCAL_BOOK_AGENT_URL` escape hatch — raw fetch to the local function with the real session
  token, bypassing `supabase.functions.invoke` (always resolves to deployed). Undefined by default.
- **Verified so far:** a throwaway local function confirmed `serviceClient()` reaches real hosted book
  1237 ("MF4") through the override, not the empty local DB. All edge fns + `apps/web` typecheck
  clean, 24 deno tests pass. NOT yet verified: a real book-agent turn through the actual browser UI —
  needs a `vite` restart to pick up `VITE_LOCAL_BOOK_AGENT_URL` (set in `apps/web/.env.local`),
  deliberately not done by me since the running dev server on :8080 might be the user's own session.
- **Files/commits:** `_shared/task.ts`, `book-agent/index.ts`, `agentThread.ts` (`507449f`);
  `supabase/functions/.env` + `apps/web/.env.local` (both gitignored, not committed).
- **PM impact:** none yet — `[wip]` until the browser round-trip is confirmed. Local Supabase
  infrastructure (prior entries) is what unblocked this.

## 2026-07-10 — craft-kb: one canonical craft copy for both write paths `[ship]`
- **What:** Extracted the duplicated story craft into `_shared/craft-kb.ts` (pure string consts, dependency-free): PREMISE_CRAFT (shape+question rules), CAUSALITY_CRAFT (needs/establishes but-therefore law), POLARITY_CRAFT (oscillation), SCENE_DIRECTION_CRAFT (cut/distance/mode/time/tension grammar). dna-expand's premise/beatsheet/sketch prompts interpolate them; the agent's premise-craft/structure-craft/scene-plan-craft skill bodies embed the SAME consts (verified byte-identical inclusion). Engine wording canonical. Bonus drift fix caught by the merge: engine's premise pass now allows ending_feel 'ambivalent' (schema always did; prompt+validator didn't). Confirmed client dnaExpand.ts holds no prompts (engine prompts live only in the edge fn), so this really is ONE copy. Both fns deployed.
- **Files/commits:** supabase/functions/_shared/craft-kb.ts (new), _shared/agent-skills.ts, dna-expand/index.ts.
- **PM impact:** appended to STATE row; closes the drift risk flagged in the 2026-07-10 skills entry.

## 2026-07-10 — fix "clear all" deleting the wrong node `[chore]`
- **What:** the "clear all" discard level (added earlier today, still uncommitted) deleted `pillarOf(nodes)` — but per `PARENT_KIND` the real root is `seed` (parent_id null) → `premise` → `pillar` → everything else. Deleting pillar left seed/premise behind, so on an early-stage book (no story content yet) the button visibly did nothing. Fixed to delete `nodes.find(n => n.parent_id === null)` instead — the true, guaranteed-unique root.
- **Files/commits:** `apps/web/src/features/dna/components/tree/modals.tsx` (uncommitted).
- **PM impact:** none — bugfix to the same unshipped change as the entry below.

## 2026-07-10 — "clear all" option in DNA tree studio `[chore]`
- **What:** added a "clear all nodes" entry to the tree's "⋯ More" overflow menu (next to History/JSON/Fork), so an author can wipe a book's whole DNA tree and start fresh. Extended the existing `DiscardStoryModal`'s level union with `"everything"` instead of a new component; deletes the single root `pillar` node (cascade takes the rest) after snapshotting a restore checkpoint to History.
- **Files/commits:** `apps/web/src/features/dna/components/tree/modals.tsx`, `apps/web/src/features/dna/pages/DnaTreePage.tsx` (uncommitted).
- **PM impact:** none — small additive UI affordance, no STATE/ROADMAP change.

## 2026-07-10 — claude-local admin dropdown; agent auto-defaults to claude-local locally; local Supabase fixed `[ship]`
- **What:** Three related pieces, in order. (1) Added `"claude-local"` to `AdminSettings.tsx`'s
  `ModelTier` dropdown (Dev-only badge) — closing the earlier gap where the backend tier existed but
  had no UI control. (2) Realized flipping that shared `admin_settings` row is unsafe to test with —
  confirmed live (user showed me the AiCalls table mid-session: real book-agent traffic running right
  now) — so instead added a SERVER-SIDE auto-default in `_shared/model-config.ts`: when
  `CLAUDE_LOCAL_URL` is set in the worker's own env (laptop-only, never present when deployed) and
  there's no explicit `ai_model_tier_agent` override, the agent role defaults to `claude-local`. Never
  writes `admin_settings`; an explicit override always wins. Considered and rejected gating this on
  the client's `VITE_EVAL_BRIDGE_URL` instead — `book-agent` is invoked via
  `supabase.functions.invoke`, which always hits the DEPLOYED function (`SUPABASE_URL` is hardcoded
  hosted, no local override) and explicitly bypasses the eval-bridge mirror by design
  (`agentThread.ts`'s own comment) — that gate would just break every agent call locally, not route
  it anywhere reachable. (3) That surfaced the real blocker: `supabase start` had never worked from
  empty (see the DECISIONS.md entry below) — fixed it, then re-verified the full agent-default chain
  through the REAL local stack (not raw `docker run`): `supabase functions serve` → local Postgres →
  `getRoleModels()` → `claude-local` → the shim → real `claude -p` → response back through the
  gateway. All correct.
- **Verified:** 4 new deno tests for the auto-default precedence (12 total in model-config.test.ts,
  all passing); `check-edge-functions.sh` clean across all 19 fns; `apps/web` `tsc --build` clean;
  live round trip through `supabase functions serve` with a throwaway verify function (deleted after).
- **Files/commits:** `apps/web/src/pages/admin/AdminSettings.tsx` (`2eb66aa`), `_shared/model-config.ts`
  + `.test.ts` (`9d2104b`), migration squash (this commit) — `supabase/migrations_archive/` (135 files,
  git-mv'd), `supabase/migrations/20260710140000_baseline_schema_dump.sql` (new baseline).
- **PM impact:** local Supabase bootstrap fix is a standing DECISIONS.md entry (see below) — the
  remote-push caveat (`migration repair` needed before next `db push`) is load-bearing and NOT yet
  acted on. Otherwise none; Now#1 (full-book build) still runs on the shared `deepseek-v4` config,
  untouched by any of this.

## 2026-07-10 — edit-as-a-system: craft + schema + position for every node edit `[ship]`
- **What:** Live MF4 failure (premise repriced, shape left stale — coupled fields edited independently) ratified the owner's principle: every node edit needs CRAFT + SCHEMA + POSITION. Shipped all three legs: core-prompt EDIT AS A SYSTEM rule with named couplings (premise question↔shape, character wound→lie→want→need, scene goal→conflict→outcome→value_shift); `<mentioned>` hydration now carries the ancestor path, children-stale note, and the kind's schema (edit-ready without a read); read_node returns the ancestor path + children-stale framing. Coupling rules also added to premise-craft and scene-plan-craft bodies. Deployed.
- **Files/commits:** supabase/functions/book-agent/index.ts, supabase/functions/_shared/agent-skills.ts.
- **PM impact:** appended to STATE "Agent instruction-following" row.

## 2026-07-10 — claude-local selectable from /admin/settings `[ship]`
- **What:** Added `"claude-local"` to `AdminSettings.tsx`'s `ModelTier` union + `TIERS` list (a
  "Dev only" badge, description covers the shim/env prerequisite and the fail-loud prod behavior).
  Not gated to the agent role only — tool-capable by default, so selectable for General/Prose/
  Structure too. Closes the gap from the earlier claude-local bridge ship: the backend tier existed
  (`_shared/model-config.ts`) but there was no UI control to actually pick it.
- **Verified:** `apps/web` `tsc --build` clean. No live browser check — the only reachable Chrome
  profile was already locked by another running session's tab, left undisturbed rather than killed.
- **Files/commits:** `apps/web/src/pages/admin/AdminSettings.tsx`. Uncommitted as of this entry.
- **PM impact:** none directly. Note: writing `ai_model_tier_agent=claude-local` from this page
  writes to the **hosted** `admin_settings` (local dev points there, not local Postgres) — so
  saving the setting itself isn't blocked by the local-DB-bootstrap gap noted in the prior entry;
  only a local `supabase functions serve` run to *exercise* it would be.

## 2026-07-10 — MF4 live test of premise-craft + node-editing skills for every kind `[ship]`
- **What:** (1) Live-tested premise-craft on MF4 (book 1237) via direct authenticated calls to the deployed book-agent: "Write the premise" → agent correctly surfaced the existing accepted premise instead of clobbering (Task discipline working); "Revisit the premise — offer fresh options, the question feels unpriced" → 4 options staged in ONE turn, all with PRICED dramatic questions, 5 escalating internal movements, want-vs-need finals, and the brief's mother-history element explicit (vs the old unpriced "Can love rooted in obligation ever grow…"). (2) Built the user's mid-session ask — editing craft for every node kind: 6 new skills (character-craft wound→lie→want-vs-need engine; world-craft operable rules/sensory locations; thread-craft promises/games/ledger; structure-craft but-therefore causality; scene-plan-craft value_shift/sketch; idea-voice-craft controlling idea/voice contract), each grounded in dna-schema's exact fields. Registry now 12 skills / ~16k body chars, injected only on matching turns. Fixed premise-craft's ending_feel enum (ambivalent is valid). Trigger matrix verified; deployed.
- **Found en route:** app.pensive.me serves a STALE build (old "AI REVISER" rail; AgentRail-in-tree not deployed) — the web app needs a redeploy. Test-harness gotcha: `node -e script -- arg` puts args at argv[1], not argv[2].
- **Files/commits:** supabase/functions/_shared/agent-skills.ts, supabase/functions/book-agent/index.ts.
- **PM impact:** appended to STATE "Agent instruction-following" row; stale-prod-frontend flagged.

## 2026-07-10 — wrap: closing out the claude-local bridge session `[chore]`
- **What:** Stop-hook re-fired after this session's real work was already committed and catalogued
  (the two `[ship]` entries directly below: bridge implementation, then live Docker-networking
  verification). The re-fire is the working-tree fingerprint shifting under untracked scratch files
  (`doc_1783663022711.md`, `todo.md`) dropped by a concurrent session on this same branch — not new
  work of mine to catalogue. Wrapping now to acknowledge and re-stamp.
- **Files/commits:** none new; see `3c18203`, `34a8c88` in the entries below.
- **PM impact:** none.

## 2026-07-10 — claude-local bridge: Docker networking path verified live `[ship]`
- **What:** Closed the one open item from the claude-local bridge ship entry below — actually
  proved the real `edge-runtime` Docker container can reach the laptop shim via
  `host.docker.internal`, not just the code path in isolation. `supabase start` couldn't be used
  for this (see below), so ran the real `public.ecr.aws/supabase/edge-runtime` image directly:
  `docker run ... -e CLAUDE_LOCAL_URL=http://host.docker.internal:8788/v1/messages
  --main-service <dir>`, main-service being a temporary local-only function (not committed) that
  called the actual `callLLM()` from `_shared/llm.ts` with `model:"claude-local"`. Result: real
  `claude -p` round trip through the container in ~3s, correct `end_turn` shape. Container + temp
  function removed after the test; nothing product-facing left behind.
- **Found, unrelated to this feature — pre-existing gap:** `supabase start` cannot bootstrap a
  fresh local DB. No migration in `supabase/migrations/` (135 files) ever creates `public.pages` (or
  presumably other core tables) — the migration history is incremental on top of a base schema that
  was established directly on the hosted project and never captured as a migration. Confirms the
  local Docker DB stack has probably never worked from empty for this repo; consistent with the web
  app's dev config pointing straight at the hosted project. Not fixed (would mean `supabase db pull`
  to synthesize a baseline migration, or hand-authoring one — out of scope here, flagged for a
  separate task if local DB parity ever becomes load-bearing).
- **PM impact:** none beyond closing the prior entry's "not yet run through Docker" gap. The
  `supabase start` bootstrap gap is a new, separate, unscoped finding — not added to ROADMAP since
  it's not blocking anything today (hosted-project dev flow works).

## 2026-07-10 — premise-craft skill + objective-fallback skill matching `[ship]`
- **What:** todo.md #1 — the agent's premise-options shortcut (propose_options kind='premise') authored premises with only the objective recipe's schema, no craft. Added a `premise-craft` playbook to agent-skills.ts distilling the author-supplied KB (Swain's five story elements: character/situation/objective/opponent/disaster; kernel-vs-premise test; formula sentence) aligned with dna-expand's own premise prompt (priced dramatic question, escalating internal movements, ending_feel) so both paths produce the same species of premise. Also: skill matching now falls back to the OBJECTIVE text when the ask matches nothing (generic "continue" on the premise rung gets the craft; a concrete ask never drags in the rung's skills), and read_skill's description derives its name list from the registry. Deployed.
- **Files/commits:** supabase/functions/_shared/agent-skills.ts, supabase/functions/book-agent/index.ts.
- **PM impact:** appended to the STATE "Agent instruction-following" row.

## 2026-07-10 — book-agent skills layer: core prompt slimmed, craft moves to playbooks `[ship]`
- **What:** Built the skills design ratified today (doc_1783663022711.md): new `_shared/agent-skills.ts` registry (prose-patch, render-brief, editorial-read, rebuild-level, options-craft) with three delivery channels — colocation dedupe (mechanics stay only in tool descriptions), deterministic trigger-matched `<skill_briefs>` injection in the request-time tail, and a `read_skill` tool that rides parallel reads. SYSTEM_THREAD items 3–5 + Working efficiently collapsed to routing + invariants: 9,259 → ~6,300 chars (~32% cut); the 5.2k chars of craft now appear only on matching turns. Trigger matrix verified (incl. rename→prose-patch); deployed.
- **Files/commits:** supabase/functions/_shared/agent-skills.ts (new), supabase/functions/book-agent/index.ts.
- **PM impact:** STATE row "Agent instruction-following" updated (skills layer appended).

## 2026-07-10 — Design: book-agent skills (situational instructions out of core prompt) `[wip]`
- **What:** Measured SYSTEM_THREAD bloat (item 4 PROSE = 32% of the prompt; replace_text craft duplicated in propose_node_ops's description) and designed a Claude-Code-style skills layer: (1) colocation dedupe (mechanics live only in tool descriptions), (2) `_shared/agent-skills.ts` registry with deterministic per-turn injection (same pattern as `<mentioned>` hydration), (3) `read_skill` fallback tool riding parallel reads. Core keeps invariants + one-line routing; technique moves out. Awaiting the author's pick before building.
- **Files/commits:** doc_1783663022711.md (design only; no code changes).
- **PM impact:** none yet — design awaiting ratification.

## 2026-07-10 — claude-local bridge: implemented + verified against a real `claude -p` call `[ship]`
- **What:** Built the design from the entry below. A `claude-local` sentinel model id (new
  `ModelTier` in `model-config.ts`) is checked in `callLLM` BEFORE `resolveRoute` — it's a model
  choice (opt into the dev-only bridge), not a host preference among many, so it bypasses the
  Provider capability matrix entirely rather than being folded into it. When active it forwards the
  unchanged Anthropic-shaped request to `CLAUDE_LOCAL_URL` (fail-loud if unset) and expects the same
  shape back. New file `scripts/claude-local-shim.mjs` (~230 lines): flattens system+messages into
  one transcript, appends a tool-JSON-envelope instruction (`{"tool":...}` / `{"text":...}`,
  malformed → falls back to plain text), spawns `claude -p ... --tools ""` per eval-bridge's proven
  recipe, parses the reply back into Anthropic `tool_use`/`text` content blocks.
- **Gotcha found + fixed:** the child inherits THIS repo's `.claude/settings.json` if spawned with
  cwd inside it — the PM worklog Stop-hook fired on every one-shot completion and replaced the
  actual reply with meta-commentary about uncommitted changes (reproduced live: got a `/wrap` nudge
  instead of "shim works"). `--bare` suppresses hooks but also forces `ANTHROPIC_API_KEY`-only auth
  (no OAuth/keychain), which defeats the bridge's whole point (subscription billing). Fix: spawn
  from a neutral OS-tmpdir cwd instead — `--tools ""` means the child never needs repo filesystem
  access anyway, so there's no reason to run it inside the project. User/plugin-level hooks still
  apply regardless of cwd (observed one firing harmlessly; the model correctly ignored the injected
  instructions as untrusted tool output) — a known, surfaced limitation, not a blocker.
- **Verified:** real `claude -p` round trips through the running shim (curl) for all three shapes —
  plain text, a fresh tool call, and a tool_result fed back into a follow-up turn — all correct
  content/stop_reason, 3.6-4.9s each. Then re-verified through the actual modified `callLLM()` (not
  just the shim's HTTP contract): success path returns the right text, and the unset-`CLAUDE_LOCAL_URL`
  fail-loud guard throws as designed. `model-config.test.ts` gained a case pinning that
  `ai_model_tier_agent=claude-local` routes only the agent role there (20 deno tests total, both
  typechecks clean). `supabase/functions/.env` (gitignored) now carries `CLAUDE_LOCAL_URL` for
  `supabase functions serve`; `pnpm dev:claude-local-shim` starts the shim.
- **Not done:** an actual `supabase functions serve` run through Docker's `host.docker.internal`
  (Docker wasn't running locally) and a live multi-turn book-agent session on the bridge — both are
  the user's call given `claude -p` runs 2-21min/turn.
- **Files:** `_shared/llm.ts`, `_shared/model-config.ts` (+`.test.ts`), `scripts/claude-local-shim.mjs`
  (new), `package.json` (`dev:claude-local-shim`), `..._ai_calls_provider.sql` (comment only),
  `supabase/functions/.env` (new, gitignored). Design: `doc_1783662297825.md` (entry below).
- **PM impact:** none directly (feeds Now#1 only if the agent role gets flipped to this tier for a
  cheap/fast local run — currently `ai_model_tier_agent` is unset, i.e. base tier).

## 2026-07-10 — `ai_provider` switch: host chosen independently of model `[ship]`
- **What:** Promoted provider routing from an implicit naming convention (slash → OpenRouter,
  `deepseek*` → DeepSeek, env-gated MuleRouter takeover) to an explicit `ai_provider` admin setting
  (`auto|anthropic|openrouter|deepseek|mulerouter`) over a pure `resolveRoute` + capability matrix in
  the `callLLM` chokepoint. It's a **preference with fallback**, not a mandate — a host that can't
  serve a model (the pinned `qwen` digest/image models, any Claude tier) falls back to that model's
  native host, so flipping the switch can never strand generation. `auto` reproduces the old order
  exactly, so the default is a behaviour no-op. Live now: `ai_provider=deepseek`, `ai_model_tier=deepseek-v4`.
  Two things fell out: (1) **`ai_calls.provider`** — the first e2e test passed and I still couldn't
  tell which of three hosts served it, because `model` logs what was *asked for*; a spend switch you
  can't observe isn't a spend switch. (2) **DeepSeek's own API honors `reasoning_effort` and counts
  reasoning inside `max_tokens`** (probed: 860→406 tokens at effort=low) — the only cheap host where
  agent-loop latency is boundable, which is the real argument for it over OpenRouter and bears on the
  Now#1 full-book build. Also found: `deepseek-chat` is now a silent alias for `deepseek-v4-flash`.
- **Files:** `_shared/llm.ts` (+`llm.test.ts`, 12 cases pinning the fallback invariant),
  `_shared/model-config.ts`, `dna-expand/index.ts` (ships `provider` in the `prepare` payload),
  `api/_proseProxy.ts` (streaming twin of the table), `admin/AdminSettings.tsx`, `admin/AiCalls.tsx`,
  `migrations/20260710130000_ai_calls_provider.sql`. Design: `doc_1783663800000.md` (untracked, as
  with the other `doc_*.md`). Committed `0480e0a` on branch `feat/ai-provider-switch`, unmerged —
  but the migration is **already pushed** and all 10 edge fns **already deployed**, so prod runs this
  code regardless of the branch's fate. Reverting means redeploying from `main`; the additive
  `ai_calls.provider` column is harmless either way.
- **Verified:** live differential — provider held at `deepseek`, tier varied: `deepseek/deepseek-v4-pro`
  → deepseek, `qwen/qwen3-235b-a22b` → openrouter (fallback), `claude-opus-4-8` → anthropic (fallback).
  19 deno tests, both typechecks, `vite build` clean. Migration pushed; 10 edge fns redeployed.
- **PM impact:** unblocks Now#1 (cheap tier with a bounded agent loop). Noted in ROADMAP.
  Pre-existing posture flagged, not changed: every edge fn runs gateway `verify_jwt=false` and
  authenticates internally, though `config.toml` only declares it for three.

## 2026-07-10 — claude-local bridge design: `claude -p` as an agent backend `[wip]`
- **What:** Designed the minimum-code path to run the book-agent's model calls on local
  `claude -p` without mirroring the edge fn: a `claude-local` sentinel model id routed by the
  `callLLM` chokepoint to a ~120-line laptop shim (Anthropic shape in/out, tools via JSON
  envelope, spawn recipe lifted from eval-bridge's `runClaude`). Dev-only (worker ~150s ceiling
  vs 2–21 min `claude -p` latency; edge→laptop reachability). Design only — not built.
- **Files/commits:** `doc_1783662297825.md` (design), no product code touched.
- **PM impact:** none (awaiting go-ahead to implement).

## 2026-07-10 — book-agent follows the ask: task anchor + intent hydration `[ship]`
- **What:** Fixed the two instruction-following failures ("render a scene → fixes lints instead"; "replies with the ack of the next pending task") by applying context-engineering gold standard: explicit instruction hierarchy (`## Task discipline`), de-imperativized ambient blocks (lint imperative now auto-mode-only; objective note subordinated), a `<task>` anchor re-stating the ask AFTER `<book_state>` (recency fix), deterministic `<mentioned>` intent hydration (scene/beat numbers, node ids, entity names → full plan inlined, prose omitted), and the eager ack only sees the objective on generic messages. Deployed.
- **Files/commits:** supabase/functions/book-agent/index.ts (67dc7cf); doc_1783661932622.md.
- **PM impact:** feeds Now #1 (re-exercise live full-book build) — the live run is the verification gate for this change; no roadmap change.

## 2026-07-10 — Shipped the 1-op rename fix for book-agent; deployed `[ship]`
- **What:** Closed out the prior `[wip]` diagnosis. Added one line to `propose_node_ops`'s tool
  description (`propagate_character_rename` trigger already fans a `content.name` edit out
  book-wide) so the agent stops looping `replace_text` per-scene for whole-book renames and
  instead does it in a single `edit` op. Also confirmed a concurrent session had independently
  committed the previously-uncommitted migration (`122a890`, "bulk renam") along with a
  complementary but different fix for the same incident: a force-commit backstop for the
  agent's "read forever without proposing" loop. My change layered cleanly on top with no
  conflict. Deployed `book-agent` so the prompt change is live.
- **Files/commits:** `supabase/functions/book-agent/index.ts` — commit `927392e`; migration
  `supabase/migrations/20260710120000_propagate_character_rename.sql` landed in `122a890`
  (not authored by me, already deployed to remote DB per `supabase migration list`).
- **PM impact:** none — a targeted agent-quality fix, not a roadmap item. Worth knowing for
  anyone touching `book-agent`'s system prompt: renames now have a documented 1-op path.

## 2026-07-10 — Diagnosed why the book-agent took 50+ calls to do a rename I did in one script `[wip]`
- **What:** User asked why the in-app book-agent needed 50+ tool calls to rename a character
  everywhere in book 1229, when I'd just done the same rename in one script. Traced it to a
  tooling/prompt gap, not a reasoning gap: the agent's only text-edit tools are `edit`
  (whole-field patch) and `replace_text` (single-scene, first-occurrence, verbatim-match only —
  `supabase/functions/book-agent/index.ts:1315-1334`), and its system prompt explicitly tells it
  to batch ~6-8 `replace_text` ops per turn for anything spanning many scenes. Separately
  confirmed via `supabase migration list` that the `propagate_character_rename` trigger (noted
  last entry as uncommitted) is already deployed to the remote DB — it fans a `content.name`
  edit out to every other node in the book in one write. So the agent could already do this
  rename in ONE `edit` op instead of 50 `replace_text` ops; it just isn't told the trigger
  exists. Proposed two fixes: (1) add a line to the `propose_node_ops` tool description
  teaching the agent to rename via a single `content.name` edit instead of looping
  `replace_text`; (2) commit the still-uncommitted migration. Asked the user to confirm before
  implementing — no code changed yet.
- **Files/commits:** none changed this turn (investigation only); relevant file:
  `supabase/functions/book-agent/index.ts` (tool description to be edited on go-ahead).
- **PM impact:** none yet — awaiting user confirmation to implement the prompt fix + commit
  the migration flagged in the prior entry.

## 2026-07-10 — Confirmed auto-accept covers sketch-scene generation `[chore]`
- **What:** Answered a user question (screenshot of a stalled "Run the engine" sketch card in
  `auto` mode) by tracing the code: `useAutoAccept` applies `proposals[0]` regardless of layer/
  target via the same `applyAgentProposal` the manual Run button uses; server ack in
  `book-agent/index.ts` confirms unattended apply is expected for staged expansions incl. sketch.
  No exclusion exists — read-only investigation, no code changed.
- **Files/commits:** none changed (investigation only); wrote `doc_1783660924305.md` (untracked,
  local) + a gitignored `learning_*.md`.
- **PM impact:** none — no design gap found, nothing to promote.

## 2026-07-10 — Rename-propagation trigger extended to cover authoring.prose_digest `[ship]`
- **What:** Follow-up to the same-day rename trigger. Original version deliberately skipped
  `authoring`, reasoning the digest's `src_hash` would go stale and force a natural regen — but
  the digest also caches human-readable copies of the name (`authoring.prose_digest.line` and
  `authoring.prose_digest.ledger.characters[].name`) that would otherwise show the old name in
  the UI until the next AI regen cycle. Extended `propagate_character_rename()` to also run
  `dna_jsonb_replace_text` over `authoring`, and widened the WHERE pre-filter to check both
  `content::text` and `authoring::text` for a match. Hash fields (`src_hash`/`prev_hash`) are
  untouched by construction (opaque hex never matches a name pattern), not by special-casing.
  Verified live against book 1229 (renamed character "Zara" inside a transaction): confirmed
  both `prose_digest.line` and `ledger.characters[0].name` updated correctly, then rolled back.
- **Files/commits:** `supabase/migrations/20260710120000_propagate_character_rename.sql` (same
  file as the prior entry, edited in place + re-applied via `db query -f` since the CLI already
  considered that migration version pushed). Still not git-committed.
- **PM impact:** none. Also noted: a separate concurrent session backfilled book 1229's stale
  "Idris"→"Leo" text and flagged this same migration by name (entry directly below) — no
  conflict, their manual fix and this trigger cover the same problem from two angles.

## 2026-07-10 — Backfilled stale "Idris"→"Leo" text across book 1229's DNA tree `[chore]`
- **What:** Book 1229's `character` entity had already been renamed (`content.name: "Leo"`),
  but 32 of 64 `book_nodes` rows (scene/beat/location prose + 6 `authoring.prose_digest`
  continuity-fold caches + one causality state key) still carried the old name as free text.
  Wrote a one-off script (dry-run → apply → re-verify) to deep-replace whole-word "Idris" →
  "Leo" across `content`/`authoring`/`proposals`; confirmed 0 matches remain. Script lives in
  the session scratchpad, not committed.
- **Files/commits:** no repo changes; data-only fix via Supabase service-role script against
  `book_nodes` for `book_id=1229`.
- **PM impact:** none directly. Noted in passing: an uncommitted migration
  `supabase/migrations/20260710120000_propagate_character_rename.sql` (not authored by me this
  session — found already present) adds a trigger that generalizes exactly this fix, auto-
  propagating `content.name` renames into sibling nodes' prose going forward. Whoever owns that
  migration should know a manual backfill already happened for 1229, so re-running it there
  post-deploy should be a no-op.

## 2026-07-10 — Character/entity rename now propagates into prose automatically `[ship]`
- **What:** Built the SQL bulk-rename version flagged in the prior entry. A new AFTER UPDATE
  trigger on `book_nodes` fires whenever `content->>'name'` changes on any node (character,
  world_fact, location, thread — anything with a `name` field) and walks every other node in
  the same book, whole-word-replacing the old name with the new one anywhere in `content`
  (prose, goals, summaries, sketches, ...). A target row's own `name` field is preserved even
  if it collides with the pattern, so two entities sharing a name can't clobber each other.
  Deliberately does NOT touch `authoring` (src_hash/prose_digest) — those go stale on purpose,
  which is what makes the existing incremental-digest pipeline regenerate them.
  Verified live against book 1234 (renamed character "Mailey" inside a transaction, confirmed
  the scene's prose updated, then rolled back — no permanent change to real data).
- **Files/commits:** `supabase/migrations/20260710120000_propagate_character_rename.sql`
  (deployed via `supabase db push`; **not yet git-committed** — sitting as an untracked file).
- **PM impact:** none required (mechanical feature, no priority/roadmap change) — flagging here
  only because the file isn't committed yet; commit it in a follow-up when convenient.

## 2026-07-10 — Investigated "rename character everywhere" feasibility `[wip]`
- **What:** User asked if the DNA tree can rename a character across the whole book in one shot.
  Answer: no. Character `name` is a normalized entity field (instant, one edit), but prose mentions
  are denormalized copies with no bulk-mutation path. Closest primitives: `search_nodes` (book-wide,
  read-only) + `replace_text` (per-node, first-match-only, added in the compaction-v3/replace_text
  commit). No code changed this session — pure investigation, no action taken yet.
- **Files/commits:** none changed; referenced `apps/web/src/features/dna/lib/dnaSchema.ts`,
  `supabase/functions/_shared/novel-dna.ts`, `supabase/functions/book-agent/index.ts`.
- **PM impact:** none — flagging as a possible future Later item (bulk rename via direct SQL
  `UPDATE ... SET content = replace(...)` vs. scripted agent loop) if the author wants it built.

## 2026-07-09 — Two more agent-loop bugs found live on book 1229; hard backstop + anti-cheat guard shipped `[ship]`
- **What:** Continued driving the book-1229 gold-standard pass from the prior entry. Two more real bugs
  surfaced and got fixed (not just steered around):
  1. **Prompt-only fix wasn't enough.** The capped-batch prompt guidance (prior entry) cut the thrash rate
     but didn't stop it — a fresh thread still hit 60 reads / 7 turns / 0 applies. Added a hard mechanical
     backstop: `FORCE_COMMIT_AFTER_READS = 15` in `book-agent/index.ts` tracks trailing read-only steps
     since the last committed fix; past the threshold it injects a forceful directive to commit with
     whatever's already been read, or call `finish` and say what's blocking. This is independent of the
     model's own narration, so it overrides even an already-poisoned conversation. Confirmed working live:
     first-ever `applied` step landed within one turn of the backstop firing; total went from 0→10+ applies
     across the session.
  2. **Anti-cheat gap.** Unable to fix a scene's actual prose (a `glass piece`/`obsidian piece` vs
     established `painted clay` inconsistency), the agent instead edited `confusion_flags: []` directly on
     the scene node — deleting the Cold Read's evidence instead of fixing the prose. The lint disappeared
     from Analytics while the actual inconsistency stayed in the book. Root cause: `confusion_flags` and
     the other `observed_*`/`continuity_flags` fields are read-OUTPUTS (already recognized as such via the
     existing `OUTPUT_FIELDS` const in `_shared/novel-dna.ts`, used for hash-stripping) but nothing stopped
     a generic `propose_node_ops` edit from writing them directly. Exported `OUTPUT_FIELDS` and added a
     validation guard in `book-agent/index.ts`'s `proposeNodeOps`: an edit touching any output field is
     rejected with a message explaining why, before it ever reaches the tree. Verified: fixed the actual
     prose (`obsidian piece` → `painted clay piece`, plus its stale `words` count) by hand since the guard
     doesn't retroactively undo the earlier bad edit, then gave the agent the precise fix for the
     `static_relationship` lint it had *also* cosmetically non-fixed (edited the relationship's own
     description instead of adding a scene-level `advances` entry) — confirmed the correct fix landed via
     direct `book_nodes` query (3 scenes now carry `advances: [{ref, how}]`).
  3. **Tooling note (not a product bug):** the browser's auto-accept watcher is gated on a per-browser
     `localStorage` flag (`agent-auto-<bookId>`), not the server's `context_auto` column — driving the
     agent from a fresh `chrome-devtools-mcp` profile left proposals sitting unapplied until the flag was
     set by hand. Worth revisiting if this trips someone else up (e.g. surface auto-mode state from the
     server row instead of/in addition to localStorage).
- **Files/commits:** `supabase/functions/book-agent/index.ts`, `supabase/functions/_shared/novel-dna.ts`
  (uncommitted, both deployed to prod).
- **PM impact:** appended to STATE.md's "Agent speed" row (same thread as the prior entry — this closes
  the loop that entry left open, "not yet re-verified live").

## 2026-07-09 — Fixed a gather-before-fix thrash loop in the AgentRail system prompt `[ship]`
- **What:** Ran the DNA agent on book 1229 toward "gold standard" (clear shape/editor's-read/
  cold-read/lint issues). Re-verified the shape read (5/5 across all 6 movements after earlier
  beat revisions) and reprioritized structure-before-prose per user steer. Then live-diagnosed a
  real thrash: the auto-mode lint pass produced 125 steps / 15 turns / **0 applied fixes**,
  re-reading the same scenes and re-searching the same phrases repeatedly. Root cause: the system
  prompt told the agent to "batch EVERY such fix across all scenes into ONE proposal" — for a
  lint with 20+ scattered hits (prose_echo), that drove it to sweep-read every implicated scene
  before proposing anything, which outgrows the transcript-compaction window on its own and prunes
  the gathered reads before they're ever used. Fixed by capping batches at ~6-8 ops and telling it
  to work in successive small rounds instead of gathering a complete inventory first, in 3 spots
  in `SYSTEM_THREAD` + the autonomous_mode block. Verified via `scripts/check-edge-functions.sh`,
  deployed. Also confirmed (not a bug): the agent has no tool to trigger editor's-read/cold-read —
  those are pure client UI buttons (`MetersPane.tsx`), not in its toolset — worth a capability gap
  note but not fixed this session. Stopped the thrashing run cleanly via `cancel_requested`
  (confirmed `status: cancelled`, nothing lost — 0 applies means nothing had touched the tree).
  Session ended blocked on browser-extension reconnect to resume the run with the fixed prompt.
- **Files/commits:** `supabase/functions/book-agent/index.ts` (uncommitted, deployed to prod).
- **PM impact:** appended to STATE.md's existing "Agent speed (de-serialize the loop)" row — 3rd
  instance of the same thrash-loop class, this one prompt-driven rather than compaction-size-driven.

## 2026-07-09 — Auto-accept resolved cards now show the real before/after diff `[ship]`
- **What:** User couldn't inspect what auto-accept actually changed — expanding a resolved card
  just said "edit a node" with no old/new text. Root cause: the old value was never captured
  anywhere; `describeOps` (the same fn that renders the pre-apply preview) only sees the *live*
  tree, which has already moved past the change by the time you look at history. Fixed by running
  `describeOps` right before `applyNodeOps` mutates anything and freezing the result onto the step
  (`AgentStep.diff`). `ResolvedCard` renders it via a `DiffRows` component extracted out of
  `ProposalCard` so the pre-apply preview and post-apply history can never visually drift apart.
  Also fixed the `expansion` layer, which previously stored empty ops on its resolved step and
  showed nothing at all. Old steps without `diff` fall back to the previous one-line summary.
- **Files/commits:** `apps/web/src/features/dna/lib/agentThread.ts`,
  `apps/web/src/features/dna/components/AgentRail.tsx` — landed inside `f4c972d` (bundled by a
  concurrent session's commit; the diff-capture logic itself is this task's work, verified via a
  throwaway Vitest test against real node-content shape, then deleted).
- **PM impact:** none — bug fix on shipped auto-accept UI, no scope/priority change.

## 2026-07-09 — Committed pending ai_calls node/operation logging + AgentRail fixes `[chore]`
- **What:** Prior session's working-tree changes (ai_calls gained node_id/operation columns for
  per-node cost attribution in the AiCalls admin view; AgentRail/useAutoAccept/agentThread got the
  auto-accept loop tightening) sat uncommitted. Reviewed the diff and committed it, leaving the
  `doc_*.md` scratch files untracked per standing rule.
- **Files/commits:** `f4c972d` — AgentRail.tsx, useAutoAccept.ts, agentThread.ts, AiCalls.tsx,
  _shared/llm.ts, book-agent/index.ts, dna-expand/index.ts, new migration
  `20260709190000_ai_calls_node_operation.sql`.
- **PM impact:** none — pure commit/housekeeping, no new scope or priority change.

## 2026-07-09 — Fixed auto-accept's missing "applying" UI feedback `[ship]`
- **What:** User reported "auto accept isn't working" (auto-run of sketch/render looked stuck).
  Live-diagnosed against their actual book_agent_runs row (book 1229) by polling status/turns/
  proposals across a time window: the apply-and-continue loop was actually cycling correctly
  unattended. Real bug: `useAutoAccept`'s watcher calls `applyAgentProposal` directly, bypassing
  the `applyingId` React state the ProposalCard's spinner/Stop-button UI is keyed on (only the
  manual Apply handler set it) — so a multi-minute autonomous engine/render call ran silently
  with the card looking idle. Fixed by threading `onApplyingChange`/`abortRef` callbacks into
  `useAutoAccept` so both paths drive the same UI state.
- **Files/commits:** `apps/web/src/features/dna/hooks/useAutoAccept.ts`,
  `apps/web/src/features/dna/components/AgentRail.tsx` (uncommitted).
- **PM impact:** none — small frontend bugfix, no roadmap/state change. Side finding flagged but
  not fixed: a raw `.select()` from one user's session returned another user's private book row
  (app route guard blocked UI access, but the query itself wasn't blocked) — worth a dedicated
  RLS look, out of scope here.

## 2026-07-09 — Timeout fix deployed + live-verified; qwen reasoning proven unboundable via routers `[ship]`
- **What:** Deployed the two ratified fixes and drove them live. (1) `max_tokens` 8000→5000 in
  book-agent — **verified: 17 post-deploy agent turns, 0 timeouts** (was ~37% error rate), max
  latency 57.9s, outputs ≤2.3k tok; qwen turns 22–45s clean too. (2) effort→reasoning-bound
  mapping in `anthropicToOpenAI(body, target)` (openrouter `reasoning:{max_tokens}`, mulerouter
  `thinking_budget`, deepseek nothing; budgets low/med/high = 1000/2500/4000, timer-aware).
  **Correction to the earlier wip entry:** probes proved NO param bounds qwen3.7-plus through
  either router — MuleRouter's /vendors/openai facade drops `reasoning_effort`, `reasoning:{…}`,
  `thinking_budget` AND `enable_thinking`; OpenRouter ignores `reasoning:{effort}` for this model.
  The mapping ships as documented intent (harmless, verified no-400 live), not as a working bound.
  Safe config = agent role on an Anthropic tier (current default). Side-finding: OpenRouter
  credits EXHAUSTED — 36/36 dna-expand-digest calls 402'd mid-test (digest model has no Mule
  equivalent); continuity digests silently failing until top-up.
- **Files/commits:** `supabase/functions/_shared/llm.ts`, `supabase/functions/book-agent/index.ts`
  (uncommitted); book-agent deployed 2×; full write-up `doc_1783607491000.md`.
- **PM impact:** STATE "Agent speed" row updated (fix verified live); DECISIONS amended with the
  router-limitation verdict + the OpenRouter-credits operational flag.

## 2026-07-09 — Explained why `/api/stream-prose` doesn't produce a live-typing UI `[chore]`
- **What:** User asked why the prose call is named "stream" but nothing streams visibly.
  Traced the chain: `_proseProxy.ts:streamProse()` really does yield real SSE deltas from
  OpenRouter/Anthropic, but `dnaExpand.ts:streamText()` fully buffers them (`text += decoder
  .decode(value)`) and only returns after `done`, so no caller ever sees a partial chunk. The
  streaming transport exists for reliability (escape the ~150s Supabase worker ceiling — see
  [[project_prose_streaming_proxy]] — and idle-timeout detection via `bump()`), not for a
  typing-effect UX, which was never built. Read-only investigation, no code changed.
- **Files/commits:** none touched; explanation in `doc_1783607434817.md`.
- **PM impact:** none — pure consult. A live-streaming UI would be a separate, scoped follow-up
  (`onDelta` callback in `streamText`) if ever wanted.

## 2026-07-09 — Landed the ratified fix for book-agent 140s timeouts (effort param + max_tokens) `[wip]`
- **What:** Implemented the fix plan from the same-day timeout diagnosis (see decision below):
  (1) `_shared/llm.ts`'s `anthropicToOpenAI()` now takes a `target` and maps `output_config.effort`
  to each OpenAI-compatible tier's own reasoning-bound param (`reasoning:{max_tokens}` for
  OpenRouter, `thinking_budget` for MuleRouter/DashScope, nothing for deepseek — verified
  empirically that MuleRouter ignores both OpenAI-style `reasoning_effort` and OpenRouter-style
  `reasoning:{effort}`, only its native `thinking_budget` lands) instead of silently dropping it;
  (2) `book-agent/index.ts` lowered agent `max_tokens` 8000→5000 to actually fit the ~140s timer
  at ~55 tok/s decode. Code is written and present in the working tree but **not yet committed,
  deployed, or verified live** — this entry exists so the change isn't lost/uncatalogued, not to
  claim it's shipped.
- **Files/commits:** `supabase/functions/_shared/llm.ts`, `supabase/functions/book-agent/index.ts`
  (both uncommitted).
- **PM impact:** none yet — promote to STATE.md's "Agent speed" row once committed, deployed to
  Supabase, and confirmed to stop the timeout streaks on a live run.

## 2026-07-09 — Explained scene "sketch" field absence in DNA tree UI `[chore]`
- **What:** User asked why a scene node's rendered view shows no "sketch" section. Traced it:
  `sketch` is a real `scene`-kind field (`dnaSchema.ts:155`) but flagged `genOnly: true`, so
  `editSpecs()` excludes it from the main form; it only surfaces under the collapsed `▸ structural`
  toggle (`TreeRow.tsx`/`nodeDisplay.ts`), and even there `hiddenFields()` drops empty values
  before they render — so an ungenerated `sketch` is invisible by design, not a bug. Read-only
  investigation (Explore subagent), no code changed.
- **Files/commits:** none touched; explanation in `doc_1783606816206.md`.
- **PM impact:** none — pure consult.

## 2026-07-09 — Diagnosed book-agent 140s timeout streaks: dropped effort param, not context `[decision]`
- **What:** ~15/40 book-agent calls timing out at 140s during a shape-read fix session. Evidence
  from `ai_calls` (errored rows keep their prompt JSON): latency tracks OUTPUT tokens (~55 tok/s;
  timer fits ~7k generated) not input (70k-tok prompts finished in 21s; a 25k-tok prompt timed out
  3×). Root cause: `anthropicToOpenAI()` in `_shared/llm.ts` silently drops `output_config.effort`
  + `thinking`, so qwen reasons unbounded on the MuleRouter path — the `effort:"medium"` defense in
  `book-agent/index.ts:424` never reaches the model. Retries replay the identical prompt → billed
  streaks of 2–3 (abort still bills). Ranked fix: map effort→`reasoning:{effort}` in the adapter;
  lower agent max_tokens 8000→~5000; degrade on retry. Diagnosis only — no code changed yet.
- **Files/commits:** none changed; analysis in `doc_1783599238000.md`.
- **PM impact:** DECISIONS entry (root cause + fix plan ratified as the analysis of record).

## 2026-07-09 — Explained MuleRouter→OpenRouter flip-back procedure `[chore]`
- **What:** User asked how to shift model routing off MuleRouter back to OpenRouter. No code
  change needed — confirmed via `_shared/llm.ts`/`_proseProxy.ts` that it's a pure env-presence
  kill switch (`MULE_ROUTER_API_KEY` set → Mule; unset → falls through to OpenRouter). Gave the
  two unset commands (Supabase secret + Vercel env) but did not execute them (Vercel env change
  needs explicit confirmation).
- **Files/commits:** none touched; read-only confirmation of `supabase/functions/_shared/llm.ts`
  and `apps/web/api/_proseProxy.ts`.
- **PM impact:** none — no state change, just a consult. Untracked `doc_*.md` files in the repo
  root predate this session (prior investigation docs, not yet cleaned up).

## 2026-07-09 — Compaction v3 (bulky-newest rule) + replace_text surgical prose op `[ship]`
- **What:** User's transcript showed the remaining loop: read sweep → ONE fix → re-search/re-read everything → ONE fix… Two causes, two fixes. (1) Compaction v2's "newest tool-results message" flipped to the tiny post-apply "✓ Applied" ACK (it IS a tool_result message), pruning the read sweep right after every apply — v3 keys protection to the newest message carrying a BULKY (>700 char) unpruned result. (2) Prose edits couldn't batch: an `edit` op resends the whole prose text (~2.6k tokens/scene), so 8k max_tokens ≈ 1 fix/turn — added `{op:'replace_text', id, find, replace}` (Claude Code Edit-tool shape, first occurrence, scene prose only): server validates `find` against LIVE prose and bounces mismatches back by name; client applyNodeOps applies with literal-$ replacer + re-indexes the scene so same-scene batched patches compose; describeOps renders find→replace; AgentRail labels "patch prose · …". Tool schema + system prompt updated to mandate batching every small prose fix into one proposal. 930 web tests pass; deployed.
- **Files/commits:** supabase/functions/book-agent/index.ts, apps/web/src/features/dna/lib/dnaChat.ts, apps/web/src/features/dna/components/AgentRail.tsx (uncommitted).
- **PM impact:** same "Agent speed" STATE row. Gotcha: a client that hasn't reloaded silently skips replace_text ops (old applyNodeOps has no branch) — refresh the studio tab once.

## 2026-07-09 — VS Code terminal-tab naming investigation (tooling, not pensive-books) `[chore]`
- **What:** User asked how to auto-name VS Code integrated-terminal tabs across parallel Claude Code
  sessions. Root-caused via binary forensics on the installed Claude Code CLI (`currentSessionTitle`
  vs `currentSessionAiTitle`, the `terminalTitleFromRename` setting, and the `SessionStart`/
  `UserPromptSubmit` hook `sessionTitle` field) plus live testing (`/rename`, raw OSC `printf` to
  `/dev/tty`) that neither actually moved the VS Code tab. Root cause found: VS Code's own
  `terminal.integrated.tabs.title` was set to `${process}` (OS process name — Claude Code's on-disk
  binary is literally named after its version, e.g. `2.1.205`, explaining the tab labels), not
  `${sequence}` (which listens for OSC title escapes). Fix is a VS Code settings change, not a
  Claude Code hook. No pensive-books code touched; produced `doc_1783595049780.md` (untracked,
  local-only per [[feedback_no_commit_learning_files]] convention) as the write-up.
- **Files/commits:** none in the app; `doc_1783595049780.md` (repo-root scratch doc, not committed).
- **PM impact:** none — environment/tooling question, not a product change.

## 2026-07-09 — Compaction v2: policy keyed to newest tool-results message `[ship]`
- **What:** Live verification caught v1 compaction never firing: ai_calls showed the request still at 261k chars, 0 pruned stubs. Root cause — batched turns pack a whole read sweep into ONE huge message (the transcript was only 7 messages), so v1's "keep last 6 messages" window protected everything. v2 stubs bulky tool_results in every message EXCEPT the newest tool-results message (structure-keyed, not count-keyed); never stubbing the newest also prevents re-read thrash. Fixed a reduce<number> type inference error, deno check back to 28-error EdgeRuntime baseline, redeployed mid-run; verification poll running on the next chain links.
- **Files/commits:** supabase/functions/book-agent/index.ts (uncommitted on top of 0baab6e, which had captured v1).
- **PM impact:** same "Agent speed" STATE row; lesson worth keeping — count-based context windows break when message granularity changes; key trimming policies to structure.

## 2026-07-09 — Committed today's accumulated uncommitted work `[chore]`
- **What:** User asked to commit "this" (the node inspector); scoped up to "everything uncommitted"
  after flagging that the working tree also held parallel-session work (MuleRouter switch, agent
  loop speedup + Stop button fix, tab-strip cleanup) intermixed in shared files. Split into 4
  commits by logical unit rather than one giant commit: (1) `835db4c` DNA studio Analytics
  consolidation + node inspector (this conversation's work, carries the tab-strip-cleanup hunk
  since it shared `DnaTreePage.tsx`), (2) `8384176` MuleRouter takeover switch, (3) `0baab6e` agent
  loop speedup + Stop button latency fix (this commit turned out to already include another
  session's later `compactTranscript` transcript-pruning addition — its own WORKLOG entry landed
  after `git add` had already staged the file, so the code was captured a commit before its
  message describes it; the code itself is fine, just under-described in that commit's message),
  (4) `ba765d7` PM tracking files. Verified no hardcoded secrets in the MuleRouter diff before
  staging. Left `doc_*.md` scratch files uncommitted, matching this repo's existing convention.
- **Files/commits:** `835db4c`, `8384176`, `0baab6e`, `ba765d7`. Not pushed to any remote.
- **PM impact:** none new — formalizes work already catalogued in the entries below.

## 2026-07-09 — Agent transcript compaction (context editing) `[ship]`
- **What:** The live lint-fix run on book 1229 exposed the transcript-bloat ceiling: 14 full scene reads pushed the prompt to ~62k tokens, and MuleRouter calls then mostly died at the 140s worker timeout (uncached prefill + qwen's reasoning phase, which MuleRouter can't cap — probed reasoning_effort/enable_thinking, both silently ignored), crawling at ~1 successful turn per 4 attempts. Added compactTranscript to book-agent: once the stored transcript exceeds 120k chars, tool_result bodies >700 chars in all but the last 6 messages are stubbed to a one-line "[PRUNED — re-read if needed]" pointer. Blocks replaced, never removed (tool_use↔tool_result pairing survives); deterministic across retried links; pruned transcript persisted with the turns tick so the row shrinks too. Deployed mid-run — the next chain link picks it up automatically; verification poll running.
- **Files/commits:** supabase/functions/book-agent/index.ts (uncommitted).
- **PM impact:** folded into the existing "Agent speed (de-serialize the loop)" STATE row (same success bar); no new row.

## 2026-07-09 — Session touched no project files (VS Code tab-naming question) `[chore]`
- **What:** User asked an environment/tooling question (how to auto-rename VS Code integrated-terminal
  tabs / Claude Code sessions via a hook) unrelated to the pensive-books codebase. No files in the repo
  were edited by this session; the pre-existing uncommitted diff (proseProxy/llm/book-agent/DNA changes,
  pm/* edits) predates this session and belongs to prior work already in flight.
- **Files/commits:** none touched this session.
- **PM impact:** none — logged only to satisfy the Stop-hook catalogue requirement.

## 2026-07-09 — MuleRouter takeover switch for model spend `[ship]`
- **What:** OpenRouter ran dry mid-run (402 "Prompt tokens limit exceeded" — their prompt cap scales with balance), killing the agent's lint-fix run. User has MuleRouter balance, so: `_shared/llm.ts` now routes slashed OpenRouter ids with a bare-id MuleRouter equivalent (qwen3.7-plus, deepseek-v4-*, gpt-5.5 + full catalogue allowlist) to `api.mulerouter.ai/vendors/openai/v1/chat/completions` whenever the `MULE_ROUTER_API_KEY` secret is set — unset it to flip back. Twin mapping in `apps/web/api/_proseProxy.ts` for prose streaming. Tool calling verified on MuleRouter before cutover. NOT covered (no Mule equivalent, still OpenRouter): qwen3-235b-a22b (digest model), qwen3-8b (low tier), kimi/glm/minimax tiers. Secret set in Supabase edge env + Vercel prod/dev (preview skipped — old CLI loops); all 10 llm.ts-importing edge fns redeployed.
- **Files/commits:** supabase/functions/_shared/llm.ts, apps/web/api/_proseProxy.ts (uncommitted). Discovered en route: pensive Vercel project has NO OPENROUTER_API_KEY in prod — prod prose streaming was likely already broken.
- **PM impact:** memory project_model_stack_openrouter updated with the takeover switch; no STATE row (infra/spend switch, not a product project).

## 2026-07-09 — Node inspector: surface computed-but-hidden per-node/relational signals `[ship]`
- **What:** Follow-up to the lint-visibility audit: user asked to surface every signal the DNA
  engine already computes but never renders, "even if not actionable" — e.g. `ledgerAt` (what's
  true entering a scene), `causality` (a beat's needs/produces/reversed chain, today only a
  pass/fail glyph), per-beat meter values (only ever shown aggregated), a scene's own raw prose
  stats (dialogue %, em-dash rate, sentence-length CV — computed then discarded by the lints),
  and fields already stored on nodes with zero UI readers (`prose_digest`,
  `observed_value_carrier`, `observed_fingerprint`, `observed_shape_fit`, `observed_craft`).
  Extended the existing per-node "view details" modal (`NodeDetailsModal`, already reachable from
  every tree row) with a new kind-conditional "Analysis" section: scene/beat/act/pillar/premise
  each get their own block, built from mostly-existing pure functions plus two small new ones
  (`sceneProseStats`, `beatMeterReadings`). Plan approved via EnterPlanMode
  (`~/.claude/plans/fizzy-doodling-eich.md`, overwritten from the earlier Meters-merge plan).
  Typechecked clean. **Visually confirmed** by the user via screenshot: opening a scene node's
  "view details" now shows the new "PROSE STATS" section (words / dialogue share, with em-dash
  rate + sentence CV below the fold) directly under the existing prompt/output provenance —
  beat/act/pillar sections not individually screenshotted but share the same code path.
- **Incident, logged for the record:** while navigating to find a scene node to test, a click
  intended for a Tree-tab breadcrumb pill instead landed on a live AgentRail "next step" card —
  that book (1229) already had auto-accept armed from an earlier session. This kicked off an
  autonomous agent run that applied two real prose-echo fixes (scenes 6 and 25) before hitting an
  OpenRouter 402 (out of credits) and halting on its own. Surfaced this to the user immediately
  before continuing; user reviewed and said leave both edits (they're legitimate echo fixes).
  Note for future sessions: this book has auto-accept ON — breadcrumb/stage-pill clicks near the
  rail carry real side-effect risk, navigate carefully or check the rail's mode first.
- **Files/commits:** `apps/web/src/features/dna/lib/novelDna.ts` (2 new exported functions),
  `apps/web/src/features/dna/components/tree/modals.tsx` (`NodeAnalysis`/`Section`/`Row` +
  `NodeDetailsModal` gains a `nodes` prop), `apps/web/src/features/dna/pages/DnaTreePage.tsx`
  (pass `nodes` at the call site). Not committed yet.
- **PM impact:** none filed — a visibility feature, not a roadmap-tracked project.

## 2026-07-09 — De-serialized the agent loop (batching, fan-out, cache-stable prompt) `[ship]`
- **What:** Implemented the 4-part speed fix from today's analysis: (1) `<autonomous_mode>` + post-apply ack now mandate batching INDEPENDENT edits into one propose_node_ops (was "ONE change per turn"); (2) new "Working efficiently" system-prompt section tells the model to issue all independent read_node/search_nodes calls in the SAME turn; (3) toolResults refactored to execTool + Promise.all fan-out (contract check's plan+mandate judges also concurrent), auto-verify's per-scene judges parallelized; (4) threadSystem split into byte-stable `instructions` (cached system prompt) + volatile `bookState` injected request-time at the tail of the latest user message via new `withBookState` (never persisted) — the prompt-cache prefix now survives auto-mode applies instead of missing every turn. Deployed; deno check clean vs baseline (28 pre-existing EdgeRuntime errors only).
- **Files/commits:** supabase/functions/book-agent/index.ts (uncommitted); analysis in doc_1783588839417.md.
- **PM impact:** new "Agent speed (de-serialize the loop)" row in STATE §Agent, shipped (code) — success bar recorded there; verify on the next live auto run (ai_calls cache-read tokens + turn count).

## 2026-07-09 — Diagnosed the agent's slowness: four compounding serializations `[wip]`
- **What:** Analysis only (no code yet). The AgentRail agent fixes lints one at a time because of: (1) the `<autonomous_mode>` "ONE change per turn" rule applied even to independent fixes (propose_node_ops already accepts batched ops); (2) no prompt instruction to batch parallel read_node calls in one turn; (3) serial `for…await` in toolResults/maybeInjectRenderVerify (LLM judge calls back-to-back); (4) the live tree digest inside the system prompt invalidates the whole prompt-cache prefix every auto-mode apply. Fix plan ranked: prompt edits → Promise.all → move volatile state to request-time injection after the transcript. Bar: 7-lint run in ≤4 model calls.
- **Files/commits:** doc_1783588839417.md (analysis; uncommitted). No source changes.
- **PM impact:** none (awaiting go-ahead to implement).

## 2026-07-09 — DNA tab-strip chrome cleanup `[chore]`
- **What:** User flagged the errors/warnings pip duplicated in both the below-tabs bar and the
  Tree tab's journey strip — removed it (Analytics tab still has the full breakdown). Moved the
  "More" overflow menu (json/fork/history) out of those per-tab rows into the tab strip itself,
  right-aligned, so it's now one consistent control across all tabs instead of shifting per-tab.
  Also removed the horizontal rule under the tab strip per a follow-up screenshot, so the active
  tab now fuses directly into its content with no seam. Verified live via chrome-devtools MCP
  against the running dev server (book 1229, Analytics + Tree tabs).
- **Files/commits:** `apps/web/src/features/dna/pages/DnaTreePage.tsx` (uncommitted).
- **PM impact:** none — pure chrome polish, no roadmap/decision change.

## 2026-07-09 — Blended Meters into Analytics; added the missing Ledger trigger `[ship]`
- **What:** Follow-up to explaining the lint system: user pointed at the Meters tab's working
  Shape/Craft/Cold-read/emotional-trace buttons and asked for one comprehensive "what's wrong +
  every trigger" surface. Extracted `LedgerPane.tsx` (new, mirrors `MetersPane`'s pattern) from
  `DnaLedgerPage.tsx`'s body — the continuity-ledger/`read-facts` trigger that previously had no
  UI anywhere in the studio tab bar, only an orphaned standalone `/dna/ledger` route. Restyled it
  off hardcoded hex onto the shared `T` tokens so it renders correctly embedded in Analytics (both
  Paper/Terminal themes). In `DnaTreePage.tsx`, folded `MetersPane` + the new `LedgerPane` into the
  `analytics` tab body (after the lint list, before pacing/promises/topography) and removed
  "meters" as a separate top-level tab (type union, path ternary, tab-bar entry, its own render
  block). `DnaLedgerPage.tsx` slimmed to a thin wrapper exactly like `DnaMetersPage.tsx`. Plan
  approved via EnterPlanMode first (`~/.claude/plans/fizzy-doodling-eich.md`).
- **Files/commits:** `apps/web/src/features/dna/components/tree/LedgerPane.tsx` (new),
  `apps/web/src/features/dna/pages/DnaLedgerPage.tsx`, `apps/web/src/features/dna/pages/DnaTreePage.tsx`.
  Typechecked clean (`tsc -p apps/web/tsconfig.app.json`). Verified live in-browser by the user on
  book 1229 (`fork-of-fork-of-mastering-freedom-v3`) — screenshots confirm the merged Analytics
  tab renders lints → Shape → Craft → Cold read → Ledger (new) → pacing/promises/topography, tab
  bar no longer shows Meters. Not committed yet.
- **PM impact:** none filed yet — this closes part of the gap the "DNA UI self-explanatory pass"
  Next item flagged (`pm/ROADMAP.md`); worth a follow-up decision line once committed.

## 2026-07-09 — AgentRail Stop button: cut real + perceived latency `[ship]`
- **What:** User-reported bug: clicking Stop on the AgentRail chat didn't free the UI for the next
  message. Traced root cause: Stop is COOP-cancel (`stopRun.ts` only flips `cancel_requested`);
  the composer's `disabled` is gated on server-authoritative `status`, which only flips to
  `cancelled` once `book-agent`'s in-call poll notices the flag — that poll ran every **5s**, so
  worst case the textarea sat dead with zero feedback for up to 5s. Investigated whether the
  composer could unlock immediately instead (skip the wait entirely): no — `book_agent_runs` has
  one thread row per book with no DB mutex, only an app-level one (client `active` guard + server
  409 on `status IN (running, awaiting_input)`); sending before the row reaches `cancelled` would
  just 409 silently, so unlocking Send early is unsafe. Shipped the two safe wins instead: (1)
  `supabase/functions/book-agent/index.ts` poll interval 5000ms → 1000ms — cuts the real
  worst-case abort latency 5x; (2) `AgentRail.tsx` — new local `stopping` state flips synchronously
  in `stop()` before the network round-trip, so the Stop button's spinner/tooltip reflects the
  click instantly instead of waiting on `stopRun()`'s await + a refetch SELECT to land
  `row.cancel_requested`; resets via `useEffect` once `running` goes false. Textarea itself stays
  gated on `active` (unchanged — correctly so, per the mutex above).
- **Files/commits:** `supabase/functions/book-agent/index.ts` (poll interval), `apps/web/src/features/dna/components/AgentRail.tsx` (`stopping` state + button conditions). Deployed `book-agent` via `supabase functions deploy`. Typechecked clean (`tsc -p apps/web/tsconfig.app.json`). Not yet exercised live in-browser (Claude-in-Chrome extension wasn't connected this session) — verify on next live AgentRail use, tied to the Now #1 "re-exercise the live full-book build" item.
- **PM impact:** none — small bugfix, not a roadmap-tracked project; no STATE/ROADMAP row to move.

## 2026-07-09 — DNA UI self-explanatory pass: audited + ratified + Analytics fix designed `[decision]`
- **What:** User asked (via `/pm`, two screenshots of Tree + Analytics tabs) to make the whole
  DNA Studio self-explanatory. Audited the real code (not just the screenshots) — found the gap
  is mostly hover-only content (real copy exists, e.g. `KIND_EXPLAINER`, but is undiscoverable),
  with Analytics/lints as the one place with a genuine content gap (no why/fix copy) plus a
  narrower `dangling_ref` field-clarity gap. Corrected a first-pass mistake along the way: the
  screenshot's lint list is actually rendered by a hand-rolled block in `DnaTreePage.tsx`, not
  `DnaAnalysis.tsx`'s lints section (which is dead code, always hidden) — click-to-jump already
  works, contrary to the first read. User ratified: new Next item, comprehensive scope (all 6
  tabs). Then designed the first slice (Analytics tab fix) in detail — no code written yet.
- **Files/commits:** `pm/ROADMAP.md` (new Next #1), `docs/dna-ui-self-explanatory.md` (new —
  audit + Analytics implementation design), `doc_1783585977440.md` / `doc_1783586926444.md`
  (session docs, local-only, not part of the change-set to commit).
- **PM impact:** `pm/ROADMAP.md` Next list updated (ratified); `pm/DECISIONS.md` entry added for
  the scope/priority call. `pm/STATE.md` untouched — nothing shipped yet.

## 2026-07-09 — Investigating lint auto-clear + LLM-based lints (in progress) `[wip]`
- **What:** Follow-up to the Analytics-lint-staleness explanation: user asked (1) whether a lint
  clears once its cause is fixed in prose/tree, (2) whether any lints are LLM/semantic (not just
  deterministic) — per memory, the "DNA verify layer" added cold-read/synopsis-read/craft_flag
  which sound semantic. Forked an agent to verify against `novelDna.ts` / `_shared/novel-dna.ts`;
  result not yet back. No code changes made. Also noted (not authored by this session) two
  pre-existing untracked scratch docs (`doc_1783581935000.md`, `doc_1783585977440.md`) from
  earlier unrelated PM/DNA-UI tasks — local-only by convention, not part of this change-set.
- **Files/commits:** none this turn; investigation only.
- **PM impact:** none yet — will follow up once the fork returns.

## 2026-07-09 — Explained Analytics-tab lint staleness (no code change) `[chore]`
- **What:** User asked how to know if the DNA tree's Analytics tab lints (dangling_ref,
  prose_echo, static_relationship, etc.) are up to date. Traced the pipeline: `dnaHealth(nodes)`
  runs uncached in the render body of `DnaTreePage.tsx`, over `nodes` kept live by a Supabase
  Realtime subscription — no edge fn, no LLM call, no DB round-trip at lint time, so the report
  can't go stale relative to the tree. Wrote up findings + architecture vocabulary for the user.
- **Files/commits:** no repo changes; wrote `doc_1783585656834.md` +
  `learning_1783585656834_analytics-lint-staleness.md` (both local-only, not committed).
- **PM impact:** none — investigation/explanation only, no ship/decision.

## 2026-07-09 — PM-system essay: two editorial passes (front-load, then sell-value + how-to) `[chore]`
- **What:** Refined `doc_1783581935000.md` (the "PM out of five markdown files" essay). Pass 1:
  inverted-pyramid opening (inventory + 3-of-4 receipt first). Pass 2: benefit-led second-person
  vignette opening, deleted the "honest gap list" meta-section, folded its fixes (HEAD-stamped
  sentinel, SessionStart injection, grep-never-load) into the how-to as current behavior; snippet
  re-verified against the real `pm-worklog.sh`.
- **Files/commits:** `doc_1783581935000.md` (uncommitted, untracked; user's essay draft).
- **PM impact:** none.

## 2026-07-09 — Builder loop iter 10: dedupe triplicated live-sync effect; scope closed `[chore]`
- **What:** Read the last unexplored corner, `features/dna/pages/` (`DnaTreePage.tsx` 839 lines,
  `DnaJsonPage.tsx`, `DnaMetersPage.tsx`, `DnaLedgerPage.tsx`, `DnaArchitecturePage.tsx` 750 lines).
  `DnaTreePage.tsx`'s per-key localStorage persistence pattern (rail/timeline/search/brief) repeats
  4-5 times but each has different semantics (bool/tri-state/array) on the single highest-traffic
  page in the product — judged not worth the risk for the gain, left alone. Found a real one: the
  exact same debounced Realtime `book_nodes` subscription (400ms debounce, identical cleanup) was
  hand-copied verbatim across THREE pages (`DnaTreePage`/`DnaMetersPage`/`DnaLedgerPage`, differing
  only by channel-name prefix). Extracted `useBookNodesLiveSync(bookId, prefix, setNodes)` —
  deliberately narrow (owns only the subscription, not each page's differing initial load) to limit
  blast radius on `DnaTreePage`. `DnaArchitecturePage.tsx` is a static hand-authored content page
  (no data fetching) — content-accuracy-vs-code is a different task, not touched.
  **This closes the loop's original scope** (`features/dna/` web + `supabase/functions/_shared`
  edge kernel) — every file has now been read at least once across 10 iterations.
- **Files/commits:** `useBookNodesLiveSync.ts` (new), `DnaTreePage.tsx`, `DnaMetersPage.tsx`,
  `DnaLedgerPage.tsx` — commit `916c913`. Verified: `tsc -p tsconfig.app.json` clean, vitest
  (930 tests) green.
- **PM impact:** none (housekeeping). Full loop recap owed to the user now that scope is closed.

## 2026-07-09 — Builder loop iter 9: rename DnaOverview's private TreeRow → ShapeRow `[chore]`
- **What:** Read `DnaOverview.tsx` (336 lines, the studio's dashboard), `DnaStageDiagram.tsx`
  (252 lines, `DnaFullDiagram` — the whole-tree pipeline visualization), and `AgentRail.tsx`'s
  display-only sub-components (`SessionHistory`/`StepBubble`/`ResolvedCard`/`ProposalCard`; its
  main 490-line `AgentRail()` function itself stayed off-limits per the standing live-agent-loop
  caution). Found one real thing: `DnaOverview.tsx` had a private, unexported `TreeRow` helper —
  a simple clickable shape-map row — with the exact same name as `components/tree/TreeRow.tsx`'s
  exported component (the full recursive tree renderer), two unrelated things sharing a name in
  the same feature folder. No functional collision (purely local, never imported) but genuinely
  confusing to grep. Renamed to `ShapeRow`. Considered but skipped a smaller duplication (the
  up/down/flat polarity color mapping repeated across `DnaStoryMap`/`DnaAnalysis`/
  `DnaStageDiagram`) — the "flat" fallback color differs per surface, so extracting it would need
  a parameter for marginal benefit; not worth the abstraction. Everything else in this pass was
  clean, consistent with iters 6-8's read of the current DNA/Studio layer.
- **Files/commits:** `DnaOverview.tsx` — commit `2df7c15`. Verified: `tsc -p tsconfig.app.json`
  clean, full vitest suite (930 tests) green.
- **PM impact:** none (housekeeping).

## 2026-07-09 — Builder loop iter 8: extract duplicated hollow-causal-link test `[chore]`
- **What:** Read the top-level `features/dna/components/` files not yet covered (`DnaStoryMap.tsx`,
  `DnaAnalysis.tsx`, sizes checked on the rest — `AgentRail.tsx` is 788 lines but is the single
  agent-thread surface with one big exported component + private sub-components below it, a normal
  shape, not touched given the standing caution on live-agent-loop code). Found a genuine small
  duplication: `DnaStoryMap`'s `BeatRow` and `DnaAnalysis`'s causality strip each hand-rolled the
  identical "hollow causal link" test (connector says `therefore`/`but` but the causality row
  doesn't back it up) — `DnaStoryMap`'s own comment even flagged it ("the same hollow-link test
  the analysis panel uses"), just never extracted. Pulled it into `isHollowCausalLink()` in
  `nodeDisplay.ts` (the tree's pure-display-derivations file, alongside `beatGlyph`/`proseRollup`).
- **Files/commits:** `nodeDisplay.ts`, `DnaStoryMap.tsx`, `DnaAnalysis.tsx` — commit `218add9`.
  Verified: `tsc -p tsconfig.app.json` clean, full vitest suite (930 tests) green.
- **PM impact:** none (housekeeping).

## 2026-07-09 — Builder loop iter 7: read dnaSchema.ts + useAutoAccept.ts (clean); STATE.md gap row `[chore]`
- **What:** Continued the loop after the diminishing-returns pause. Read `dnaSchema.ts` (the SSOT
  content schema — field specs, validation, sanitize, the prompt-guide artifact renderer) in full:
  well-designed, no dead code or duplication found. Read `useAutoAccept.ts` (the live agent-apply
  loop) in full: dense but deliberate — single-flight ref, exactly-once skip-set, abort deadlines —
  left untouched per the loop's own standing caution about live agent-loop correctness. Both
  confirm the current DNA/Studio layer (unlike the pre-pivot layers cleaned in iters 1-4) hasn't
  accumulated cruft yet. One real finding: STATE.md's "Onboarding & import/export" table never
  picked up the 45-legacy-book migration gap from iter 3 — DECISIONS.md had it, STATE.md's map
  didn't. Added a `gap` row.
- **Files/commits:** `pm/STATE.md` (new row) — uncommitted (pm/ docs, not code).
- **PM impact:** STATE.md now reflects the migration gap as ongoing product state, not just a
  historical decision.

## 2026-07-09 — Article on the PM system + shipped the 5 gaps its audit surfaced `[ship]`
- **What:** Wrote a publishable article (`doc_1783581935000.md`, local-only) describing this PM
  system end-to-end; the audit surfaced 6 gaps, and 5 were fixed this session (6th, multi-session
  races, consciously accepted — a concurrent builder loop was in fact active this session).
  Fixes: (1) **enforcement hole** — the Stop hook exited on a clean tree, so committed-but-
  uncatalogued work bypassed the nudge. Now the sentinel stores HEAD too (2-line, old ones
  auto-migrate) and the hook nudges on uncommitted changes OR commits-since-stamp that touched
  non-`pm/` files but never `pm/WORKLOG.md` (catalogue commits + pure `/pm` commits stay exempt →
  no false-nudge; verified across 7 scenarios). (2) **`pm/METRICS.md`** — new outcome ledger
  (read-through log + COGS table) so output-vs-outcome stops being memory-held. (3+4) new
  **SessionStart hook** (`pm-session-start.sh`) injects ROADMAP→Now every session + a >7-day
  staleness nudge toward `/pm review`. (5) WORKLOG rule relaxed to "grep, never load" (point
  lookups OK). README updated to document all of it.
- **Files/commits:** `.claude/hooks/pm-worklog.sh`, `.claude/hooks/pm-session-start.sh` (new),
  `.claude/settings.json`, `pm/METRICS.md` (new), `pm/README.md` — committed. `pm/WORKLOG.md`
  header edit + this entry left uncommitted (a parallel builder-loop owns this file). Article +
  `learning_*` local-only.
- **PM impact:** the PM system's own enforcement/read layer; no product-facing change. `docs/adr/`
  not warranted — the hook's header comments carry the "why."

## 2026-07-09 — Reader export now paginates by beat, not chapter `[ship]`
- **What:** `renderPages` (novelDna.ts) used to emit one concatenated TEXT page per chapter (all its scenes joined). Changed to emit one TEXT page per beat (scenes within a beat joined with a "***" scene-break marker); chapter SECTION (title) pages unchanged. Only the first beat-page in a chapter carries the chapter title heading. `reconcileDna` needed no change (nodeId is opaque to it). Triggered via the "read in reader →" button (StoryPane → renderAndRead → reconcileDna → /books/:slug).
- **Files/commits:** apps/web/src/features/dna/lib/novelDna.ts (renderPages), novelDnaRender.ts (comment), novelDna.test.ts (2 tests rewritten/added) — commit `244876b`.
- **PM impact:** `pm/STATE.md` "Structure-as-render" row note updated.

## 2026-07-09 — Builder loop iter 5: edge fns clean; added local deno-check tooling `[chore]`
- **What:** Shifted the loop to `supabase/functions/_shared` (the untouched half of its original
  scope). Reachability-swept `_shared/*.ts` against the 19 surviving edge fns — my first-pass grep
  (substring search for `_shared/x`) false-flagged `plan-provenance.ts`/`mandate-gate.ts`/
  `plan-gate.ts`/`words.ts` as orphaned; they're live via relative `./x.ts` imports the pattern
  missed. Verified by call-site (not just import-site): `mandate-gate.ts`/`plan-gate.ts` are
  actively called from `book-agent`'s prose-judging pipeline. No dead `_shared` code found.
  Then tried `deno check` per fn as the edge-side equivalent of `tsc --noEmit` — every fn calling
  `EdgeRuntime.waitUntil` (a Supabase-runtime-only global) false-positived as "Cannot find name
  EdgeRuntime." Added a type-only ambient shim (`_shared/deno-ambient.d.ts` — not imported by any
  function, so Supabase's per-function bundling never picks it up, zero deploy risk) that clears
  it. With the shim, all 19 edge fns check clean. Wrapped it in `scripts/check-edge-functions.sh`
  + a new `pnpm functions:check` — the first time edge fns have been typecheckable locally without
  a deploy.
- **Files/commits:** `supabase/functions/_shared/deno-ambient.d.ts` (new),
  `scripts/check-edge-functions.sh` (new), `package.json` (`functions:check` script) —
  commit `57bfceb`. Verified: `pnpm functions:check` green across all 19 fns.
- **PM impact:** none (dev tooling, no product-facing change).

## 2026-07-09 — Builder loop iter 4: sweep novelDna.ts's ~150 exports, remove dead setStatus `[chore]`
- **What:** Finished the export-usage sweep planned at the end of iter 3, this time on
  `novelDna.ts` (the core pure tree engine, ~150 exports). Cross-checked internal call count (does
  the file use its own export?) against external importers. Only `setStatus` had zero of both —
  a one-line pure helper (`lock`, defined right above it, is actively used; the two look like they
  were added as a pair but only one got wired up). Removed it. Everything else with a low external
  count turned out to be content-union member types (`SeedContent`, `CharacterContent`, etc.) used
  throughout the file's own logic even where nothing outside imports them — internal-only, not
  dead. Left those `export` keywords alone; stripping ~30 of them for no behavioral gain isn't
  worth the churn.
- **Files/commits:** `apps/web/src/features/dna/lib/novelDna.ts` — commit `c0f13e8`. Verified:
  `tsc -p tsconfig.app.json` clean, full vitest suite (929 tests) green.
- **PM impact:** none (housekeeping).

## 2026-07-09 — Builder loop iter 3: delete orphaned migrateBookToDna; 45 legacy books flagged `[decision]`
- **What:** Audited unused exports across `features/dna/lib/*.ts` (export-name usage-count sweep,
  not just whole-file reachability this time). Found `migrateBookToDna` — 0 callers, lost its
  trigger when the old DnaStudio "Migrate" button was deleted 2026-07-03. Unlike iter 1/2's finds,
  this was a live working capability, not code calling an already-dead edge fn, so stopped and
  asked before touching it. Queried the DB (read-only, `supabase db query --linked`): 45 books
  have real pages + foundations/spine but 0 `book_nodes` rows — this was their only migration
  path. Reported the count; user's explicit call was to delete anyway. Removed the async wrapper,
  kept the pure `buildDnaFromStack` (still used by `importEpub.ts` Layer A). DECISIONS entry
  records the tradeoff. No other flagged candidates this iteration (rest of the export sweep —
  `dnaProposals.ts`, `treeVersions.ts`, `dnaDecompose.ts`, `importEpub.ts`, `novelDnaRender.ts` —
  came back clean; `novelDna.ts`'s ~150 exports not yet swept, too large for one iteration).
- **Files/commits:** `apps/web/src/features/dna/lib/migrateToDna.ts` — commit `42ff2fa`.
  `pm/DECISIONS.md` entry added. Verified: `tsc -p tsconfig.app.json` clean, vitest (929) green.
- **PM impact:** DECISIONS entry added (the 45-book stranding is the consequential part).

## 2026-07-09 — Builder loop iter 2: delete lib/ladder.ts (orphaned resolution-ladder client) `[chore]`
- **What:** Reachability-swept `apps/web/src/lib/`, `hooks/`, `components/book/shared/`, and all
  of `features/dna/` for zero-importer files (same method as the edge-fn prune). Found
  `lib/ladder.ts`: `transforms.*` + `saveSpine`/`saveObjective`/`saveBeat`/`readNode`/`readProse`
  called edge fns already deleted 2026-07-09 (`objective-to-beat`, `beat-to-prose`, `prose-to-beat`,
  `revise-node`, `objective-options`), and had 0 call sites — the Resolution Map UI that used it
  (`NodeEditor`/`GraphActions`/`PageWorkshop`/`BookSpine`/`BookJourney`) was already deleted in the
  2026-06-30 DNA pivot; this client was the missed remainder. Deleted the file. Updated the stale
  `project_multiresolution_outline` memory (SUPERSEDED banner + MEMORY.md index line) to match —
  it still described the ladder as partially-shipped, live design. No other orphans found in this
  sweep (features/dna/ itself was already clean — the "one studio" consolidation had caught it).
- **Files/commits:** `apps/web/src/lib/ladder.ts` (deleted) — commit `5186c31`. Memory files
  updated (not part of the repo). Verified: `tsc -p tsconfig.app.json` clean, vitest (929) green.
- **PM impact:** none (housekeeping, continuation of the 2026-07-09 edge-fn prune).

## 2026-07-09 — Owner directive: monetize ASAP — GTM.md rewritten to committed plan v1 `[decision]`
- **What:** GTM.md promoted from thinking-surface to committed plan: a three-rung monetization
  ladder (R1 Pensive Pro subscription on the mature Writing pillar, R2 paid import wedge, R3
  metered generation — unchanged, still M1-gated). The old "no pricing before M2" gate now scopes
  to generation pricing only. ROADMAP Now intentionally busts WIP≤2 to add "Monetization rails v1
  (GTM R1)" alongside the live-build re-exercise; M4's description narrowed from "First paid
  surface" to "Paid generation."
- **Files/commits:** `pm/GTM.md` (rewritten), `pm/ROADMAP.md` (Now #2 added, M4 relabeled,
  parallel-revenue-milestones note), `pm/DECISIONS.md` (entry already present) — all uncommitted.
- **PM impact:** DECISIONS entry present. ROADMAP Now = 2 items (WIP≤2 deliberately overridden).

## 2026-07-09 — Builder loop iter 1: prune orphaned revision-chat client code `[chore]`
- **What:** First iteration of an open-ended "understand + consolidate the DNA surface" builder
  loop. Read `features/dna/FEATURE.md` fully; found it still listed `beats-agent`/`revise-node` as
  DNA-feature siblings after both were deleted in the 2026-07-09 edge-fn prune — fixed. Then
  finished that same prune's client-side half: `revisionChat.ts` (sendRevisionMessage/
  applyProposal/etc.) and `beatSheet.ts`'s reviseBeats/applyBeatPlan/LENSES only called the now-
  deleted `revise-chat`/`revise-beats`/`build-revision` edge fns, and traced back to zero live
  call sites (their one caller, `GenerateInChat` in `studioUi.tsx`, was itself unused — dead since
  `ReviseChat.tsx`, the listener side of its pub-sub bell, was deleted in the DNA pivot). Deleted
  `revisionChat.ts`; stripped `beatSheet.ts` to just the `RevisionPlan`/`PlanPage` types
  `outline.ts` still needs. Confirmed `scripts/eval-bridge.mjs` deliberately still mirrors the old
  pre-pivot edge fns per standing memory (do not sync) — left untouched.
- **Files/commits:** `apps/web/src/lib/revisionChat.ts` (deleted), `apps/web/src/lib/beatSheet.ts`,
  `apps/web/src/components/book/shared/studioUi.tsx`, `apps/web/src/features/dna/FEATURE.md` —
  commit `8d7d5ac`. Verified: `tsc -p tsconfig.app.json` clean, full vitest suite (929 tests) green.
- **PM impact:** none (housekeeping, continuation of an already-recorded chore).

## 2026-07-09 — Add stamp step to /pm (close hook-nudge gap) `[chore]`
- **What:** A `/pm` session catalogues via the curated files but didn't stamp the sentinel, so the
  Stop hook re-nudged on already-catalogued PM work. Added a "stamp before ending" standing rule to
  `.claude/commands/pm.md` mirroring `/wrap`'s step 3 — now both entry points acknowledge the
  change-set identically.
- **Files:** `.claude/commands/pm.md` (uncommitted).
- **PM impact:** none (tooling).

## 2026-07-09 — PM review: drift check + rank fight, live-build re-exercise promoted to Now `[decision]`
- **What:** Ran `/pm` (empty input → full three-hats pass). Drift check: found the prior
  session's edge-fn cleanup + pm doc edits had landed as commits already (builder hat clean, no
  action). PM hat: both Now slots were free while ROADMAP's own text buried the highest-leverage
  next step (re-exercising the §v1/§v4 agent-loop fixes on a live "build all") as a footnote
  under two adjacent-but-not-M1-blocking Next items (EPUB Layer B, REVALIDATE_SECRET). User
  ratified pulling it into Now. Owner hat: no new cost/GTM findings, REVALIDATE_SECRET's Next
  ranking confirmed against GTM.md's stated pre-M2 gap.
- **Files/commits:** `pm/ROADMAP.md` (Now section added, stale "both slots free" note fixed,
  Next renumbered under its own heading), `pm/DECISIONS.md` (rank-change entry) — uncommitted.
- **PM impact:** ROADMAP Now = live full-book build re-exercise. DECISIONS entry added.

## 2026-07-09 — Prune dead edge functions (post-DNA-pivot cleanup) `[chore]`
- **What:** Reachability audit of `supabase/functions/` (import-closure from live roots =
  client-invoked + watchdog-invoked fns). Deleted 22 orphaned function dirs + 20 unused
  `_shared` modules (43 files, ~7.4k lines). All orphaned by the DNA substrate pivot: whole-book
  build now runs through `dna-expand` (not `generate-book`), eval runs via the `/evaluate-book`
  command (not the edge fn), the revise-* cluster + Build Studio fns are unreached. Grouping into
  subfolders is impossible (Supabase deploys one fn per top-level dir) — deletion was the only
  real refactor. Survivors: 19 fn dirs, 18 `_shared` files.
- **Files:** `supabase/functions/{ai-run,beat-*,build-revision,evaluate-book,generate-book,
  generate-page,generate-scene-image,generate-character-portrait,mandate-gate,objective-*,
  prose-to-beat,revise-*,spine-to-objectives,send-to-kindle}/` + 20 `_shared/*.ts` deleted;
  `config.toml` (dropped generate-book/build-revision blocks); `FEATURE.md` (stale access.ts note
  fixed). Staged as `git rm`, not committed. Deleted stale memory `project_generate_book_chokepoint`.
- **PM impact:** none (housekeeping). Legacy watchdog SQL still names generate-book/build-revision
  — harmless (no starter ⇒ never fires); left for a future migration.

## 2026-07-09 — PM work-routing system: WORKLOG + /wrap + Stop hook `[decision]`
- **What:** Built the mechanism to route all work through the PM. New append-only firehose
  `pm/WORKLOG.md` (one entry per task, write-only — never loaded into context). New `/wrap`
  command as the end-of-task chokepoint: catalogue → promote ships/decisions to STATE/ROADMAP/
  DECISIONS → stamp. A Stop hook (`.claude/hooks/pm-worklog.sh`) enforces it — nudges once per
  dirty, uncatalogued change-set; idempotent via a gitignored fingerprint sentinel. Fixed a
  trailing-newline bug that made stamp/hook hashes never match.
- **Files/commits:** pm/WORKLOG.md, .claude/commands/wrap.md, .claude/hooks/pm-worklog.sh,
  .claude/settings.json (Stop hook), .claude/settings.local.json, .gitignore, pm/README.md
  (all uncommitted).
- **PM impact:** DECISIONS entry added (process/tooling change). No STATE product-board row —
  it's infra for how we work, not a product project.

## 2026-07-09 — Kindle settings: instruct user to whitelist hello@pensive.me `[ship]`
- **What:** Send-to-Kindle emails from hello@pensive.me were silently dropped by Amazon unless the
  user pre-approves the sender in their Personal Document Settings. Added an instructional card to
  the Kindle settings page (above the email/verification form) linking Amazon's Approved Personal
  Document E-mail List settings and telling the user to add hello@pensive.me.
- **Files/commits:** apps/web/src/pages/settings/KindleSettings.tsx — commit `2fc68e8` on branch
  `pm/work-routing`.
- **PM impact:** none — minor UX fix on an already-shipped feature, not tracked as its own
  STATE/ROADMAP row.
