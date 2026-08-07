# A note on what is NOT in this directory

On **2026-08-07** the digest app moved to its own repo
([`ordervschaos/pensive-digest`](https://github.com/ordervschaos/pensive-digest)), and its 13
`digest_*` migrations moved with it. They are **already applied** to the shared Supabase project
`qiqeyirtpstdjkkeyfss`, so nothing here re-runs them — but it does mean **this directory alone no
longer describes the full schema of the database it pushes to.**

Consequences, so nobody rediscovers them the hard way:

- `supabase db push` from this repo is still correct. It pushes local files not yet in
  `supabase_migrations.schema_migrations`; extra *remote* rows it doesn't have locally are not an
  error, and every digest migration predates the newest one here.
- **Rebuilding this project from scratch off this directory would produce a database with no
  digest tables.** If you ever need a true full rebuild, replay both repos' migrations in timestamp
  order.
- New `digest_*` schema changes belong in the digest repo. New `books`/`pages`/`book_nodes`/agent
  schema belongs here. Two repos, one database, one linear migration ledger — the split of ownership
  is by convention, and this file is the convention.

The two pg_cron jobs the digest relies on (`digest-tick`, `expire-stalled-digest-issues`) also live
in that shared database. `expire-stalled-digest-issues` was created by a migration that has moved;
`digest-tick` was never a migration at all (it hardcodes the prod origin and needs a Vault secret) —
its runbook is in the digest repo's `SETUP.md`.
