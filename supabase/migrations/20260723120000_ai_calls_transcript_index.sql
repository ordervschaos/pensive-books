-- ai_calls.transcript_index: the exact call↔turn correlation, RECORDED at emit time instead of
-- reconstructed later. The book-agent loop knows, before it calls the model, which slot of the
-- stored transcript the assistant reply will land in (baseTranscript.length in advance.ts) — one
-- integer that makes "which LLM call produced this turn?" an exact join instead of index
-- arithmetic. Index arithmetic breaks whenever a done call produced no message in the CURRENT
-- slice (archived-session history shares the same task_id, aborted tails, judges) — observed as
-- the dev inspector chipping a turn with its neighbour's call.
--
-- Scoping note: a thread's transcript resets on every "New chat" (the old slice moves to
-- book_agent_sessions), so transcript_index alone is unique only within a slice; consumers
-- disambiguate by time window (calls between session ended_at boundaries). Null on rows from
-- callers that aren't transcript-shaped (prose, evals, judges) and on all rows before 2026-07-23.
alter table public.ai_calls add column if not exists transcript_index int;

comment on column public.ai_calls.transcript_index is
  'Stored-transcript slot the assistant reply of this call landed in (book-agent loop; advance.ts baseTranscript.length). Exact call↔turn join, unique per thread SLICE (transcript resets on New chat — disambiguate by session time window). Null: non-transcript callers and pre-2026-07-23 rows.';
