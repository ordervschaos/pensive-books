-- digest_user_settings — per-USER integration state for the digest app.
--
-- Why a new table rather than a column on `digests`: a Readwise token is a property of the PERSON, not of
-- one digest. Someone with a "Morning" and a "Weekly" digest holds one Readwise account, and pasting the
-- same secret twice is both annoying and a second place for it to go stale. Grain = one row per user.
--
-- Why not `user_data` (which already holds kindle_email): that table belongs to the main app's bounded
-- context. The digest app READS it (shared kernel) but writing new integration columns into it would make
-- the two contexts co-own a table. A digest-owned table keeps the coupling one-directional.
--
-- The token is stored in plaintext, deliberately and with eyes open. RLS confines it to its own user, and
-- Readwise itself displays it in cleartext at readwise.io/access_token — it is a revocable, read-scoped
-- personal key, not a password. Encrypting it here would need a server-side key in the same database and
-- would buy very little. What matters more is that the UI never renders it back: the settings form is
-- write-only and shows a masked hint.

CREATE TABLE IF NOT EXISTS public.digest_user_settings (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,

  -- The kill switch. Separate from "is a token present" on purpose: pausing the integration must not make
  -- the user re-paste their key, and a token sitting next to enabled=false is a clear "off, but ready".
  readwise_enabled     boolean not null default false,
  readwise_token       text,
  -- Set when the token last returned 204 from /api/v2/auth/. Proof of a working key at a point in time,
  -- which is what the settings page shows instead of the secret itself.
  readwise_verified_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

COMMENT ON TABLE public.digest_user_settings IS
  'Per-user integration state for the digest app (Readwise for now). One row per user; digests reference it through their owner.';
COMMENT ON COLUMN public.digest_user_settings.readwise_enabled IS
  'Kill switch, independent of token presence — pausing must not require re-pasting the key.';
COMMENT ON COLUMN public.digest_user_settings.readwise_verified_at IS
  'Last time this token returned 204 from Readwise /api/v2/auth/. The settings UI shows this instead of the secret.';

DROP TRIGGER IF EXISTS digest_user_settings_touch_updated_at ON public.digest_user_settings;
CREATE TRIGGER digest_user_settings_touch_updated_at
  BEFORE UPDATE ON public.digest_user_settings
  FOR EACH ROW EXECUTE FUNCTION public.digest_touch_updated_at();

-- RLS: strictly your own row. The build pipeline reads it with the service role, because at 6am the reader
-- is asleep and has no JWT — same reason every other pipeline read bypasses RLS.
ALTER TABLE public.digest_user_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users manage their own digest settings" ON public.digest_user_settings;
CREATE POLICY "users manage their own digest settings"
  ON public.digest_user_settings FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
