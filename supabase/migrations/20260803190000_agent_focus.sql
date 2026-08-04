-- Agent focus (docs/agent-focus.md slice 1) — the author's DECLARED "what we're working on".
--
-- The agent already had a mode: derived from the journey stage, invisible to the author, and
-- unoverridable (the `discovering` / `inInterview` / three-state-objective predicates in
-- book-agent/context.ts). These columns promote it to a declaration the author owns.
--
-- Follows the existing flat `context_*` convention on this table (context_effort / context_auto /
-- context_attached_ids …) rather than a jsonb blob — every other per-turn context knob is a flat
-- scalar, and jsonb here would invite partial-merge hazards for no gain.
--
-- NULL semantics are load-bearing: `context_focus_mode IS NULL` means "the author declared nothing —
-- use the derived stage", so no `set_by` column is needed. A stored value is BY DEFINITION
-- author-declared. That is "derived proposes, author disposes" expressed as a nullable column, and it
-- is also the degradation rule: NULL ⇒ the assembled prompt is byte-identical to pre-focus behaviour.
--
-- NOTE the tray (`context_attached_ids`) is deliberately NOT folded in here. Pinned nodes are
-- author-owned and outlive any single mode; merging them would tie the tray's lifetime to the mode's
-- (docs/agent-focus.md §3).

alter table public.book_agent_runs
  add column if not exists context_focus_mode text,
  add column if not exists context_focus_target text,
  add column if not exists context_focus_at timestamptz;

comment on column public.book_agent_runs.context_focus_mode is
  'Declared focus mode key (agent-focus.ts FOCUS_MODES). NULL = no declaration; use the derived stage.';
comment on column public.book_agent_runs.context_focus_target is
  'The book_nodes id this focus operates ON (0 or 1, per the mode''s target arity). NULL for none-arity modes.';
comment on column public.book_agent_runs.context_focus_at is
  'When the author declared this focus — powers the stale-focus resume confirm (docs/agent-focus.md §6).';
