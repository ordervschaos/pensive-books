# Digest — configure & verify checklist

Everything below was built on 2026-08-01 (six new source kinds, per-section cadence, the closer contract).
Code, schema and build are done; **these are the steps that need your hands or your credentials.**

Order matters only within a block. Each item says what to do, and what "working" looks like.

---

## A. Environment (5 min, blocks B and F)

- [ ] **`MAILGUN_SIGNING_KEY`** — Mailgun dashboard → *Webhooks* → **HTTP webhook signing key**. Add to
      `apps/digest/.env.local` **and** to the Vercel project.
      *Fails closed:* with no key the inbound route rejects every message, so `inbox` sections stay empty
      and you'd have no idea why. This is the one env var the new work actually requires.
- [ ] **`MAILGUN_INBOUND_DOMAIN`** *(only if inbound mail lands on a different domain than sending)* —
      otherwise it defaults to `MAILGUN_DOMAIN` and you can skip this.
- [ ] **`GITHUB_TOKEN`** *(optional)* — any classic read-only PAT, no scopes needed for public repos.
      Without it `ranked/github` gets 60 requests/hour **shared with every other tenant on that IP**; it was
      already exhausted when I tested. With it: 5,000/hr.
- [ ] Confirm `ANTHROPIC_API_KEY` is actually set in `.env.local` — the checked-in file still carries the
      comment "Not yet set", and `quiz` + every `write` needs it.

```sh
vercel env add MAILGUN_SIGNING_KEY production   # and preview
```

---

## B. Mailgun inbound route (10 min — unlocks the `inbox` kind)

The single highest-value new source: newsletters you already subscribe to, no polling, no source-quality
problem. Nothing works until the route exists.

> **UNBLOCKED 2026-08-01.** Mailgun validates the forward URL at route-creation time and was rejecting
> `digest.pensive.me` because nothing was deployed there:
> `"...must be publicly accessible"`. The app is now live at **`https://pensive-digest.vercel.app`**
> (verified: `/api/inbound/mailgun` answers **401**, i.e. reachable and fail-closed).
>
> **Use the `.vercel.app` URL in the route** — `digest.pensive.me` still needs an A record (§F) and
> Mailgun will reject it until then. Swap the route's URL over afterwards; nothing else changes.

- [ ] Mailgun → *Receiving* → **Create Route**
      - Expression type: **Match Recipient**, pattern `^read\+.*@pensive\.me$`
        (the `+` **must** be escaped; MX for `pensive.me` is already on Mailgun and valid, verified)
      - Action: **Forward** → `https://pensive-digest.vercel.app/api/inbound/mailgun`
        (`digest.pensive.me` once its DNS resolves)
      - Also tick **Store and notify** if you want Mailgun to keep a copy while you're testing
- [ ] Confirm the domain has MX records pointing at Mailgun (Mailgun shows this on the domain page). A
      sending-only domain will silently drop everything.
- [ ] The address is on the digest's **Settings** tab (always) and on **Sections** (once an `inbox` section
      exists). For digest 1 it is `read+8684dc4c0705@pensive.me`.
- [ ] **Verify:** send yourself a test mail to that address, then run:
      ```sh
      cd apps/digest && npx tsx --env-file=.env.local scripts/smoke-db-sources.ts 1
      ```
      Working = the message appears under `inbox`. **Or just open the digest's `Inbox` tab** — the mailbox
      is now a first-class view (subject, sender, size, used/unused, delete), so the script is only for
      when you want the adapter's own filtered output. If nothing shows, check Mailgun's route **Logs**
      tab — 401 means the signing key doesn't match the *deployed* build, 503 means the DB write failed
      (that one Mailgun retries for 8h).
- [ ] Then subscribe one real newsletter to the address, or set up a forwarding rule in Gmail.

---

## C. Try each new source (30 min, no credentials needed)

Add these to a digest and hit **Preview** (`/api/digests/:id/preview?ignoreSeen=1`, or the button). Preview
sends nothing and marks nothing seen, so this is free to repeat.

- [ ] **`ranked` / hn** — min score 150, no query. *Verified working* (returned 1343/1214/797-point stories).
      Leave `fetch_body` on (the default for HN) or the writer only gets a headline and a number.
- [ ] **`ranked` / arxiv** — targets `cs.CL, cs.AI`. *Verified working*, and it's the best-grounded source in
      the app: the abstract is real text, so there's no extraction step and no content-farm risk.
- [ ] **`ranked` / lobsters** — *verified working* (87/67/66 score items).
- [ ] **`ranked` / github** — targets `owner/repo`. Needs `GITHUB_TOKEN` (see A) or expect an empty section.
- [ ] **`ranked` / reddit** — ⚠ **403 from datacenter IPs, verified.** Expect nothing in production. Left in
      because it costs nothing and works from a residential IP. Use `hn`/`lobsters` instead.
- [ ] **`video`** — a YouTube channel url and/or a podcast RSS. ⚠ Read the transcript caveat in §E first:
      YouTube currently yields the *description* only (~250 chars). Podcasts that ship
      `<podcast:transcript>` get the real thing — that's the case worth testing.
