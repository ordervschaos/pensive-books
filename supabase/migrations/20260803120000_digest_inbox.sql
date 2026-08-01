-- digest_inbox — mail sent TO a digest.
--
-- Every other source in this pipeline is PULL: the scheduler wakes up and goes looking. This is the one
-- PUSH source — the sender delivers, we store, and the 6am build reads what arrived. That inversion is the
-- point, because the best writing on the internet stopped being in RSS and became newsletters, and a
-- newsletter cannot be polled.
--
-- It also sidesteps the pipeline's hardest unsolved problem. Source quality is a ranking problem for
-- `search` and `feed`; here the reader already solved it by subscribing. Curation is free.
--
-- SHAPE: Mailgun holds a catch-all route for the inbound domain and POSTs each message to
-- /api/inbound/mailgun. The route verifies Mailgun's HMAC, resolves the recipient's token to a digest, and
-- inserts one row. Nothing else in the app writes here.

-- Each digest gets its own address: read+<token>@<inbound domain>. A token rather than the digest id, so
-- knowing someone's digest exists doesn't let you post into their morning.
ALTER TABLE public.digests
  ADD COLUMN IF NOT EXISTS inbox_token text UNIQUE DEFAULT substr(md5(gen_random_uuid()::text), 1, 12);

-- Backfill: rows created before this column existed have no token, and a null token means the digest has
-- no address at all (its inbox sections would silently never fill).
-- (md5 of a random uuid rather than pgcrypto's gen_random_bytes: pgcrypto lives in the `extensions` schema
-- on Supabase and is not on the default search_path, so the obvious spelling fails at migration time.)
UPDATE public.digests SET inbox_token = substr(md5(gen_random_uuid()::text), 1, 12) WHERE inbox_token IS NULL;

COMMENT ON COLUMN public.digests.inbox_token IS
  'Routing token for this digest inbound address (read+<token>@...). Unguessable so a third party cannot inject into someone morning.';

CREATE TABLE IF NOT EXISTS public.digest_inbox_messages (
  id          bigint generated always as identity primary key,
  digest_id   bigint not null references public.digests(id) on delete cascade,

  sender      text,           -- envelope From, e.g. "newsletter@stratechery.com"
  sender_name text,           -- display name when the header carried one
  subject     text,
  body_text   text,           -- Mailgun stripped-text when present, else body-plain. THE grounding.
  body_html   text,           -- kept for a future richer render; the pipeline reads body_text
  -- List-Id / List-Unsubscribe presence is how a newsletter announces itself; stored so a future filter
  -- can prefer real subscriptions over one-off forwards without re-parsing headers.
  list_id     text,
  -- RFC Message-Id. The dedupe identity for mail: Mailgun retries on any non-2xx, and a retry must not
  -- produce a second copy of the same newsletter.
  message_id  text,

  received_at timestamptz not null default now(),

  CONSTRAINT digest_inbox_unique_message UNIQUE (digest_id, message_id)
);

CREATE INDEX IF NOT EXISTS digest_inbox_recent_idx
  ON public.digest_inbox_messages (digest_id, received_at DESC);

COMMENT ON TABLE public.digest_inbox_messages IS
  'Newsletters and forwards delivered to a digest own address. The only push source in the pipeline; written solely by /api/inbound/mailgun under the service role.';
COMMENT ON COLUMN public.digest_inbox_messages.message_id IS
  'RFC Message-Id, unique per digest. Mailgun retries any non-2xx, so this is what stops a retry becoming a duplicate.';

-- RLS: the owner may read and delete their own mail; nothing authenticated may INSERT. Insertion is the
-- webhook's job, and it runs with the service role — a browser being able to write here would mean anyone
-- could fabricate a "newsletter" in someone else's digest.
ALTER TABLE public.digest_inbox_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owners read their inbox" ON public.digest_inbox_messages;
CREATE POLICY "owners read their inbox"
  ON public.digest_inbox_messages FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.digests d WHERE d.id = digest_id AND d.owner_id = auth.uid()));

DROP POLICY IF EXISTS "owners delete their inbox" ON public.digest_inbox_messages;
CREATE POLICY "owners delete their inbox"
  ON public.digest_inbox_messages FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.digests d WHERE d.id = digest_id AND d.owner_id = auth.uid()));
