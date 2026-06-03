-- pg_net's http_post defaults to a 5s timeout, which a cold-started edge
-- function + Mailgun round-trip can blow past — the simulated trigger came back
-- "Timeout was reached" and the email never reliably sent. notify-task-done now
-- returns immediately (EdgeRuntime.waitUntil does the slow work), but we also
-- give pg_net a generous timeout so a cold start can't trip it. CREATE OR REPLACE
-- only changes the function body; the three triggers keep pointing at it.

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
    ),
    timeout_milliseconds := 15000
  );

  return new;
exception
  when others then
    raise warning 'notify_task_done failed: %', sqlerrm;
    return new;
end;
$$;
