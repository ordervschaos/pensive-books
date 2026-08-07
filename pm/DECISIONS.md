# DECISIONS — append-only log

> One entry per consequential call: **date · decision · why · what it replaced.** Newest first.
> Full architecture decision records live in `docs/adr/` — link them from here.
> A decision belongs here if someone six weeks from now might ask "wait, why is it like this?"

## Log

### 2026-08-07 — The digest leaves the monorepo; `serial` is cut; the shared database stays

Owner call, on the premise that **the digest's user base is not the books app's user base**. Three
decisions in one, worth separating because they have different half-lives.

**1. `serial` is removed.** The "read a page a day out of one of your Pensive books" source kind was
the only code that touched `books`/`pages`, and the only writer of
`books.digest_bookmarked_page_index`. It was therefore the only *product* tie between the two apps —
everything else is infrastructure. Owner: not wanted. Cutting it first is what turned the repo
boundary from a negotiation into a straight line. (Replaces: a cross-context read that would have
had to become an exported Pensive API the moment the two products diverged for real.)

**2. `apps/digest` → its own repo, fresh history.** Not a service split — a **versioning and
deployment** split. The audit (`doc_1786100844096.md`) is the evidence it was cheap: zero
shared-package imports, zero cross-app imports, its own Vercel project since 2026-08-01, and one
~55-line anti-corruption layer (`lib/pensive.ts`) as the whole outward surface. Fresh init over
`git subtree split` by owner preference; the pre-split history stays here and stays recoverable.

**3. The Supabase project is NOT split (Tier 0, deliberately).** The digest still rides
`auth.users`, the shared `.pensive.me` session cookie (**it has no login UI at all** — middleware
bounces to `app.pensive.me/auth`, and the SPA owns refresh because `navigator.locks` cannot
coordinate across subdomains), `user_data.kindle_email`, `ai_calls`, the approved Mailgun sending
domain, and two pg_cron jobs. Tier 1 — own project, own auth, own Kindle OTP, data migration — is
1–2 weeks of *product* work and was explicitly not attempted. **The digest is separately versioned
and deployed; it is not separately operated.** Anyone reading "it has its own repo" as "it is
independent" will be wrong in exactly six places, listed in that repo's README.

Consequence accepted knowingly: the 13 `digest_*` migrations **moved** rather than being copied, so
`supabase/migrations/` here no longer describes the full schema of the database it pushes to.
`db push` remains correct (extra remote rows are not an error); a from-scratch rebuild is not.
`supabase/migrations/README.md` is that caveat written down, and the ownership split between the two
repos is convention, not mechanism.

### 2026-08-07 — "Studio" is the external product name; "DNA" stays the internal engine term

Owner call. Building the studio.pensive.me entrance forced a naming decision: routes, page components,
and UI copy that said "DNA" (`/dna/tree`, `DnaTreePage`, nav breadcrumbs) are renamed to "Studio"
(`/studio/tree`, `StudioTreePage`). The internal data-model vocabulary — `novelDna.ts`, `dnaSchema.ts`,
the `book_nodes` table, the `/dna/docs/architecture` admin atlas — is deliberately **not** renamed.

**Why.** These are two different concepts that happened to share a word: "DNA" is the metaphor for the
tree structure a book is grown from (foundations → structure → scenes → prose); "Studio" is what a
writer calls the product surface where they direct that growth. Sweeping the engine's internal naming
too would have touched ~25 lib files and every test that imports them, for no reader-facing benefit, and
would have blurred a distinction that's useful to keep sharp when reasoning about the codebase (data
model vs. product surface). Also chose a **hostname-rewrite** on the existing `apps/marketing` SSG
project over a new bounded-context app (the `apps/digest` shape) for `studio.pensive.me`, since it's a
sales entrance with no backend of its own — a new app would have meant a fourth Supabase-cookie
consumer and a second SSG site competing with `pensive.me` for the same SEO surface.

**What it replaced.** No prior standing on this — first time the product surface needed a name distinct
from the engine's internal metaphor.

### 2026-08-02 — The digest agent is free for everyone; the paid gate stays on the pipeline

Owner call. The agent shipped behind `aiEnabled(digest)` — the same `digests.ai_enabled` gate the 6am
pipeline uses (2026-08-01 above). Removed: it now has its own predicate, `agentEnabled()`, which honours
only the `DIGEST_AI_ENABLED` ops kill-switch.

**Why.** `aiEnabled` guards *unattended, recurring* spend — a job that bills every morning whether anyone is
watching — which is why it defaults off and lives per digest. The agent is neither unattended nor recurring:
it costs something only when a reader presses send, making it closer to Preview than to the scheduler. And
the gate inverted who got helped. An `ai_enabled=false` digest is a complete, useful product (a plain linked
list), and the agent is exactly what helps someone build one — so the people who most needed setup help were
locked out, while the people who could reach it had already paid. It was also a wall in front of its own
pitch: the agent is where someone would discover they want AI writing.

The pipeline's dev-default-off is dropped for the agent too — "don't quietly spend while iterating" is a
real hazard for something on a timer and not for something that fires on a keypress.

