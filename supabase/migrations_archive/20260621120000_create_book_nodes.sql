-- book_nodes: the Novel DNA tree — the single source of truth for a book.
-- See docs/novel-dna-schema.md (the data contract) + docs/novel-dna-spec.md (build/ops/render).
--
-- One row per node. The tree is the whole book: the narrative ladder (seed→premise→pillar→movement→
-- beat→scene, scene owning its prose under content.prose) plus the cast/world ENTITY branch off the
-- pillar (character/relationship/tentpole/world_fact), referenced by scenes by node id. Chapters and
-- pages are PROJECTIONS, never stored here. ~100 rows + prose per book.
--
-- authoring jsonb = { source, locked, status, src_hash, prose_src_hash } — the fill/dirty state that
-- lets the AI do the heavy lifting without overwriting the author's pinned intent. Staleness is derived
-- from src_hash (hash of the node's input set), never stored as a flag.

CREATE TABLE IF NOT EXISTS public.book_nodes (
  id         text primary key,                                  -- 'n_…' stable id (client-minted)
  book_id    integer not null references public.books(id) on delete cascade,
  parent_id  text references public.book_nodes(id) on delete cascade,
  level      smallint not null,                                 -- 0..5 ladder depth (entities on the pillar branch)
  kind       text not null,
  position   integer not null default 0,                        -- order among siblings
  content    jsonb not null default '{}'::jsonb,                -- kind-specific (scene prose under content.prose; entity refs by id)
  authoring  jsonb not null default '{}'::jsonb,                -- { source, locked, status, src_hash, prose_src_hash }
  proposals  jsonb,                                             -- [{ id, content }]
  chosen     text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  CONSTRAINT book_nodes_kind_chk CHECK (kind IN (
    'seed','premise','pillar','movement','beat','scene',        -- ladder
    'character','relationship','tentpole','world_fact'))        -- entities (schema §4)
);

CREATE INDEX IF NOT EXISTS book_nodes_book_idx   ON public.book_nodes (book_id);
CREATE INDEX IF NOT EXISTS book_nodes_parent_idx ON public.book_nodes (book_id, parent_id, position);

-- Touch updated_at on every write.
CREATE OR REPLACE FUNCTION public.touch_book_nodes_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS book_nodes_touch_updated_at ON public.book_nodes;
CREATE TRIGGER book_nodes_touch_updated_at
  BEFORE UPDATE ON public.book_nodes
  FOR EACH ROW EXECUTE FUNCTION public.touch_book_nodes_updated_at();

-- ── RLS ───────────────────────────────────────────────────────────────────────
-- Author-only, same surface as editing the book (client-driven: the studio mutates the tree directly).
-- Reuses user_can_edit_book(_book_id). Readers never see the DNA — they read the rendered pages only.
ALTER TABLE public.book_nodes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "editors read nodes" ON public.book_nodes;
CREATE POLICY "editors read nodes"
  ON public.book_nodes FOR SELECT TO authenticated
  USING (public.user_can_edit_book(book_id));

DROP POLICY IF EXISTS "editors insert nodes" ON public.book_nodes;
CREATE POLICY "editors insert nodes"
  ON public.book_nodes FOR INSERT TO authenticated
  WITH CHECK (public.user_can_edit_book(book_id));

DROP POLICY IF EXISTS "editors update nodes" ON public.book_nodes;
CREATE POLICY "editors update nodes"
  ON public.book_nodes FOR UPDATE TO authenticated
  USING (public.user_can_edit_book(book_id));

DROP POLICY IF EXISTS "editors delete nodes" ON public.book_nodes;
CREATE POLICY "editors delete nodes"
  ON public.book_nodes FOR DELETE TO authenticated
  USING (public.user_can_edit_book(book_id));

-- ── Realtime ──────────────────────────────────────────────────────────────────
-- The studio is a live projection of the tree (refresh = no-op): subscribe to row changes.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'book_nodes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.book_nodes;
  END IF;
END $$;
