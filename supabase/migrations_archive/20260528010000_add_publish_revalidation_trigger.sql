-- On-demand revalidation of the public (Next.js) site when a book's public
-- state changes. Without this, a newly published / unpublished / re-published
-- book only shows up after the marketing site's hourly cache window
-- (unstable_cache revalidate: 3600). This fires an async HTTP POST to the
-- marketing app's /api/revalidate endpoint, which purges the relevant cache
-- tags so the change is visible within seconds.
--
-- The trigger lives on `books` (not `book_versions`) on purpose:
--   * publish_version() updates `books` exactly once per publish, so we get a
--     single fire (the multi-row UPDATE on book_versions would fire repeatedly).
--   * it also catches plain is_public / is_archived toggles, which never touch
--     book_versions but do change whether the book is publicly visible.
--
-- SETUP (run once, out of band — do NOT commit the real secret):
--   select vault.create_secret(
--     '<generate-a-long-random-string>',
--     'revalidate_secret',
--     'Shared secret for the marketing /api/revalidate endpoint'
--   );
-- Then set the SAME value as REVALIDATE_SECRET in the marketing Vercel project.
-- Until both are set, the endpoint fails closed (401/503) and publishing is
-- unaffected — the cache simply falls back to its hourly revalidate window.

create extension if not exists pg_net;

create or replace function public.notify_revalidate_book()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
  -- Marketing (public) site origin. Matches PROD_APP_ORIGIN's sibling in
  -- apps/marketing/lib/pensive.ts (the app lives at app.pensive.me).
  v_url text := 'https://pensive.me/api/revalidate';
begin
  select decrypted_secret
    into v_secret
  from vault.decrypted_secrets
  where name = 'revalidate_secret'
  limit 1;

  -- Fire-and-forget. pg_net queues the request and returns immediately, so the
  -- publish transaction is never blocked or rolled back by revalidation.
  perform net.http_post(
    url := v_url,
    body := jsonb_build_object('bookId', new.id),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-revalidate-secret', coalesce(v_secret, '')
    )
  );

  return new;
exception
  when others then
    -- Never let a revalidation problem break publishing / visibility changes.
    raise warning 'notify_revalidate_book failed: %', sqlerrm;
    return new;
end;
$$;

comment on function public.notify_revalidate_book() is
  'Pings the marketing /api/revalidate endpoint (via pg_net) when a public book changes, so the Next.js cache refreshes immediately.';

drop trigger if exists trg_notify_revalidate_book on public.books;

create trigger trg_notify_revalidate_book
after update on public.books
for each row
when (
  -- Only books that are or were public can affect the public site.
  (new.is_public is true or old.is_public is true)
  and (
    new.published_version_id is distinct from old.published_version_id
    or new.is_public is distinct from old.is_public
    or new.is_archived is distinct from old.is_archived
    or new.name is distinct from old.name
    or new.subtitle is distinct from old.subtitle
    or new.author is distinct from old.author
    or new.cover_url is distinct from old.cover_url
    or new.show_text_on_cover is distinct from old.show_text_on_cover
    or new.content_tags is distinct from old.content_tags
  )
)
execute function public.notify_revalidate_book();