**What this owes.** Metering, and it must not be skipped: a conversation has no natural bound (Preview is one
compile; a chat is as many turns as someone likes, each up to `MAX_STEPS` tool-calling steps). `ai_calls`
already records every call with `source='digest'` and `operation='turn'`, so turns-per-user-per-day is a
query against data we already keep — no new table. Past an allowance the refusal becomes the pitch.

Replaces: nothing shipped; the agent had been gated for one day and never released that way. `9cecd84`

### 2026-08-02 — The agent rail is docked beside every digest tab, not a tab of its own

Owner call, choosing between a docked side panel, its own tab (as first built), and a panel on the Sections
tab only. The agent edits the same configuration the tabs display, so the point is watching the sections
list change as it works — which requires both on screen. Mounted in `app/digests/[id]/layout.tsx`, so the
conversation also survives tab navigation: App Router swaps `children` without remounting the layout, and
`router.refresh()` re-renders the server components around the rail without discarding its state.
Collapsible, and it stacks under the page below `lg` rather than becoming a drawer to build and maintain.

Replaces: the `/digests/:id/agent` tab, deleted. `9cecd84`

### 2026-08-01 — Digest AI moves behind a paid gate; the pipeline defaults to mechanical

Owner call: the digest pipeline was calling a model too readily. Direction going forward — most of the
pipeline should work with **no LLM at all**, with AI as an explicit paid add-on, off by default outside
production. Audited all 4 call sites (search gather, select triage, write, quiz closer — all through one
`callModel` chokepoint) and gave each a mechanical fallback (raw item list, pre-select feed order) except
the two that are pure generation (`prompt` reflections, the quiz), which simply don't run without AI.
Gated by a new `digests.ai_enabled` column (default false) — the seed for the real paid-entitlement work
already on the roadmap (Now #2), not a full billing system built now — plus a `DIGEST_AI_ENABLED` env
override for local testing / an ops kill-switch. See WORKLOG 2026-08-01 "Digest AI gated behind a paid
tier" for the full file list.

### 2026-08-01 — Digest gets a second contract (`Closer`), a push source, and per-section cadence

Six new source kinds landed at once (`ranked`, `inbox`, `unread`, `sitewatch`, `video`, plus the closer
`quiz`). Three structural calls inside that, in descending order of "someone will try to undo this":

**`Closer` is a separate contract from `Adapter`.** `quiz` consumes the sections that were already
written rather than retrieving anything. Modelling it as an Adapter would have meant pushing fake Items
through the writer stage, and the ordering constraint (closers must run last) would have lived in a
comment. So: `ADAPTERS` deliberately has **no** `quiz` entry, `CLOSERS` does, and `compile()` splits the
section list on `isCloser(kind)`. The ordering is now a property of the type. This is also the seam for
every future "reads the issue" kind — a letter framing, a "what to make of all this".

**The digest now has a PUSH source.** `inbox` is mail delivered to `read+<token>@…` (Mailgun catch-all →
`/api/inbound/mailgun` → `digest_inbox_messages`), read by the 6am build. Two reasons it earns the extra
moving parts: the best writing on the internet stopped being in RSS and became newsletters, which cannot
be polled; and it **sidesteps the pipeline's hardest unsolved problem** — source quality is a ranking
problem for `search` and `feed`, but here the reader already solved it by subscribing. Fail-closed HMAC
(no `MAILGUN_SIGNING_KEY` = reject everything), because unverified inbound text would reach the writer
stage as *sourced material*. Status codes are Mailgun's retry protocol, so unknown recipient → 200 (a
retry can't fix a nonexistent address) but DB failure → 503 (the mail is real; retry works).

**Cadence is per section, not per digest.** `daily | weekdays | weekly` + `weekday`, evaluated against the
*local* issue date. Half the useful kinds are weekly by nature (`unread`, resurfacing, a narrow beat), and
forcing them onto a daily rhythm is precisely how a reader learns to expect empty sections — the failure
the README already logged as "narrow beats produce empty days". `undefined` means daily, so nothing needed
backfilling.

Smaller calls worth not re-litigating: `ranked` borrows other people's ranking (HN points, arXiv category,
release recency) instead of building one, which is the cheap answer to the standing "selection is not
ranking" gap; `sitewatch` versions the url (`?v=<hash8>`) rather than adding a table, because the dedupe
layer would otherwise suppress every change after the first; `inbox` items get a synthetic never-fetched
permalink because the whole pipeline keys identity on `sha256(canonical url)` and mail has none.

**Measured, not assumed** — YouTube transcripts are effectively unavailable server-side: `r.jina.ai` on a
watch page returns page chrome that looks exactly like grounding, and the caption-track endpoint answers
200-with-empty-body from a datacenter IP. `video` therefore falls back to the description and never
fabricates. `reddit` is 403 from datacenter IPs; kept, labelled, fails to an empty section.

### 2026-08-01 — Readwise: per-user credential, and quotes bypass the LLM

Two calls inside the digest's Readwise source kind that someone will otherwise try to "simplify".

