-- admin_settings — a simple key/value store for admin-controlled runtime config.
-- Currently used to store the active AI model tier (opus / sonnet / deepseek).

create table if not exists public.admin_settings (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);

-- Only admins can read/write; edge functions use service_role which bypasses RLS.
alter table public.admin_settings enable row level security;

create policy "admins_read_admin_settings" on public.admin_settings
  for select using (
    exists (select 1 from public.admin_users where user_id = auth.uid())
  );

create policy "admins_write_admin_settings" on public.admin_settings
  for update using (
    exists (select 1 from public.admin_users where user_id = auth.uid())
  ) with check (
    exists (select 1 from public.admin_users where user_id = auth.uid())
  );

-- Default tier: opus (current behaviour, no change at deploy time)
insert into public.admin_settings (key, value) values ('ai_model_tier', 'opus')
  on conflict (key) do nothing;
