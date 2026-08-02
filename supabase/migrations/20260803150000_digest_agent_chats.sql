-- Conversations with the digest agent. One ROW per chat, not one growing blob on the digest.
--
-- The main app learned this the expensive way: archived agent sessions lived in a jsonb column on the run
-- row, which made "New chat" slow and — because that table is REPLICA IDENTITY FULL — turned every message
-- into a Realtime payload carrying the entire history. A separate table with one row per conversation costs
-- nothing extra and cannot grow that way.
--
-- `messages` is the MODEL's view of the conversation: user turns, assistant turns (with their tool calls),
-- and tool results, in the shape `lib/digest/llm.ts` speaks. Storing the model's view rather than a
-- prettified one means a follow-up turn can be replayed exactly, and the display can always be derived from
-- it — the reverse is not true.
--
-- Deliberately NOT trimmed here. Keeping the whole record is right for a table; deciding how much of it to
-- SEND is a per-turn question that belongs in the agent, and conflating the two would mean losing history to
-- save tokens.
CREATE TABLE IF NOT EXISTS public.digest_agent_chats (
  id         bigint generated always as identity primary key,
  digest_id  bigint not null references public.digests(id) on delete cascade,
  owner_id   uuid   not null default auth.uid() references auth.users(id) on delete cascade,

  -- First thing the reader said, trimmed. Enough to pick a conversation out of a list.
  title      text,

  messages   jsonb not null default '[]'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  CONSTRAINT digest_agent_chats_messages_is_array CHECK (jsonb_typeof(messages) = 'array')
);

-- The rail opens on the most recent conversation for this digest, which is the only access pattern so far.
CREATE INDEX IF NOT EXISTS digest_agent_chats_recent_idx
  ON public.digest_agent_chats (digest_id, updated_at DESC);

ALTER TABLE public.digest_agent_chats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owners manage their agent chats" ON public.digest_agent_chats;
CREATE POLICY "owners manage their agent chats"
  ON public.digest_agent_chats
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public.digests d WHERE d.id = digest_id AND d.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.digests d WHERE d.id = digest_id AND d.owner_id = auth.uid()));

COMMENT ON TABLE public.digest_agent_chats IS
  'One row per agent conversation. `messages` is the model-side transcript (llm.ts Turn[]), from which the displayed view is derived.';