**The token is stored per USER, in a digest-owned table** (`digest_user_settings`), not as an env var
and not as a column on `digests`. An env var would make one deployment-level key stand in for every
user's account; a column on `digests` would make you paste the same secret once per digest and give it
two places to go stale. The token belongs to a *person* — one vault, however many digests. It also did
**not** go into `user_data` (where `kindle_email` lives): that table is the main app's, and the digest
app only *reads* it (shared kernel). Writing new integration columns into it would make two bounded
contexts co-own a table, turning a one-directional dependency into a mutual one. Second-order rule
that falls out: **per-user credentials are never env vars here** — a future integration is a column in
that table, not a new deployment secret.

**Quote sections skip the write stage entirely** and render from a template (blockquote → attribution
→ your note). Everywhere else in this pipeline the model is a transformer over fetched text, which is
a *gain*; here it can only subtract — paraphrase downgrades a quote, a connective sentence is the
padding the constitution already bans, and one mis-copied word puts words in a real author's mouth
(the same failure `REFLECTION_CONSTITUTION` exists to prevent for `prompt` sections, except here it is
avoidable outright). Consequence accepted with eyes open: `voice` and `instructions` do not reach
these sections. Choosing *which* quotes appear is a selection/ranking problem, not a writing one, and
it stays logged as a gap rather than being smuggled in by letting a model rewrite the quotes.

Related smaller call: we never call Readwise's `/review/complete/`. Marking a daily review done is a
write into the reader's own account, and a preview would silently burn the review they were about to
read in the app.

### 2026-08-01 — Morning Digest ships as a separate app at digest.pensive.me, sharing auth

New product surface: a daily digest compiled from web search / feeds / your own books, delivered to
Kindle. The design stance is the load-bearing part: a digest is **compiled from grounded sources**,
not **generated from a seed** — the inverse of the DNA pipeline. Retrieval is deterministic and the
LLM is a transformer over fetched text, never a source of facts. Enforced structurally by splitting
GATHER (no writing) from WRITE (no retrieval), so the model cannot reach for a memorized "fact".
That means it shares no method and no tables with books/pages/book_nodes.

"Separate app" was decomposed into five axes rather than taken as one switch. Separated: product
surface, codebase (`apps/digest` in this monorepo), runtime (Next on Vercel — the Node ecosystem is
where the article-extraction leverage is), and data (own tables). **Not** separated: identity and the
email/Kindle rails. Rebuilding those would re-pay for the OTP flow, a Mailgun domain that users have
already added to Amazon's approved-sender list, and the tested EPUB builder — roughly a week of
infrastructure for no product gain. In DDD terms: separate bounded context, **shared kernel**, not
separate ways.

Rejected: a full spin-out (separate repo + Supabase project). It only pays off if digest users never
touch Pensive, and it costs the Kindle rails immediately. Revisit if the digest grows its own funnel.

Consequence worth remembering: the SPA keeps **sole ownership of session refresh** for the shared
`.pensive.me` cookie. Supabase rotates refresh tokens and `navigator.locks` is per-origin, so two
subdomains refreshing the same cookie would eventually log each other out. Digest therefore reads the
cookie with `autoRefreshToken: false` and bounces to `app.pensive.me/auth?returnTo=…` when it's
stale — which is why the SPA's `returnTo` now accepts host-allow-listed absolute URLs. Same rule
`apps/marketing` already follows. Design: `doc_1785565352472.md`.

### 2026-07-29 — Version RPCs grant admins, not "anyone who can edit"
`create_book_version` / `publish_version` were the last holdouts still hand-rolling
`owner_id = auth.uid()` while `check_book_access`, `user_can_edit_book` and the books/book_access RLS
policies had all learned about `admin_users`. That drift let an admin edit another user's book and flip
its visibility but not commit — stranding books at `is_public=true` + `published_version_id=NULL`, which
the marketing reader correctly serves as a **404** (this is what took book 1326 down).

The obvious fix — point them at `user_can_edit_book`, the canonical predicate — was **rejected**: it
also returns true for invited editors, so it would quietly hand every collaborator the right to publish
a book *publicly*. That's a product call about who can push content to pensive.me, not a bug fix. Went
with the narrower `admin_users` bypass instead, matching the inline idiom already used in
`check_book_access` step 3.

`rollback_to_version` was left owner-only on purpose: its page-restore loop stamps
`owner_id = auth.uid()`, so widening the guard would reassign page ownership to the admin performing
the rollback. Fix that stamp before widening it. Migration
`20260729120000_version_fns_admin_override.sql`.

**Known gap, not addressed:** nothing enforces `is_public = true ⇒ published_version_id IS NOT NULL`.
The invariant is real, its violation is invisible in-app and only shows up as a public 404.

