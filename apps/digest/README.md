# @pensive/digest — digest.pensive.me

A daily digest, **compiled** from sources you choose and delivered to your Kindle.

The load-bearing idea: a digest is compiled from grounded sources, not generated from a seed — the inverse
of the DNA pipeline. Retrieval is deterministic; the model is a transformer over fetched text, never a
source of facts. That's enforced structurally by splitting GATHER (no writing) from WRITE (no retrieval),
so the model can't reach for a memorized "fact" even if it wanted to.

Design doc: `doc_1785565352472.md` at the repo root. Decision record: `pm/DECISIONS.md` (2026-08-01).

## Shape

```
pg_cron */15 → POST /api/cron/tick
                 ├─ due_digests()          timezone-local scan, 3h window
                 └─ claim_digest_issue()   INSERT … ON CONFLICT DO NOTHING = the lock
                        └─ buildIssue(id)
                             ⓪ cadence  drop sections not due today        lib/digest/build.ts
                             ① gather   per section, parallel, no writing   lib/digest/adapters.ts
                                        search | feed | serial | prompt | readwise
                                        ranked | inbox | unread | sitewatch | video
                             ② filter   canonical url → sha256 → delivered? lib/digest/canonical.ts
                             ③ write    one LLM call per section, parallel  lib/digest/write.ts
                            ③b close    sections written OVER the sections   lib/digest/closers.ts
                             ④ verify   drop NOTHING_TODAY / empty          (in write.ts)
                             ⑤ assemble intro + sections                    lib/digest/build.ts
                             ⑹ record   EVERY post pulled → digest_posts     (used or not)
                             ⑦ render   HTML (EPUB is the v1 follow-up)     lib/digest/render.ts
                             ⑧ deliver  Mailgun → Kindle                    lib/digest/deliver.ts
                             ⑨ mark used — only after a 2xx
```

Sections are independent, so ①+③ cost roughly one section's latency, not the sum.

## Relationship to the main app

Separate bounded context, **shared kernel**. Its own tables, UI, domain, and runtime; the same Supabase
project for `auth.users`, the shared `.pensive.me` session cookie, `user_data.kindle_email`, the approved
Mailgun sender, and `ai_calls` cost logging.

**The SPA owns session refresh.** Supabase rotates refresh tokens and `navigator.locks` is per-origin, so
two subdomains refreshing the same cookie would eventually log each other out. This app reads the cookie
with `autoRefreshToken: false` and bounces to `app.pensive.me/auth?returnTo=…` when it's stale. Don't
"fix" that by enabling refresh here.

## Environment

| Var | Where | Notes |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | server | The pipeline acts for a sleeping user — no JWT to present |
| `ANTHROPIC_API_KEY` | server | **Gather only.** Opus 5 drives `web_search` + judges source quality |
| `DEEPSEEK_API_KEY` | server | **Write only.** `deepseek-v4-pro` writes every section and the intro |
| `MAILGUN_API_KEY` / `MAILGUN_DOMAIN` | server | Must be the **same domain** the Kindle OTP flow got approved |
| `CRON_SECRET` | server | Shared secret on `POST /api/cron/tick` |
| `MAILGUN_SIGNING_KEY` | server | HMAC key for the **inbound** webhook. Missing = every inbound message is rejected (fail-closed) |
| `MAILGUN_INBOUND_DOMAIN` | optional | Domain digest addresses are issued on. Defaults to `MAILGUN_DOMAIN` |
| `GITHUB_TOKEN` | optional | Any read-only PAT. Lifts `ranked/github` from 60 req/hr **per shared IP** to 5,000 |
| `PENSIVE_APP_ORIGIN` | optional | Defaults to `https://app.pensive.me` (`localhost:8080` in dev) |
| `PENSIVE_DIGEST_ORIGIN` | optional | Defaults to `https://digest.pensive.me` |
| `DIGEST_AI_ENABLED` | optional | Ops override for the paid AI gate (`lib/digest/llm.ts` `aiEnabled`). `=false` kills every model call regardless of environment; `=true` lifts the dev-default-off so you can test the AI path locally. Unset: off outside production, `digests.ai_enabled` decides in production |

The Supabase URL and anon key are checked into `lib/pensive.ts`, same as `apps/marketing` — the anon key is
a public credential and RLS is the real boundary.

**Per-user credentials are not env vars.** The Readwise token belongs to a person, not to the deployment, so
it lives in `digest_user_settings` (one row per user, RLS-scoped) and is entered at `/settings`. Adding a
second integration means a column there, never a new environment variable.

## Readwise

`readwise` sections pull quotes out of the reader's own highlight vault. It is the inverse of every other
source here: not "what happened today" but "what you already decided was worth keeping".

