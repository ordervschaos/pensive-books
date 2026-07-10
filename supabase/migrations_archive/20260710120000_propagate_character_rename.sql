-- Renaming a character's `content.name` field used to be a local edit: the
-- entity registry, tooltips, and agent context picked it up instantly, but
-- every prose mention of the old name across the rest of the book stayed
-- stale (content.prose.text is free text, not a reference to the entity).
--
-- This trigger closes that gap: whenever a book_nodes row's `content->>'name'`
-- changes, it walks every OTHER node in the same book and replaces
-- whole-word occurrences of the old name with the new one, anywhere in that
-- node's `content` (prose, goals, summaries, sketches, ...) AND `authoring`
-- (the cached continuity digest — authoring.prose_digest.line and
-- authoring.prose_digest.ledger.characters[].name both hold copies of a
-- character's name). The digest's `src_hash`/`prev_hash` fields are opaque
-- hex and never match a name pattern, so they're left as-is by construction,
-- not by special-casing — the incremental-digest pipeline still recomputes
-- them normally on the next real prose edit.
--
-- Applies to any node kind with a `name` field (character, world_fact,
-- location, thread) — not just `character` — since they all share the same
-- "one row owns this label, everyone else just mentions it in prose" shape.
-- A target row's OWN `name` field is preserved even if it happens to
-- literally match the pattern, so renaming one entity can never clobber a
-- different entity that happens to share the old name.

create or replace function public.dna_regex_escape(input text)
returns text
language sql
immutable
as $$
  select regexp_replace(input, '([\\.^$|()\[\]{}*+?])', '\\\1', 'g');
$$;

comment on function public.dna_regex_escape(text) is
  'Escapes POSIX regex metacharacters so a literal string can be dropped into a regexp_replace pattern.';

create or replace function public.dna_jsonb_replace_text(data jsonb, find_word text, replace_word text)
returns jsonb
language plpgsql
immutable
as $$
declare
  pattern text := '\m' || public.dna_regex_escape(find_word) || '\M';
  result jsonb;
  entry_key text;
  entry_val jsonb;
  elem jsonb;
begin
  if data is null then
    return null;
  end if;

  case jsonb_typeof(data)
    when 'string' then
      return to_jsonb(regexp_replace(data #>> '{}', pattern, replace_word, 'g'));
    when 'object' then
      result := '{}'::jsonb;
      for entry_key, entry_val in select o.key, o.value from jsonb_each(data) o loop
        result := result || jsonb_build_object(entry_key, public.dna_jsonb_replace_text(entry_val, find_word, replace_word));
      end loop;
      return result;
    when 'array' then
      result := '[]'::jsonb;
      for elem in select * from jsonb_array_elements(data) loop
        result := result || jsonb_build_array(public.dna_jsonb_replace_text(elem, find_word, replace_word));
      end loop;
      return result;
    else
      return data;
  end case;
end;
$$;

comment on function public.dna_jsonb_replace_text(jsonb, text, text) is
  'Recursively replaces whole-word occurrences of find_word with replace_word in every string value of a jsonb tree.';

create or replace function public.propagate_character_rename()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_name text := old.content ->> 'name';
  new_name text := new.content ->> 'name';
  match_pattern text;
begin
  if old_name is null or old_name = '' or new_name is null or new_name = '' then
    return new;
  end if;

  match_pattern := '\m' || public.dna_regex_escape(old_name) || '\M';

  begin
    update public.book_nodes n
    set content = case
          when n.content ? 'name'
            then jsonb_set(
                   public.dna_jsonb_replace_text(n.content, old_name, new_name),
                   '{name}', n.content -> 'name'
                 )
          else public.dna_jsonb_replace_text(n.content, old_name, new_name)
        end,
        authoring = public.dna_jsonb_replace_text(n.authoring, old_name, new_name)
    where n.book_id = new.book_id
      and n.id <> new.id
      and (n.content::text ~ match_pattern or n.authoring::text ~ match_pattern);
  exception
    when others then
      -- Never let the rename fan-out break the author's actual edit.
      raise warning 'propagate_character_rename failed for book_node %: %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

comment on function public.propagate_character_rename() is
  'On book_nodes.content->>name change, propagates the rename into every other prose/free-text mention across the same book.';

drop trigger if exists trg_propagate_character_rename on public.book_nodes;

create trigger trg_propagate_character_rename
  after update on public.book_nodes
  for each row
  when ((old.content ->> 'name') is distinct from (new.content ->> 'name'))
  execute function public.propagate_character_rename();