- [ ] **`sitewatch`** — point it at a page you actually want watched. First run always emits ("now
      watching"); after that it is **silent unless the text changed**. That silence is the feature, so don't
      read an empty section as a broken one.
- [ ] **`unread`** — set `min_age_days: 0` temporarily to see the pool at all; the corpus currently holds 10
      unused posts, all younger than the 3-day default floor. Put it back to 3+ afterwards.
- [ ] **`quiz`** — needs at least one **delivered** issue to quiz (`status = 'sent'`, dated before today),
      otherwise it drops itself silently. Set it to `today` if you want to see output immediately.

---

## D. Cadence (5 min)

- [ ] Set one section to **weekly** (e.g. `unread` on Sunday, or a narrow beat). Confirm it disappears from
      the section list's "runs …" line only on the right days.
- [ ] **To test without waiting a week:** cadence is evaluated against the *local issue date*, so temporarily
      set the section's `weekday` to today's day-of-week and preview.

---

## E. Decisions I made while you were away — say if you disagree

1. **YouTube transcripts are not obtainable server-side.** Measured, not assumed: `r.jina.ai` returns page
   chrome (nav, "Skip navigation", sidebar) which would have been fed to the writer as *sourced material* —
   worse than nothing. The official caption-track path parses fine but returns 200-with-empty-body from a
   datacenter IP. So `video` falls back to the description and never fabricates. **If you want real YouTube
   transcripts, it needs a paid API** — the seam is one function (`transcriptFor` in `sources/video.ts`).
2. **`reddit` shipped anyway** despite the 403, because deleting a working-from-some-IPs adapter to save
   forty lines is a worse trade than a labelled caveat. It fails to an empty section, never an error.
3. **`quiz` became a second contract (`Closer`), not an Adapter.** It retrieves nothing, so forcing it into
   the source registry would have meant fake Items and an ordering rule enforced by comment. `ADAPTERS` has
   no `quiz` key; the pipeline splits on `isCloser(kind)`.
4. **Inbox identity is a synthetic permalink** (`digest.pensive.me/inbox/<id>`, never fetched), because the
   whole pipeline keys dedupe on `sha256(canonical url)` and mail has no url.
5. **sitewatch versions the url** (`?v=<hash8>`) instead of adding a table — otherwise the dedupe layer
   would suppress every change after the first as "already delivered".
6. **The add-section form is now kind-aware** (`AddSectionForm.tsx`, client component). A flat form with
   eleven kinds and every field always visible was unusable. Same FormData contract; `addSection` is
   unchanged in shape.
7. **Migration uses `md5(gen_random_uuid())`** for the inbox token, not `gen_random_bytes` — pgcrypto isn't
   on Supabase's default search_path and the push failed on it.

---

## F. Deploy — mostly done 2026-08-01

- [x] Vercel project **`pensive-digest`** created and linked (`apps/digest/.vercel`), root directory
      `apps/digest`, `vercel.json` carrying the same monorepo `ignoreCommand` as `apps/marketing`.
- [x] Production deployed: **https://pensive-digest.vercel.app** — root 307s to `app.pensive.me/auth`
      (session bounce working), inbound webhook 401s (fail-closed working).
- [x] Production env vars set: `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `MAILGUN_API_KEY`,
      `MAILGUN_DOMAIN`, `CRON_SECRET`.
- [x] `MAILGUN_SIGNING_KEY` set in production **and redeployed**. Vercel env vars only apply to *new*
      deployments — setting the var without redeploying leaves the old build running without it, which is
      exactly how the first forwarded newsletter died (Mailgun log: `accepted → failed / Unauthorized`).
      Note the consequence: a 401 is a **4xx, so Mailgun drops the message permanently** — anything sent
      during the broken window is gone and must be re-sent. Verified end-to-end 2026-08-01 by POSTing a
      locally-signed synthetic message: `{"ok":true,"digest_id":1}`, row inserted, adapter picked it up,
      test row deleted.
- [ ] **`digest.pensive.me` DNS.** The domain is attached to the project but unconfigured — `pensive.me`
      runs on Squarespace/NS1 nameservers, so add this at your DNS host:
      `A  digest  76.76.21.21`. Vercel verifies automatically and emails you.
- [ ] **Preview env vars were NOT set** — the pinned Vercel CLI (54.1.0) loops on `git_branch_required` even
      with `--yes`. Add them in the dashboard, or upgrade the CLI (`pnpm add -g vercel@latest`) first.
- [ ] `git add apps/digest supabase/migrations/20260803120000_digest_inbox.sql` — note the migration is
      **already pushed to the remote database** (standing authorization), so the schema is live ahead of the
      code. Nothing breaks in the meantime: the new column is nullable-with-default and the new table is
      unreferenced by the deployed build. **The deploy above was a CLI upload, not a git-connected build** —
      connect the repo in the dashboard if you want push-to-deploy.
- [ ] The pg_cron `digest-tick` job (README §Scheduling) is **still not scheduled** — unchanged by this work,
      but it's the reason nothing arrives at 6am on its own yet.

---

## Quick reference — the two smoke scripts

```sh
# network sources only: no DB, no auth, no tokens spent
npx tsx apps/digest/scripts/smoke-sources.ts            # hn, arxiv, lobsters, github, reddit, video
npx tsx apps/digest/scripts/smoke-sources.ts hn arxiv   # just these

# corpus + mailbox for one digest (service role, read-only)
cd apps/digest && npx tsx --env-file=.env.local scripts/smoke-db-sources.ts 1
```