**Connect at `/settings`** (account-level, not per digest — see above). The page verifies the token against
`GET /api/v2/auth/` *before* storing it, because the alternative is discovering a typo or a lapsed plan at
6am inside a cron job. **The v2 API is a paid-plan feature**: a free or expired account still shows a token
on Readwise's page, but every call comes back 401.

Two draws, chosen per section:

| mode | what it is | cost |
|---|---|---|
| `review` | Readwise's own daily spaced-repetition pick (`GET /review/`) | 1 request |
| `random` | our resurfacer: `GET /books/` → pick books **weighted by `num_highlights`** → one random *page* of each book's highlights | 1 + N requests, any library size |

Weighting by highlight count makes the draw uniform over *highlights*, not over books — otherwise a book you
underlined twice comes up as often as one you underlined 108 times. Reading a random page rather than
exporting the library is what keeps the cost independent of vault size.

Three decisions worth not undoing:

- **Quotes are laid out, not written.** `writeSection` short-circuits for this kind and renders a template
  (blockquote → attribution → your note). A model in this path can only subtract: paraphrase is a downgrade,
  a "connective sentence" is padding, and one mis-copied word puts words in a real author's mouth. The price
  is that `voice` and `instructions` don't reach these sections — steering *which* quotes appear is a
  selection problem, not a writing one.
- **We never call `/review/complete/`.** Marking the review done is a write into the reader's own Readwise
  account, and a preview would then silently burn the review they were about to read in the app.
