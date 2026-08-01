-- Per-digest kill-switch for Anthropic web_search.
--
-- WHY A FLAG AND NOT JUST "don't add search sections": the `search` adapter is the only part of the pipeline
-- that costs real money on every run — it drives Opus with the web_search server tool, while `feed` gather is
-- a plain HTTP fetch and `serial`/`prompt` cost nothing to gather at all. A section quietly left enabled bills
-- every single morning, forever, with nobody watching. This makes that spend an explicit, visible decision.
--
-- DEFAULT FALSE on purpose: the expensive path should be opted INTO. Existing rows get false too, which
-- deliberately disables the search sections already configured — they can be re-enabled with one checkbox,
-- and a silent bill is a worse failure than a section that visibly stops.
alter table public.digests
  add column if not exists web_search_enabled boolean not null default false;

comment on column public.digests.web_search_enabled is
  'Opt-in for `search` sections (Anthropic web_search, the only per-run paid gather path). When false, search sections are skipped and reported; feed/serial/prompt are unaffected.';
