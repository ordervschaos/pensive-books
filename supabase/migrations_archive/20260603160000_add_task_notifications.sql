-- "Notify me when it's done" for long AI tasks.
--
-- Each long task already lands in a row whose status marches to a terminal value:
--   book_evaluations   pending → done|error          (server, EdgeRuntime.waitUntil)
--   book_revisions     planning → … → done|error     (client-driven build cascade)
--   book_thread_scans  inserted directly as pending_review (its terminal "done")
--
-- So the cheapest, most uniform place to email the author is the DB layer — the
-- moment the terminal write happens, no matter who wrote it (a background edge
-- function that may have already timed out the HTTP response, or the client).
-- This mirrors notify_revalidate_book (20260528010000): a fire-and-forget
-- pg_net POST that never blocks or rolls back the task.
--
-- Opt-in is a per-task `notify_email` flag the "Notify me" toggle sets. The
-- POST hits the notify-task-done edge function, which composes + sends the mail
-- (Mailgun) and deep-links back to the book. The browser notification is a
-- separate, purely client-side channel (it fires when the watching tab observes
-- completion) — this migration only powers the email half.
--
-- SETUP (run once, out of band — do NOT commit the real secret):
--   select vault.create_secret(
--     '<generate-a-long-random-string>',
--     'notify_task_secret',
--     'Shared secret for the notify-task-done edge function'
--   );
-- Then set the SAME value as NOTIFY_SECRET in the edge function's env. Until both
-- are set, notify-task-done fails closed (401) and tasks are unaffected — the
-- author simply doesn't get the email (the browser notification still fires).

create extension if not exists pg_net;

-- ── Opt-in flag on each task table ──────────────────────────────────────────
alter table public.book_evaluations  add column if not exists notify_email boolean not null default false;
alter table public.book_revisions    add column if not exists notify_email boolean not null default false;
alter table public.book_thread_scans add column if not exists notify_email boolean not null default false;

-- ── One trigger function, shared across the three tables ────────────────────
-- TG_TABLE_NAME tells the edge function which kind of task finished; it reads
-- the row itself (status, error, book) under the service role.
create or replace function public.notify_task_done()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
  v_url text := 'https://qiqeyirtpstdjkkeyfss.supabase.co/functions/v1/notify-task-done';
begin
  select decrypted_secret
    into v_secret
  from vault.decrypted_secrets
  where name = 'notify_task_secret'
  limit 1;

  perform net.http_post(
    url := v_url,
    body := jsonb_build_object('table', tg_table_name, 'id', new.id),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-notify-secret', coalesce(v_secret, '')
    )
  );

  return new;
exception
  when others then
    -- A notification problem must never break the task that just finished.
    raise warning 'notify_task_done failed: %', sqlerrm;
    return new;
end;
$$;

comment on function public.notify_task_done() is
  'Pings notify-task-done (via pg_net) when an opted-in AI task reaches a terminal state, so the author gets an email.';

-- ── Triggers ────────────────────────────────────────────────────────────────
-- Eval + revise: fire once, on the transition INTO a terminal state.
drop trigger if exists trg_notify_evaluation_done on public.book_evaluations;
create trigger trg_notify_evaluation_done
after update on public.book_evaluations
for each row
when (
  new.notify_email
  and new.status in ('done', 'error')
  and old.status is distinct from new.status
  and old.status not in ('done', 'error')
)
execute function public.notify_task_done();

drop trigger if exists trg_notify_revision_done on public.book_revisions;
create trigger trg_notify_revision_done
after update on public.book_revisions
for each row
when (
  new.notify_email
  and new.status in ('done', 'error')
  and old.status is distinct from new.status
  and old.status not in ('done', 'error')
)
execute function public.notify_task_done();

-- Scan: the row is INSERTed already-complete (pending_review), so the terminal
-- event is the insert itself.
drop trigger if exists trg_notify_scan_done on public.book_thread_scans;
create trigger trg_notify_scan_done
after insert on public.book_thread_scans
for each row
when (new.notify_email)
execute function public.notify_task_done();