### 2026-07-24 — `ai_provider` switched `auto` → `deepseek` (MuleRouter balance is negative)
Building the logline eval exposed that `admin_settings.ai_provider = "auto"` was a **live production
outage**: for a `provider/model` id like `deepseek/deepseek-v4-pro`, the auto-order tries **MuleRouter
first** (`autoOrder()` in `_shared/llm.ts`), and MuleRouter's balance is **-5.79 credits** → every AI call
returned `402 insufficient_balance`. Set the switch to `deepseek` (DeepSeek's own API), which the PM
roadmap already names as the intended host (honours `reasoning_effort`, counts reasoning inside
`max_tokens`, cost-attributable via `ai_calls.provider`). Replaces the `auto` default that silently
depended on a funded MuleRouter account. **Reversible / owner's call:** top up MuleRouter and return to
`auto`, or leave it on `deepseek`. Related: this same run found two reasoning-model truncation bugs
(logline forge + `read-logline` judge both starved their JSON/text at low `max_tokens` because DeepSeek's
thinking counts inside the cap) — fixed by `effort:"low"` + `max_tokens:3000` on both. See
`doc_1784887217516.md`.

### 2026-07-24 — Generation craft is author-overridable per book; the JUDGES are not
Shipped the Craft Notes tab, which turns the story-craft baked into generation into an editable,
per-book surface. Two boundaries were drawn deliberately and are the reason it looks like this:

**1. Generation bends, judging holds.** `dna-expand`'s stage prompts and the book-agent's context both
read the author's override (`craftBody()` / `<craft_overrides>`), but the semantic judges
(`read-logline`, `read-premise`) deliberately stay on the tier-1 default in `_shared/craft-kb.ts`. If the
judge grounded on the same overridden text, an author could rewrite the bar their book is graded
against and score themselves passing — the evaluator has to be the fixed point. Accepts the known cost:
generation and judging can now disagree when an override is in play.

**2. Only the author-meaningful knobs are exposed.** For the config-driven structural passes
(`node_type_configs` → cast/world/relationships/set-pieces/threads/games/acts/beats/scenes/…), the
override covers `role` (the craft phrasing) and `count` only. `schema_json` and `slots` stay fixed —
they're the machine output contract and the context gating, and editing them breaks JSON parsing rather
than changing taste. `premise` is excluded from the list entirely because it's special-cased in
dna-expand, so an override there would silently no-op — showing an editor that does nothing is worse
than not showing it.

Storage is split on shape, not concern-drift: `books.craft_overrides` (flat `{key: text}`) for the code-
const notes, `books.expansion_overrides` (nested `{target: {role, count}}`) for the config passes; both
kept off `books.craft_notes`, which was already the `{topic: note}` web-research map. Defaults for the
code consts ride a committed `craftNotes.json` mirror + lock test (the web can't import edge modules);
defaults for the config passes are read live from `node_type_configs`, which is its own SSOT — so no
mirror exists there and none should be added. Replaces: craft that was hard-coded and identical for
every book. Supersedes the chat-era `{layer: text}` craft-notes model, deleted in the DNA pivot.

### 2026-07-15 — Product docs live as a public in-product `/docs` route; markdown (not MDX) for the MVP
Stood up a stakeholder-facing documentation store as a route in the web SPA (`/docs`, `/docs/:slug`),
public/no-auth so a link is shareable. **Markdown over MDX** for the MVP: content is prose + mermaid
diagrams + code, all covered by `react-markdown` (already a dep) with a custom ```mermaid fence → lazy
mermaid renderer — zero new build config, and docs stay plain `.md` an author can edit without React.
MDX is the deliberate deferred upgrade (rename `.md`→`.mdx` + add `@mdx-js/rollup`; the registry/
layout/routing don't change) and is only worth it once a doc needs a *live interactive* component
inline. Replaces: nothing — previously product docs existed only as repo `docs/*.md` (dev-facing, not
browsable). Distinct from the admin-only `/dna/docs/architecture` atlas, which stays a bespoke
hardcoded page. Seed content authored from `docs/NORTH_STAR.md` so the pitch is truthful.

### 2026-07-15 — Cross-scene continuity is a missing "seam contract," not a prompt-tuning problem
Reported continuity loss between scenes (book 1250) traced to one root cause, not many. The prose
writer's only cross-scene signal (`buildProseDigest`, `dna-expand/index.ts:218`) fuses two unrelated
constraints into a single voice-only `<previous_page>` tag: *don't reuse the WORDS* and *don't
continue the STORY* ("open in a DIFFERENT place, time, or register"). That conflation is the direct
cause of both observed failure modes — **dropped cliffhangers** (scene 10 exits on a charged wordless
door-close; scene 11 never pays it off) and **re-narrated overlaps** (scenes 27/28 render the same
hand-clasp twice from two POVs). Underneath: continuity is a *cross-node* invariant but every
constraint in the pipeline is *intra-node* — no node computes "where does the story stand at scene N's
exit, and does N+1 continue / bridge / hard-cut from it?" Diagnosis + fix design in
`doc_1784059899060.md`. Proposed direction (not yet ratified for build): (1) split anti-echo from
continuity in the prose prompt — keep the word-level blocklist, add a separate `<previous_scene_exit>`
"move PAST this, don't re-narrate it"; (2) thread scene N's `exit` into N+1's sketch with a declared
`link: continuous | cut | same_moment_new_pov`; (3) a deterministic seam lint (`dropped_cliffhanger`,
`scene_overlap`) as verify-leg safety net. Explicitly a *separation* of the voice-only design, not a
reversal — the anti-echo guardrail (verbatim prev page was the top echo source per the prose-context
experiment) stays intact. Awaiting the author's scope call: #1 alone vs #1+#2.
**Ratified & shipped 2026-07-15:** author chose **#1+#2** (#3 seam lint deferred). Deployed to
`dna-expand` + both twins. Proven on book 1250: a seam-scan found 8 sev-2 dropped-thread breaks beyond the
reported 10→11; all regenerated through the fixed engine → **0 sev-2 breaks remain**. **Caveat (new
finding, own entry below): the fix only lands on Claude — DeepSeek drops the bridge.**

### 2026-07-15 — DeepSeek ignores the SEAM=CUT bridge instruction that Claude obeys
Repairing book 1250 surfaced a model-obedience gap. On the *identical* prepared prose prompt (same SEAM
block, same `link:"cut"` instruction to "land ONE line that acknowledges/pays off whatever the exit left
charged before settling into the new scene"), **Claude** (claude-local shim) reliably writes the bridge
line; **DeepSeek — both `deepseek-chat` and `deepseek-reasoner`** — hard-cuts to a fresh scene and silently
drops the charge. All 9 successful bridges in book 1250 were Claude; every DeepSeek regen re-scanned as
still-dropped (sev-2) and had to be redone on Claude. Why it matters: the active prod tier is **deepseek**
(cheap, timeout-safe), so the shipped seam contract underdelivers on the model that actually serves books.
Options (not yet ratified): (a) harden the SEAM instruction into a HARD first-line constraint positioned to
survive DeepSeek's weaker instruction-following; (b) route prose (or just cut-seam scenes) to Claude; (c)
accept and lean on the deferred #3 seam lint to catch+regenerate drops. Design record `doc_1784059899060.md`.

### 2026-07-13 — Ratified Vision→Structure: the vision grounds the engine and gets audited back
Sequel to the guidance-system decision below; plan in `docs/vision-to-structure.md`. The interview
now captures `brief.vision` but the derivation engine (dna-expand) never sees it, and nothing checks
the built structure back against it. Ratified: (D1) every `briefContext` call in dna-expand gains
`vision: true` — deliberately widens the earlier book-agent-only scoping; prose pipeline stays
untouched; (D2) the vision's promised plot points compile into `source:"vision"` TENTPOLES so the
existing `tentpole_unplaced` lint enforces "the author's moments get scheduled" for free; (D3) meter
palette extends with `mystery`/`violence`/`levity` — "sexual content" is the existing `heat` axis,
with `content_type` staying the hard ceiling and the target curve only shaping within it; (D4)
contract v2 derives 2–5 meters + curves from brief AND vision jointly; (D5) fulfillment is checked
by a new non-terminal `audit_vision` LLM-judge tool run at recipe checkpoints (after cast, after
beatsheet) — no deterministic lint over free text; (D6) no journey/ladder changes — upgraded
STEP_RECIPE texts carry the nudging; (D7) the vision is a living document, capturable at any stage.
Key discovery during planning: the meter verify cascade (`target_drift`/`read_gap` + `targetGap`)
already exists — this plan feeds it vision-shaped targets rather than building new machinery.

**Update, same day:** added D8 — the sufficiency rubric ("what does fulfilled look like") is tier-1
craft defined ONCE as `VISION_RUBRIC` in a new `_shared/vision-craft.ts`, embedded verbatim by both
the `audit_vision` judge prompt and a new `vision-fulfillment` skill in `agent-skills.ts`. The
original spec shipped the tool plumbing without the rubric, which would have left the judge to
free-associate what "enough structure" means.

**Update, same day (2):** added D9 — the interview gets a `vision-interview` skill injected by BOOK
STATE, not ask triggers. Found while answering "is there an interview skill?": the shipped
three-state injection has a hole — an author's mid-interview ANSWER ("my protagonist is a
lighthouse keeper") is a concrete message, so the objective (and `STEP_RECIPE.interview` inside it)
is omitted on exactly the turns where the interview happens, and worse, "protagonist" trips
character-craft's triggers, injecting the node-editing playbook mid-interview. Fix: during
discovery (vision neither compiled nor skipped + fresh tree — the journey gate's mirror),
`threadSystem` injects vision-interview every turn and suppresses ask-triggered skills. First
state-injected skill; establishes the channel (ask-triggered · objective-fallback · state-pinned).

### 2026-07-13 — "Zero callers" audits must check real invocation logs + the deployed branch, not static grep
A dead-code audit (retiring eval-bridge, then auditing ~20 candidate edge fns) grepped only the
current feature branch's client code for callers. That branch is 43 commits ahead of `main`, and
`main` — not this branch — is what Vercel `pensive` actually deploys to production. `main` still
ships UI (`ladder.ts`, `revisionChat.ts`, `beatSheet.ts`) this branch already deleted as unmerged
pivot work, so functions that looked dead here were receiving real production traffic. `dna-chat`
(deleted+undeployed, since restored) had a real call on 2026-07-10; `revise-chat` (on the delete
list, not yet executed) had one on 2026-07-11. The `dna_chats` Postgres table was dropped after
confirming it wasn't *empty* (15 rows) but without checking *recency* — real data loss, PITR is
disabled, recovery is a dashboard-driven restore from the 07-13 08:30 daily backup, not yet done.
Rule going forward: a fn/table is only "dead" once BOTH (a) the actually-deployed branch has no
caller, not just the branch you're sitting on, and (b) `ai_calls`/table-row timestamps show no
recent real activity — static grep alone is not sufficient evidence for a destructive action.
Root cause (two divergent realities — a long-lived feature branch and a stale `main`) is being
addressed by merging this branch to `main` so there is one deployed source of truth.

### 2026-07-13 — Ratified the guidance-system redesign: interview-first discovery + three-state objective injection
The agent rail's guidance measured only tree completeness (`currentObjective` ladder), so fresh
books got "generate logline options" when the right move is interviewing the author, and concrete
asks got the objective injected anyway (intent pollution). Ratified design (full executable plan in
`docs/agent-guidance-system.md`): (D1) vision document at `books.brief.vision` — no migration;
(D2) direct-write non-terminal `update_vision` tool — first break from proposals-only, justified
because it records the author's own words; (D3) Interview as the premise stage's first substep,
grandfathered done for books past seed; (D4) three-state `<current_objective>` injection — omit on
concrete ask, inject on Next-nudge/empty ask, ALWAYS inject in auto mode; (D5) vision renders only
behind a `briefContext` opt, book-agent-only in v1 (byte-stability for every other prompt);
(D6) no server-initiated turns — the existing greeting + next-step card carries the kickoff.
Replaces: always-on objective marked "subordinate" (anchor-not-fence alone wasn't enough).
Implementation delegated to a smaller-model session against the plan doc.
**Amended on implementation (2026-07-13, shipped):** D3's grandfather clause widened. The plan gated it on
`seedDone` (an *accepted* seed ⇒ interview moot), but a live 141-scene book whose seed was never accepted
regressed into an interview. The gate is now "any non-seed node exists" — a fresh book is minted carrying
only the seed node, so that predicate is exactly the fresh/not-fresh line. Everything else shipped as
ratified; live-verified end-to-end (interview → capture → compile → journey advances; all three injection
states confirmed in `ai_calls`).

### 2026-07-10 — Squashed 135 migrations into one baseline dump; `supabase start` now bootstraps from empty
`supabase start`/`db pull` had never worked from an empty database: the earliest migration
(`20250127000000_create_page_chats.sql`) already assumed `public.pages` existed, but no migration in
the 135-file chain ever created it (or most other core tables, or the `vector`/`pg_net` extensions
they depend on). The base schema was set up directly on the hosted project — dashboard/manual SQL —
before this repo adopted migration-file discipline, and was never captured. Every migration replayed
fine on the REMOTE project (which already had the base tables) but could never replay on a fresh one,
so local Docker DB parity has probably never existed here.

**Fix:** `supabase db dump --linked --schema public` (schema-only, no data — pg_dump talks straight to
Postgres, independent of migration replay, so it isn't blocked by the same gap it's fixing) captured
the schema AS IT ACTUALLY EXISTS today. The 135 old files moved to `supabase/migrations_archive/` (git
`mv`, history preserved, not deleted); the dump became the one new migration,
`20260710140000_baseline_schema_dump.sql`, with `CREATE EXTENSION IF NOT EXISTS "vector"`/`"pg_net"`
added at the top (needed for a `pages.embedding` column and `net.http_post` trigger calls — schema
dumps don't capture extension activation, and no archived migration ever did either). Verified live:
`supabase start` bootstraps clean, `supabase functions serve` serves all 19 functions against it, and
a full request through the local gateway → edge fn → local Postgres → `callLLM` → the `claude-local`
shim → real `claude -p` → response round-tripped correctly end to end.

**Update 2026-07-10, same day:** ran `supabase migration repair 20260710140000 --status applied
--linked` on the user's explicit go-ahead. `supabase migration list` confirms `20260710140000` now
shows applied on both Local and Remote — the CLI marked it applied without executing it (nothing ran
against the live schema; every object already existed there). A future `supabase db push` will treat
it as already-applied and skip it, so the next push is safe.

### 2026-07-10 — Provider is an explicit setting, not a naming convention; DeepSeek's own API satisfies the escape clause
Shipped `ai_provider` (`auto|anthropic|openrouter|deepseek|mulerouter`) in `admin_settings`, read at
the `callLLM` chokepoint. **Replaces** routing-by-model-id-shape (a `/` meant OpenRouter, a `deepseek`
prefix meant DeepSeek) plus an env-gated MuleRouter takeover that fired whenever `MULE_ROUTER_API_KEY`
existed — routing policy smeared across a string prefix and the presence of a secret, unchangeable
without editing code or deleting a key.

Design call: the setting is a **preference with fallback, not a mandate**. `wireModelFor(provider, model)`
is a capability matrix; a host that can't serve a model is skipped and the model falls back to its native
host. This is load-bearing, not politeness: `DIGEST_MODEL` and `IMAGE_PROMPT_MODEL` are pinned to
`qwen/qwen3-235b-a22b` regardless of tier, so a *mandating* switch set to `deepseek` would 404 the
continuity digest on every page render. `auto` reproduces the old order exactly → no behaviour migration.

**This amends the entry directly below.** That decision parked the agent role on Anthropic "until either
a router forwards a thinking bound or agent calls move off-worker." Probing `api.deepseek.com` directly
(deepseek-v4-flash, `max_tokens: 3000`): `reasoning_effort: "low"` cut reasoning 860 → 406 tokens, and
reasoning **counts inside `max_tokens`** (`finish_reason: "length"` at exactly 3000). Both bounds Anthropic
gives us. DeepSeek's direct API is therefore the first *cheap* host with a boundable agent loop — the escape
clause is satisfied, and `reasoningParamsFor(…, "deepseek")` now emits `reasoning_effort`. Not yet exercised
on a live full-book build; that's Now#1's job. Active config: `ai_provider=deepseek`, `ai_model_tier=deepseek-v4`.

Also logged `ai_calls.provider`: `model` records what the caller *asked for*, and the same id is servable by
three hosts, so without the column the switch is unfalsifiable — the first green e2e test proved nothing.
A spend switch you can't observe isn't a spend switch. Incidental finding: `deepseek-chat` no longer names a
model — it is a silent alias for `deepseek-v4-flash`.

### 2026-07-09 — Amendment: qwen3.7-plus reasoning is unboundable via routers; fix verified on Anthropic path
Follow-up to the same-day timeout decision below. Both fixes deployed; live result: **17
post-deploy book-agent turns, 0 timeouts** (was ~37% error rate) with `max_tokens: 5000` on the
sonnet tier. But controlled probes (hard planning prompt, n=2–3 per condition) falsified the
"map the effort param" half for qwen: MuleRouter's `/vendors/openai` facade silently drops
`reasoning_effort`, `reasoning:{effort}`, `thinking_budget` and `enable_thinking` (all ~7.4k
completion tokens / 200–390s, indistinguishable from baseline), and OpenRouter ignores
`reasoning:{effort}` for this model; qwen's thinking also does NOT count against `max_tokens`.
The mapping ships anyway (documented intent, harmless, works the day a router forwards it).
Operative decision: **the agent role belongs on an Anthropic tier** (current default) until
either a router forwards a thinking bound or agent calls move off-worker like prose. Also
flagged operationally: OpenRouter credits exhausted — `dna-expand-digest` (qwen3-235b, no Mule
equivalent) failing 100% with 402 during live renders; needs top-up or a model re-point.
Details: `doc_1783607491000.md`.

### 2026-07-09 — book-agent timeouts root-caused to dropped effort param; fix plan set
~37% of book-agent calls were dying at the 140s abort in streaks of 2–3 (each billed — abort
doesn't stop provider-side generation). `ai_calls` evidence: latency tracks output tokens
(~55 tok/s → the timer fits ~7k generated tokens vs `max_tokens: 8000`), not input — 70k-token
prompts prefilled fine in ~20s while a 25k-token prompt timed out 3× on identical retries. Root
cause: the `anthropicToOpenAI()` adapter in `_shared/llm.ts` drops `output_config`/`thinking`,
so the `effort:"medium"` bound book-agent sends never reaches qwen on the MuleRouter path — it
only ever worked on the Anthropic path (silent contract break; the "too much context" hypothesis
was falsified, transcript compaction is working as designed). Agreed fix order: (1) map effort →
OpenAI-side `reasoning:{effort}` in the adapter, (2) lower agent `max_tokens` to ~5000 to fit
the timer, (3) degrade retries instead of replaying verbatim. Analysis of record:
`doc_1783599238000.md`. Replaces nothing — first principled account of these timeouts.

### 2026-07-09 — DNA UI self-explanatory pass ratified as Next, comprehensive scope
User request (two screenshots: raw schema labels in Tree, raw lint rule-ids in Analytics) to make
the whole DNA Studio self-explanatory. Audit showed the gap is mostly **discoverability**, not
missing content — plain-English copy already exists for node kinds and journey stages but is
hover-only; Analytics/lints is the one place with a real content gap (no why/fix copy) plus a
`dangling_ref` field-clarity gap. Ranked as a new **Next** item (not bumped into Now, which was
already at its 2-item WIP limit) — offered scoped-vs-comprehensive and Now-vs-Next as explicit
choices; user chose **comprehensive (all 6 tabs)** and **Next** rather than folding a smaller
slice into the in-flight Monetization rails v1 item. Rationale for rank: NORTH_STAR §9 explicitly
includes intuitiveness as a ranking axis, and it directly de-risks R1 (a paid studio with a
cryptic Analytics tab reads as unfinished). Audit + phased design live in
`docs/dna-ui-self-explanatory.md`; Analytics tab (first slice) has a full implementation design
as of this entry, not yet built.

### 2026-07-09 — 45 legacy books left stranded off the DNA tree (deliberate)
`migrateBookToDna` (legacy brief/foundations/spine/pages → `book_nodes`) lost its only UI trigger
when the old DnaStudio "Migrate" button was deleted in the 2026-07-03 one-studio consolidation.
Before deleting the now-orphaned function (builder loop iter 3), checked the DB: **45 books**
still have real pages + foundations/spine but zero `book_nodes` rows — this was their only path
onto the DNA tree, and none exists now. Flagged to the user with the count; explicit call was to
delete the function anyway rather than keep it unwired or rebuild the entry point. Why it matters:
those 45 books cannot reach the Studio surface without new migration code being written from
scratch — this was a conscious tradeoff, not an oversight, if anyone asks later why they're stuck
on the old rail.

### 2026-07-09 — Monetize ASAP: revenue track unhooked from M2 (owner directive)
GTM.md promoted from "thinking surface" to **committed plan v1**. The old sequencing gate ("no
pricing page before M2, paid tier = M4") is narrowed: it now guards only **generation** pricing
(R3). The mature Writing pillar (R1 Pro subscription) and the import→structure wedge (R2 per-unit)
monetize immediately — their quality doesn't depend on clearing M1, and R2's prose is the user's
own. Replaces: the blanket "no GTM before M2" stance. Monetization rails v1 takes ROADMAP Now
slot 2; both marketing and product build lists live in GTM.md.

### 2026-07-09 — Live full-book build re-exercise promoted to Now
ROADMAP had both Now slots free with the highest-leverage item (re-testing §v1/§v4 agent-loop
fixes on a live "build all") sitting as a footnote, while EPUB Layer B and REVALIDATE_SECRET —
both real but adjacent to M1 — held the two ranked Next slots. Promoted the live-build
re-exercise to Now; it tests M1's bar ("one self-generated book read end-to-end") directly.

### 2026-07-09 — All work routes through the PM via a firehose + curated view
Added `pm/WORKLOG.md` (append-only, one entry per task, **never read into an agent session** —
write-only, zero context cost) as the raw catalogue, feeding the curated STATE/ROADMAP/DECISIONS.
The `/wrap` command is the end-of-task chokepoint (catalogue → promote → stamp); a Stop hook
(`.claude/hooks/pm-worklog.sh`) enforces it so cataloguing never relies on memory (nudges once per
dirty, uncatalogued change-set, idempotent via a gitignored sentinel). Why it matters: the old
rule "after any ship, update STATE" was discipline-only and STATE tracks *projects*, not *tasks* —
there was no place to catalogue task-level work without bloating the curated files or context.
This is event-sourcing: cheap appends to the log, a hand-curated projection above it.

### 2026-07-09 — Recovered a day of unmerged work (`dna/structure-miner`)
Branch diverged from `main` 2026-07-08 same day `pm/` was created, carried out the live
agent-loop exercise (found + fixed §v2/§v3, found §v1/§v4) and shipped Structure Miner
R1/R2 — but was never merged, so `main`'s `pm/STATE.md`/`ROADMAP.md` kept describing both
as not-started. Caught by routine `/pm` drift check. Why it matters: a branch with its own
`pm/` edits can silently outrun `main`'s — check `git log --all` for stale branches with
`pm/` commits during drift checks, not just `main`'s log.

### 2026-07-08 — PM knowledgebase created (this folder)
Roadmap/state/GTM/decisions live in `pm/` as versioned markdown, separate from `docs/` design
specs. Three-hats review model (owner/PM/builder). Replaces: state scattered across memories,
docs, and chat history.

### 2026-07-03 — One studio: the tree is the only surface
Vanilla `/dna` studio deprecated; DnaTreePage is the single Studio surface (Overview ports in as
tree landing mode). Why: two half-surfaces blurred the "one job per screen" rule. Do not resurrect
DnaStudio.

### 2026-07-01 — Autopilot retired, folded into agent auto-accept
Whole-book build = the agent's auto-accept mode (propose_expansion loop), not a separate
autopilot engine. Why: one AI surface, one loop; two drivers drifted.

### 2026-06-30 — DNA substrate pivot (the anchor decision)
Build Studio + six per-layer chat rails **deleted**. The `book_nodes` DNA tree + one AgentRail
agent are the single substrate and single AI surface. Why: per-layer surfaces multiplied drift
and context loss; the tree is the source of truth, everything else is a projection.

### 2026-06 (standing) — Prose escapes the edge worker
Prose generation streams client-side via a same-origin proxy (Vercel fn / Vite middleware)
because the Supabase free-plan worker dies at ~150s (was killing ~54% of prose calls). Any
long-running generation must respect this ceiling or stream off-worker.

### 2026-06 (standing) — Model stack = OpenRouter cheap tier
Active generation tier is Qwen/DeepSeek via OpenRouter (Anthropic-shaped calls, converted).
Why: cost discipline (NORTH_STAR §7); premium models reserved for evals. Benchmark found
cheap ≈ premium on tight beats.

### 2026-06 (standing) — Structure as render
`books.outline` / the DNA tree is the artifact; pages are a deliberate `reconcile()` render.
Why: cheap JSON edits, no page-soup as truth. (See also `docs/adr/0001-public-nextjs-private-spa.md`
for the two-app split.)

### (standing) — UI is a live projection of server state
Refresh must be a no-op; subscribe via Realtime, never fetch-once. Product-wide standard.

### (standing) — Every AI activity is a durable server-owned task
Task row + self-chain + watchdog; unified stop chokepoint. New AI surfaces must join this
pattern, not invent their own lifecycle.
