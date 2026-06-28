alter table book_agent_runs
  add column if not exists context_effort text check (context_effort in ('low', 'high'));
