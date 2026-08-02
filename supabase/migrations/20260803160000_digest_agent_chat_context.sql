-- What the agent SENDS, as distinct from what the chat KEEPS.
--
-- `messages` holds the whole conversation and always will — losing history to save tokens would be the
-- wrong trade, and a table is the cheapest place in the system to keep things. But sending all of it every
-- turn means turn 40 costs eight times turn 5 for no more usefulness, so the sent context is now assembled
-- per turn (lib/digest/agent/context.ts) and these three columns are what that assembly needs to persist.
--
-- fold / folded_through — a rolling summary of the exchanges that have scrolled out of the verbatim window,
--   and how many messages it covers. Written by a model call, but only when the window overflows, so it is
--   amortised across many turns rather than paid on each one. The summary keeps PREFERENCES and REJECTIONS
--   ("no hustle-culture framing", "said no to a search section, too expensive") and deliberately drops facts
--   about configuration — those come fresh from <digest_state> every turn, and a remembered one is just a
--   claim that has had time to go stale.
--
-- last_version — `digests.sections_version` as it stood at the END of the previous turn. If it has moved
--   since, someone else edited the digest mid-conversation, and the agent is told so in one line. Storing
--   the value we finished on rather than the one we started with is what keeps the agent's OWN writes from
--   triggering the warning: it already knows about those.
alter table public.digest_agent_chats
  add column if not exists fold            text,
  add column if not exists folded_through  integer not null default 0,
  add column if not exists last_version    integer;

comment on column public.digest_agent_chats.fold is
  'Rolling summary of exchanges outside the verbatim window. Preferences and rejections only — never configuration facts, which come fresh from <digest_state>.';
comment on column public.digest_agent_chats.folded_through is
  'How many entries of `messages` the fold covers. Everything after this index is sent verbatim (subject to tool-result elision).';
comment on column public.digest_agent_chats.last_version is
  'digests.sections_version at the end of the previous turn. A mismatch at the start of the next one means somebody else edited the digest mid-conversation.';
