-- The guided-flow objective must only drive skill-loading when the author explicitly asked to advance
-- it (the "Next" nudge), not on every free-typed message — a concrete ask that happens to miss the
-- skill triggers' regex vocabulary was silently falling back to whatever playbook the CURRENT objective
-- matched, regardless of what was actually asked. Persisted per-turn like context_objective/context_auto
-- so it survives auto-mode's chain continuations (which append no new transcript message of their own).
ALTER TABLE "public"."book_agent_runs"
  ADD COLUMN "context_follow_objective" boolean DEFAULT false NOT NULL;

COMMENT ON COLUMN "public"."book_agent_runs"."context_follow_objective" IS
  'True only when the turn that (re)started this run was an explicit guided-flow advance (the "Next" nudge), not a free-typed message. Gates whether the objective is allowed to drive skill-brief selection; persists across auto-mode chain links until the next real message flips it.';
