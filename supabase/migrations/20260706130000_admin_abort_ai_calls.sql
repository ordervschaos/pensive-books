-- Let admins mark a stuck ai_calls row terminal ("abort" in the AI Calls admin table).
--
-- ai_calls has no update policy at all today (service role only, via _shared/llm.ts). Most calls
-- (e.g. dna-expand) log with no task_table/task_id — there's no durable task row for stopRun.ts to
-- drive, so a "running" row that outlived its edge function (worker killed before logEnd() ran) has
-- no other way to stop reading as running forever. This grants admins a narrow UPDATE, mirroring the
-- admin_users predicate already used for page_audio_blocks etc. (20260603004000).
drop policy if exists "admins_can_abort_ai_calls" on public.ai_calls;
create policy "admins_can_abort_ai_calls"
  on public.ai_calls
  for update
  to authenticated
  using (exists (select 1 from public.admin_users where admin_users.user_id = auth.uid()))
  with check (exists (select 1 from public.admin_users where admin_users.user_id = auth.uid()));
