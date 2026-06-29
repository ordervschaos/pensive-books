-- Auto-accept mode for the agent thread: when on, the agent runs autonomously (it weighs options and
-- commits the strongest itself, never parks on ask_author) and the client auto-applies its proposals.
-- Carried per-run like the scope/effort context so every chain link sees it.
alter table book_agent_runs
  add column if not exists context_auto boolean not null default false;
