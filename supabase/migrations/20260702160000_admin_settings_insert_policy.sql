-- Fix: admin_settings had SELECT + UPDATE policies but no INSERT policy.
-- The AdminSettings UI writes via .upsert(), which PostgREST compiles to
-- INSERT ... ON CONFLICT DO UPDATE. Under RLS, that statement needs an INSERT
-- policy WITH CHECK to pass — even for keys that end up taking the UPDATE branch.
-- Without it every save 403'd ("new row violates row-level security policy"),
-- and the per-role tier rows (ai_model_tier_agent/_structure/_prose), which
-- don't exist yet and must INSERT, could never be created.
-- Edge functions use service_role and bypass RLS, so only the UI was affected.

create policy "admins_insert_admin_settings" on public.admin_settings
  for insert with check (
    exists (select 1 from public.admin_users where user_id = auth.uid())
  );