- **Dedupe identity is the Readwise permalink** (`https://readwise.io/open/<id>`, reconstructed for the
  review endpoint, which doesn't return it). So quotes flow through the same `digest_posts` corpus as
  articles and the same "never send it twice" rule holds across both modes. `random` over-draws 3× the cap
  so the seen-filter still has something to hand over.

## Local development

```sh
pnpm --filter @pensive/digest dev        # → localhost:3001
```

`apps/digest/.env.local` needs the vars above. Sign in at the SPA first (`pnpm dev:web`, localhost:8080) —
cookies ignore port, so the session is shared with localhost:3001 and the middleware won't bounce you.

**Three ways to run a digest, in increasing order of commitment:**

| | What it does | Side effects |
|---|---|---|
| **Preview** — `GET /api/digests/:id/preview`, or the button on the digest page | Compiles today's issue and returns it as a web page | **None.** No mail, no `digest_issues` row, no seen-items. Spends tokens (logged to `ai_calls` with `task_id = null`). |
| **Run now** — button on the digest page | The real pipeline, through the same claim as the scheduler. **No-op if today was already delivered** | Sends to your Kindle, writes the issue, marks items seen |
| **Regenerate** — button, or `?force=1` on the run route | Rebuilds an already-delivered day and sends it again | Same, plus it first *forgets* the seen-items that issue recorded |
| **Tick** — `POST /api/cron/tick` with `x-cron-secret` | What pg_cron will call: scans `due_digests()`, claims, builds every due digest | Same as Run now, for every due digest |

Preview is the loop you want while editing prompts: change a constitution line, reload the tab, read the
result. It goes through the *same* `compile()` the 6am job uses, so what you see is what would be sent —
a preview on a different code path would be worth very little.

Add `?ignoreSeen=1` to compile as if nothing had ever been delivered. Worth knowing why it exists: a preview
run right after a real send correctly dedupes to nothing, which reads as a broken pipeline rather than a
working one.

```sh
# Preview from the shell (needs the session cookie; easier in a browser tab)
curl -sD- -o issue.html -H "Cookie: sb-<ref>-auth-token=..." \
  'http://localhost:3001/api/digests/1/preview?ignoreSeen=1' | grep x-digest
# → x-digest-sections: 2
# → x-digest-items: 5

# Drive the scheduler by hand — note this really sends
curl -X POST localhost:3001/api/cron/tick -H "x-cron-secret: $CRON_SECRET" -d '{}'
```

`due_digests()` only returns a digest whose local `deliver_at` passed within the last 3 hours, so to make
the tick fire on demand, set `deliver_at` to a few minutes ago in the digest's timezone.

**Regenerating a delivered day** has a trap worth knowing about. The first build marked its items seen, so a
naive rebuild dedupes its own previous output away and produces an *empty* issue — the dedupe layer working
perfectly in the one case you don't want it to. That's why `digest_items_seen.issue_id` exists: regenerate
deletes exactly that issue's rows first, and nothing else. Items delivered by *older* issues stay
deduplicated, which is correct.

(Rows written before that column existed have `issue_id = null` and can't be attributed, so a regenerate
can't forget them. Only affects issues delivered before 2026-08-01.)

## Scheduling (run once the app is deployed)

Not shipped as a migration on purpose: it hardcodes the deployed origin and needs `CRON_SECRET` in Vault
first, and a job pointing at a URL that doesn't exist yet would just error every 15 minutes.

```sql
select vault.create_secret('<the same value as CRON_SECRET>', 'digest_cron_secret');

select cron.schedule('digest-tick', '*/15 * * * *', $$
  select net.http_post(
    url     := 'https://digest.pensive.me/api/cron/tick',
    headers := jsonb_build_object(
      'content-type',   'application/json',
      'x-cron-secret',  (select decrypted_secret from vault.decrypted_secrets where name = 'digest_cron_secret')
    ),
    body    := '{}'::jsonb
  );
$$);
```

## Status

- Schema live; app builds; URL canonicalization, RSS/Atom parsing and markdown→HTML verified directly.
- **Delivery leg proven end-to-end (2026-08-01), confirmed on the device.** A rendered issue went
  `hello@pensive.me` → Mailgun → `anzal.ansari_25@kindle.com`, Amazon returned `delivered / OK`, and it
  opened on the Kindle. Approved sender, `.html` attachment, and Amazon's HTML→book conversion all work —
  which is what justifies deferring EPUB to v1 rather than building it now.
- **Full pipeline proven (2026-08-01).** Issue #4 compiled and landed on the Kindle via the *scheduler*
  path — `due_digests` → `claim_digest_issue` → gather → filter → write → verify → assemble → render →
  Mailgun → mark-seen. Two sections in parallel, ~74s wall clock, well inside the 300s function ceiling.

- **Readwise proven end-to-end (2026-08-01).** A two-section scratch digest (`review` + `random`, books
  only) compiled through the real `previewIssue`: 5 quotes, verbatim, attributed, blockquoted in the render,
  and all 5 recorded in `digest_posts` under their Readwise permalinks. Zero model calls in either stage —
  the only Claude call in that run was the two-section intro.

### Three bugs the live runs caught

1. **`max_uses: 5` on web_search was too tight.** Dynamic filtering fans one topic into several calls and
   can bug out into duplicates; the allowance was exhausted before any result returned, so the section
   shipped empty. Now 15, plus a prompt-side cap of 3 distinct searches. The failure was *correct* —
   the model refused to write from memory — but a silently empty section is the expensive outcome.
2. **`NOTHING_TODAY` was too easy to reach.** The writer had real material (a model launch with concrete
   numbers) and still bailed, because the constitution framed the escape hatch as a virtue and the reader's
   voice said "skip the hype". It is now explicitly an *emptiness* test, not a quality bar: "you are not the
   reader's taste filter."
3. **The researcher's narration was being read as source material.** The search adapter returned "I'll run
   three searches… one caveat up front…", the writer ingested that verbatim, and inherited its skepticism.
   The gather prompt now forbids process narration, and the constitution tells the writer to ignore any that
   leaks through.

### Bug caught before the first send

`deliver.ts` originally used `mailgun@$MAILGUN_DOMAIN`, copied from `notify-task-done`. Wrong address:
Amazon's approved-sender list has **`hello@$MAILGUN_DOMAIN`**, because that is what both
`send-kindle-verification` (the OTP mail) and the existing book send (`BookInfo.tsx`) put in From.
`mailgun@` is for ordinary notification mail to a human inbox. Had this shipped, every digest would have
vanished silently — Send-to-Kindle drops unapproved senders with no bounce.

## The post corpus

`digest_posts` keeps **every** post any section pulls, used or not. Three things depend on it:

- **Visibility** — `/digests/:id/posts` lists what was pulled with a used/unused mark, a per-source hit
  rate, and the **age of the writing** (not of the fetch). `/digests/:id/posts/:postId` renders the stored
  body, so you read the copy already extracted instead of re-fetching the original. The unused half is the
  interesting half: it's the evidence for whether a feed earns its place.
- **Reuse** — the extracted article body is stored, so a later run doesn't re-fetch a page we already read.
  (This saves r.jina.ai calls, not wall-clock: extraction overlaps the parallel writes, so a warm run
  measured 19.9s against 21.8s cold. The point is fewer third-party requests, not speed.)
- **Ranking** — "pick 3 of 40" is unimplementable without a corpus to rank over. Not built; now possible.

It replaced `digest_items_seen`, which was the same grain — `(digest_id, url_hash)` — holding a strict
subset of these columns. "Seen" is now a property of a post (`used_at is not null`) rather than a second
table that could drift from it.

**The invariant:** dedupe keys on **delivered**, never on **fetched**. If merely pulling a post suppressed
it, anything fetched and passed over would be blacklisted forever — the opposite of what a corpus is for.
Previews record posts too (they really did fetch them) but never mark anything used.

## Cost

Gather cost differs enormously by section kind, which is why `search` is behind a per-digest toggle
(`digests.web_search_enabled`, **default false**):

| kind | gather cost | notes |
|---|---|---|
| `feed` | HTTP fetches only | No model call at all. Article extraction via r.jina.ai. |
| `serial` | one DB read | Nothing external. |
| `prompt` | nothing | No retrieval by design. |
| `readwise` | 1–4 HTTP reads | No model call at **either** stage — the write is a template (see below). |
| `ranked` | 1–N HTTP reads | Keyless public APIs. arXiv/GitHub need no extraction at all (abstract / release notes ARE the body). |
| `inbox` | one DB read | Nothing external: the sender already delivered. The cheapest source in the app. |
| `unread` | one DB read | Reads posts the corpus already paid to fetch. |
| `sitewatch` | one fetch per watched url | Emits nothing at all unless the page changed. |
| `video` | 1–2 fetches per item | Transcript where one exists, else the description. |
| `quiz` | one write call | A **closer**, not a source — see below. |
| `search` | **Opus 5 + the `web_search` server tool, every run** | Bills whether or not it finds anything. |

### The provider policy: Anthropic is for `web_search`, and nothing else

Everything else runs on DeepSeek. That was already true by convention — `MODEL_GATHER` appears at exactly
one call site — but convention isn't a mechanism, and the symptom of breaking it is an invoice a month
later. It is now enforced from the **capability** side: reaching Anthropic requires asking for a *server*
tool. A server tool (`{ type: "web_search_20260209" }`) runs inside Anthropic's own infrastructure and comes
back in the same response, which is the one thing no other host can serve and therefore the only honest
reason to be there. `callModel` throws if a `claude-*` model is called without one.

Ordinary **function tools** are a protocol both providers speak, so they carry no such licence — the agent's
tool loop runs on DeepSeek. `callModel` (one-shot) refuses them outright because it has nowhere to put a
tool result; they go through `callModelStep`.

### Two providers, chosen by model id

Writing runs on **DeepSeek `deepseek-v4-pro`**; gather stays on **Anthropic Opus 5**. `lib/digest/llm.ts` is
the one chokepoint and routes on the model id alone (`providerFor`) — there is no separate provider switch to
keep in sync, so a stage cannot end up pointed at a model its provider doesn't serve.

**Gather cannot move to DeepSeek.** `web_search` is an Anthropic *server* tool: it runs inside Anthropic's
infrastructure and returns results in the same call. Point that stage elsewhere and the tool is silently
dropped — no error, just a model answering from memory, which is the exact failure this pipeline exists to
prevent. `callModel` throws if a DeepSeek model is handed `tools`, so the mistake fails loudly instead.

Two integration hazards worth knowing, both handled:

- **DeepSeek charges reasoning tokens against `max_tokens`** (Anthropic bounds visible output only). Every
  `maxTokens` in this app was picked under the Anthropic meaning — `writeIntro` asks for 400, which is fine
  for two sentences and *nothing at all* once reasoning eats it first. The DeepSeek path adds
  `REASONING_HEADROOM` per effort level, and logs `truncated` to `ai_calls` if a call still hits the cap.
- **Citation habits differ per model.** DeepSeek brackets its citations — `[[Anthropic](url)]` — which the
  renderer turned into link text `[Anthropic` plus an orphaned `]`. Fixed in `render.ts` by unwrapping a
  bracket pair around a whole link, not in the prompt: the renderer is the one place that sees every model's
  output, and literal brackets (`[1, 2]`) still survive.

No `cache_control` on the DeepSeek path — it caches prompt prefixes automatically, server-side. `ai_calls`
records `provider` per row, so cost stays attributable per host.

The toggle is enforced inside `searchAdapter`, not at the call site, so a paid path can't be reached by
accident from some future caller. Existing digests were defaulted to `false` by the migration: a section
that visibly stops is a better failure than a bill nobody is watching.

## Two contracts, not one

`Adapter` — `(section, ctx) => Item[]` — is the source contract, and every retrieving kind collapses to it.
`Closer` — `(section, renderedSections, ctx) => RenderedSection` — is the second one, added when `quiz`
arrived. A closer *retrieves nothing*: it reads what the other sections produced. Modelling it as an
Adapter would have meant pushing fake Items through the writer, and the ordering constraint (closers run
last) would have been a comment instead of a type. `ADAPTERS` deliberately has no `quiz` entry; `CLOSERS`
does. The pipeline splits the section list on `isCloser(kind)`, so nothing can accidentally run in the
wrong phase.

The intro summarises the *source* sections only — a coda shouldn't be announced before the reader has read
anything.

## Cadence

The digest has one delivery clock; a section may have its own (`cadence: daily | weekdays | weekly`, plus
`weekday` for the weekly case). This exists because half the useful kinds are weekly by nature — `unread`,
`readwise` resurfacing, a beat that publishes twice a month. Forcing those onto a daily rhythm is exactly
how a reader learns to expect empty sections.

Evaluated against the **local** issue date, so "Sunday" means the reader's Sunday. `undefined` means daily,
which is what every section did before this existed — no backfill needed.

## The inbound address (push, not pull)

Every other source is polled. `inbox` is delivered: each digest owns `read+<token>@<inbound domain>`
(`digests.inbox_token`), Mailgun's catch-all route POSTs to `/api/inbound/mailgun`, and the message lands in
`digest_inbox_messages`. The 6am build reads it later — nothing about receiving mail triggers work, so a
burst of newsletters can't start a build.

Three things are load-bearing:

- **HMAC or nothing.** The route verifies Mailgun's signature and fails closed when `MAILGUN_SIGNING_KEY`
  is unset. Without that check the endpoint is an open door into someone's reading: injected text would
  reach the writer stage as *sourced material*.
- **Status codes are Mailgun's retry protocol.** 2xx = never retried, 4xx = dropped, 5xx = retried for 8h.
  So an unknown recipient returns **200** (a retry can't fix a nonexistent address) while a database failure
  returns **503** (the mail is real and the retry will probably work). Returning 200 on a DB error loses a
  newsletter permanently.
- **`(digest_id, message_id)` is unique**, which is what makes those retries safe.

Mail has no url, and the whole pipeline keys identity on `sha256(canonical url)`. So an inbox item gets a
synthetic permalink — `digest.pensive.me/inbox/<id>` — that is never fetched. Every stage downstream then
treats a newsletter exactly like an article.

## sitewatch and the versioned url

A watched page keeps its url forever, and "already delivered" is keyed on url. So the second time a page
changed, the dedupe layer would suppress it as old news — the layer working perfectly in the one case you
don't want it to (the same shape of bug as regenerating a delivered day). Each version therefore gets its
own identity: `?v=<hash8>` appended, which survives canonicalization because `canonicalUrl` strips *tracking*
params, not unknown ones. The previous text is read back out of `digest_posts` scoped to that section, so
this kind adds no table.

## Section fields

Every kind's fields are declared once, in `lib/digest/sectionSchema.ts`: which fields exist, which are
**required**, what each one *means*, and how a raw form string becomes a Section property. The form renders
from it and the server action parses and enforces from it.

That declaration replaced the same knowledge living in three places — the TS interface in `types.ts`, the JSX
per kind in `AddSectionForm.tsx`, and a hand-written branch per kind in `addSection`. Three edits per new
field, and silent drift the moment one was missed. Same multi-mirror problem `dnaSchema.ts` was introduced to
kill on the DNA side.

The schema is **pure data** — a `type` tag both sides interpret, not parse callbacks — so it imports cleanly
into a client component and reads top-to-bottom as documentation. `name` is both the form field name and the
Section property name, which is what removes the rename table entirely.

**Required is enforced, not suggested.** Before it, a `feed` with no URLs or a `serial` with no book id saved
happily and then gathered nothing every morning, forever — a section that could not possibly work, with no
signal anywhere. An empty `search` query was worse: it still billed an Opus call to produce nothing. Adding a
field to a kind is now one edit, and a kind that needs conditional requiredness has exactly one hook
(`requiredWhen` — `ranked.targets` is mandatory for arxiv/github/reddit and meaningless for hn/lobsters).

## One write surface

Every change anyone can make to a digest is a **Command**, and every command lands in
`lib/digest/commands.ts`. `app/digests/actions.ts` is a thin FormData→Command adapter; anything else that
needs to write (an agent, an importer, a script) is another adapter over the same port.

```
 forms (RSC)  ──FormData──► adapter ─┐
                                     ├──►  applyCommand(supabase, cmd)  ──►  digests row
 (an agent)   ──JSON──────► adapter ─┘
```

The reason is the one this codebase keeps paying for: a second write path agrees with the first on the day
it is written and drifts the first time either changes. `sectionSchema.ts` killed that for *what fields a
kind has*; this kills it for *what happens when you save one*.

Three things stay on the adapter side, and the line is "framework-specific presentation":

- **`revalidatePath`** — commands *return* the paths to revalidate. Calling Next's cache API outside a
  request context throws, which would make every command untestable from a script.
- **`redirect`** — `create_digest` returns the new id; where the browser goes next is the form's business.
- **FormData itself.** Values arrive as native types (`urls: ["https://…"]`, `days: 3`) and are flattened by
  `normalizeFieldValue` before reaching `parseSectionFields`, so the schema stays the single interpreter of
  what a field means rather than each caller pre-formatting its own strings.

`update_digest` takes a **patch**, not a whole object: only the keys present are written. Forms always send
everything, so nothing changes for them — but "rename this digest" from any other caller must not blank the
voice it never mentioned.

Deliberately **not** commands: `preview`, `run now`, `regenerate`. Those aren't config edits — they're the
pipeline, they already have routes, and they cost money. This module is the surface where writes are cheap
and reversible, and that distinction is worth keeping visible.

### The lost update, and `sections_version`

Sections are one jsonb array, so every section command is `SELECT sections` → modify in JS → `UPDATE
sections = <whole new array>`. Nothing tied the write back to what the read saw, so a writer that committed
in between was **silently overwritten** by an array computed from stale data.

With one human in a form the window is milliseconds. A second writer makes it real, because an agent's
window is long — it reads at the start of a turn, thinks for twenty seconds, then writes:

```
you:    read v7 ── edit a section ── write ✓
agent:  read v7 ──────── thinks ──────────── write (array from v7)   ← your edit is gone
```

So `digests.sections_version` (migration `20260803140000`) is a counter every section write must match and
then bumps, checked in the same statement:

```ts
.update({ sections, sections_version: v + 1 })
.eq("id", digestId)
.eq("sections_version", v)     // compare-and-swap
.select("id")                  // ← makes "zero rows" observable; a plain update reports no error
```

Detection, not locking — the same mechanism as HTTP `ETag`/`If-Match`. Zero rows raises `ConflictError`.

**There are two windows, and only the caller knows about the long one.** The short one is inside
`applyCommand` (read, modify, write) and is guarded for free by the version just read — which is all a form
needs and why forms pass nothing. The long one belongs to an agent, so `ToolCtx.sections` holds the version
the loop read at the start of the turn, and every write is checked against *that*. It is deliberately not a
tool parameter: a model echoing a version back correctly on every call is not a property worth depending on.
The holder is updated after each successful write, or the agent's second write conflicts with its own first.

**The response to a conflict is the interesting half.** An agent must not retry — a retry re-applies an
intent computed against a configuration that no longer exists. It re-reads and reconsiders. That is the same
staleness fence the context design uses in the prompt, appearing here at the data layer.

Two things this deliberately does not do. It does not cover **scalar settings** (`update_digest` writes only
the keys it was given, so concurrent patches of different columns cannot clobber). And it does not narrow
the write to one array element — a `jsonb_set` RPC would let writers touching *different* sections never
conflict at all, and is the optimization to reach for if conflicts turn out to be common. Normalizing
sections into their own table is the textbook answer and is off the table on purpose: `sections` as jsonb is
policy-as-data, which is what makes a new source kind an adapter rather than a migration.

Rough edge worth knowing: two racing *form* submits now surface an error page rather than silently taking
the last write. Better, but the forms have no conflict UI — the window is milliseconds, so this is logged
rather than solved.

## The agent

`lib/digest/agent/loop.ts` — one turn: the reader says something, the model reads and edits the digest
through the belt below, and it ends with something said back. `scripts/smoke-agent.ts` drives a turn with no
UI at all.

```
runAgentTurn ─► callModelStep ──► tool calls? ──yes──► runTool (in order) ─┐
                     ▲                                                     │
                     └─────────────── tool results ────────────────────────┘
                                       │no
                                       └──► text back to the reader
```

What it is **not**: no self-chaining, no durable run row, no watchdog. The DNA agent in the main app has all
three because Supabase's worker dies at ~150s and a long turn must survive being cut in half. This is Next
on Vercel — 300s and streaming on the ordinary Node runtime — so a turn is one request that runs to the end.
Porting that machinery would import a workaround for a constraint we don't have.

Four decisions worth not undoing:

- **The system prompt is static-then-volatile.** The constitution first (so a cache prefix can hold it),
  then `<digest_state>` re-read from the database every turn. State that comes from a query cannot be stale,
  which is what stops a long conversation reasoning from a section that was deleted twenty messages ago.
- **The constitution is short.** The tool descriptions already carry what each kind is and what each field
  means, generated from `sectionSchema.ts`. Restating any of it in the prompt would be the second copy.
- **Tool calls run in sequence, not in parallel.** They write to one jsonb array through one version
  counter, so a parallel pair would race and the second would lose.
- **`execute` never throws.** A malformed argument, a refused write, a lost race — each is something the
  model can respond to sensibly if told plainly, and an unrecoverable turn if not. The conflict case says
  *re-read and decide*, explicitly not *retry*.

**Open question for the owner:** the agent is currently behind the same `aiEnabled(digest)` gate as the 6am
pipeline, so a digest with AI writing off cannot use it. That may be backwards — an AI-off digest still
delivers a perfectly good plain linked list, and the agent is exactly the thing that would help someone set
one up. The pipeline gate is about *unattended daily* spend; the agent is a *user-initiated* action, closer
to Preview. Worth deciding deliberately when the entitlement model lands.

## The agent's tool belt

`lib/digest/agent/tools.ts` is the **third consumer of `sectionSchema.ts`**: the form renders from that
declaration, the parser enforces from it, and here it becomes JSON Schema. `hint` becomes the field's
`description` — the same sentence that stops a human filling the form wrong is the one that stops the model.
Add a field to a kind and the form, the parser and the tool all gain it in one edit, which is the only
version of "everything the user can do, the agent can do" that survives a second month of development.

Six reads, eleven generated `add_<kind>_section` tools, and four writes. All writes land in `applyCommand`;
nothing here does its own read-modify-write.

Three decisions worth not undoing:

- **The digest id is ambient, never a parameter.** One thread per digest, so `ToolCtx` carries the id and no
  tool exposes it. That's a security property, not a convenience: there is no argument the model can emit
  that reaches someone else's digest, and no prompt that can talk it into trying.
- **`create_digest` is deliberately absent.** The agent works *inside* a digest; creating one stays a form.
  Admitting it would mean an unscoped tool purely for symmetry, which is how the invariant above dies.
- **`update_section` merges before writing.** The command replaces the whole section — right for a form,
  which always submits every field, and a trap for anything else: an agent changing a title would silently
  drop the urls and then be refused for the missing required field. The merge is the adapter doing protocol
  translation. `kind` comes from the stored section, so "change the title" can't turn a feed into a search.

Reads return **compact text**, and none of them returns a body or a whole issue unless asked for by id. In a
tool loop the transcript is dominated by tool results, not by anything anyone typed, and the corpus is a
query away — so it doesn't need to be resident in context.

`scripts/smoke-tools.ts <digestId>` exercises the whole belt against the real project with no model and no
chat UI: that every kind has a tool, that required-in-the-schema equals required-in-the-parser, that native
values (`targets: ["cs.CL"]`) survive to the store, that a `ranked/arxiv` with no targets is refused with the
form's own sentence, and that a patch leaves omitted fields alone. It adds a scratch section and removes it
in a `finally`.

> It has already earned its place: it caught `loadReadiness` reporting **"No verified Kindle address"** on a
> digest that had been delivering for two days. `.maybeSingle()` on an unfiltered `user_data` errors when it
> sees more than one row, and the error was swallowed into a null — invisible under RLS (one row), wrong
> under a service-role client. Both account-level reads are now filtered by `owner_id` explicitly.

## Readiness — "will this work tomorrow at 6am?"

`lib/digest/readiness.ts` answers that from data, and the Sections tab renders the answer.

The failure it exists to kill is the **silent skip**. A `search` section with AI off, a `readwise` section
whose token was never entered, a `prompt` section on a non-AI digest — each of these saves happily, shows
nothing wrong, compiles without error, and simply *isn't in the issue*. Nothing in the pipeline is broken
enough to log anything, which is exactly why a separate pass has to ask.

Two levels, because they're different kinds of bad news:

- **blocking** — nothing will be delivered, or this section won't be: no sources, everything disabled, only
  a closer configured (a quiz runs *over* written sections, so alone it can never fire), digest paused, no
  verified Kindle address (the issue builds, costs what it costs, and then dies at delivery), and the four
  silent skips above.
- **degrading** — it delivers, but isn't earning its place: never built; a section that was **due** and
  produced nothing in its last N runs; a section whose posts have a **median age** over six months; an
  `inbox` section at an address nothing has ever been sent to.

Only the corpus can see the second kind — which is most of why `digest_posts` keeps what it didn't use.

Three decisions worth not undoing:

- **Derived, never stored.** No readiness table, no wizard step, nothing to migrate or backfill. Adding a
  check is adding a term to a pure function.
- **Pure, with the fetching split out.** `readiness(input)` takes rows; `loadReadiness(supabase, digest)`
  goes and gets them. So the same function can answer for a *page* (RLS-scoped) and, later, for an agent —
  which is what stops "what the screen says" and "what the agent believes" from being two opinions.
- **Cadence is consulted, not ignored.** A weekly resurfacer legitimately misses six issues in seven, so
  "produced nothing" counts only the issues where `runsToday` says it was up. That predicate moved from
  `build.ts` to `types.ts` for this — two copies of the rule would disagree the first time either changed.

It replaced the per-section ⚠ lines that used to live inside each section card: the same three checks
written a second time in JSX. One derivation, one place it renders.

**A clean digest gets one quiet line**, not a green panel congratulating itself. A status surface you learn
to ignore when it's fine is a status surface you ignore when it isn't.

## Known gaps

- **Article extraction** is the highest-risk piece: `r.jina.ai` (URL→markdown) is v1 because it has zero
  dependencies and handles JS-rendered pages. Tradeoff: article URLs go to a third party. Swapping in
  self-hosted `@mozilla/readability` touches one function (`articleText` in `adapters.ts`).
- **Source quality is the sharpest gap, and the first run showed it.** The `search` section's best available
  source was an SEO aggregator (`inkandalgorithms.systeme.io`); the model was honest about it — "all
  secondhand aggregator reporting, so treat the numbers accordingly" — but a digest that keeps citing
  content farms isn't worth reading. Needs a source-quality prior (prefer primary/lab/author sources,
  down-rank aggregators) in the gather prompt, and ideally a domain allow/deny list per section.
- **Selection is not ranking yet.** Within a feed, items are taken newest-first and capped; the editorial act
  of picking 3 out of 40 is still missing. (Fairness *across* feeds is handled — see below.)
- **Feeds carry no recency filter, and the corpus now proves it matters.** Measured on real pulls:
  James Clear **6.8y old**, Daily Stoic **3y old**, Modern Stoicism **7mo old** — against same-day items
  from Hyperallergic, ARTnews and Tricycle. Those feeds republish evergreen archives, so a "daily" quietly
  serves 2020 writing. The posts view shows the age per item and **readiness now names the offending
  section** (median over six months), but the *fix* — a `max_age_days` per section — still isn't built.
- **Narrow beats produce empty days.** The "writing craft" section correctly found nothing new in the last
  few days and shipped nothing. That's honest, but a daily cadence on a weekly-volume beat mostly yields
  silence — either widen the beat or let a section declare its own cadence (weekly, on a named day).
- **Same story, three sites = three URLs.** Dedupe is per-URL; clustering by title similarity is v2.
- **`serial` sections are owner-only.** Collaborator access via `book_access` is deliberate follow-up.
- **Readwise quote selection is a draw, not a choice.** `random` picks weighted-at-random and `review` defers
  to Readwise; neither reads the section's `instructions`, so "quotes about attention this week" is not
  expressible. The honest fix is a selection pass (rank the over-drawn candidates against the instruction)
  rather than letting a model rewrite the quotes.
- **A `readwise` section can't yet be filtered by tag or book**, and Readwise's tags are the obvious next
  handle — `randomHighlights` would take a `tag` and pass it through.
- **Readwise `random` re-reads the books list every run.** One request, no pagination beyond 1000 books.
  A very large vault would silently truncate; caching the book list per day is the fix if it ever matters.
- **EPUB.** v0 sends HTML because the EPUB builder is browser-only (`apps/web/src/lib/epub.ts`, JSZip).
  Lifting its framework-free core into `packages/shared` is the v1 follow-up — prefer an import map alias
  over a second copy; mirror drift has already bitten this repo once.
- **Images are opt-in by the writer, and it rarely opts in.** `og:image` is discovered deterministically at
  gather time (top 3 items/section) and the writer may reference one as `![](item:N)` — an index, never a
  URL, so a model-authored image URL is impossible. Referenced images are inlined as `data:` URIs so nothing
  depends on Amazon making outbound requests. **Unverified:** whether Amazon's converter renders `webp`.
  If it doesn't, narrow `OK_TYPES` in `render.ts` to jpeg/png/gif.
- **Citation link text still drifts.** The writer sometimes labels a link with the journal name while the URL
  points at the outlet that covered it, because the gather blob hands it one URL for several claims. Fixing
  it properly means per-claim source attribution out of the gather stage.
- **YouTube transcripts are effectively unavailable server-side. Measured, not assumed.** `r.jina.ai` on a
  watch page returns the page *chrome* ("Skip navigation", "Sign in", the sidebar) — ~4k characters that
  look exactly like grounding to the writer. The caption-track path (watch page → `captionTracks` →
  `timedtext&fmt=json3`) parses correctly but answers **200 with an empty body** from a datacenter IP.
  So `video` currently falls back to the video *description*: true, sourced, and thin (~250 chars). A paid
  transcript API is the fix; the seam is `transcriptFor()` in `sources/video.ts`. Podcasts that ship
  `<podcast:transcript>` are unaffected and get the real thing.
- **`ranked/reddit` is 403 from datacenter IPs** (verified). Reddit wants OAuth now. The adapter is kept
  because it works from a residential IP and costs nothing to leave in, but `hn` and `lobsters` are the
  reliable equivalents. A failing subreddit logs and returns nothing rather than emptying the section.
- **`ranked/github` unauthenticated is 60 req/hr per IP**, shared with every other tenant on that host —
  measured exhausted on the first try. Set `GITHUB_TOKEN`. Non-array responses are branched on explicitly,
  so a rate limit degrades to an empty section rather than a `.filter is not a function`.
- **`unread` has never had a non-empty pool to prove itself on** — the corpus's unused posts were all
  younger than its 3-day floor at build time. The query path is exercised (see `scripts/smoke-db-sources.ts`);
  the editorial value isn't yet.
- **No feedback loop yet.** `digest_issues.content` already stores source items per section so a 👍/👎 in
  the reader can map back to a concrete source and accrete into the digest's voice. The hook exists; the
  gesture doesn't.
