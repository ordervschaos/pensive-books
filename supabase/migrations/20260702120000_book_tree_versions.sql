-- book_tree_versions: append-only history of the DNA tree (book_nodes), so an author can see what
-- changed since they last looked and roll back — especially during auto-accept runs, where the agent
-- commits its own picks with no per-op review. One row = one frozen snapshot of the whole tree.
--
-- label IS NULL = an automatic checkpoint (e.g. right before an auto-accept run starts); label set =
-- the author explicitly named it ("Save this version"). Named versions are kept forever; auto
-- checkpoints are pruned to the most recent N per book inside snapshot_book_tree, so this never grows
-- unbounded on its own.
--
-- Restore is forward-moving (git-revert style, not a history rewrite): the client re-applies an old
-- version's nodes and calls snapshot_book_tree again to record the restore as a new version.

CREATE TABLE IF NOT EXISTS public.book_tree_versions (
  id         bigint generated always as identity primary key,
  book_id    integer not null references public.books(id) on delete cascade,
  label      text,
  nodes      jsonb not null,
  created_at timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS book_tree_versions_book_idx
  ON public.book_tree_versions (book_id, created_at desc);

ALTER TABLE public.book_tree_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "editors read tree versions" ON public.book_tree_versions;
CREATE POLICY "editors read tree versions"
  ON public.book_tree_versions FOR SELECT TO authenticated
  USING (public.user_can_edit_book(book_id));

DROP POLICY IF EXISTS "editors insert tree versions" ON public.book_tree_versions;
CREATE POLICY "editors insert tree versions"
  ON public.book_tree_versions FOR INSERT TO authenticated
  WITH CHECK (public.user_can_edit_book(book_id));

DROP POLICY IF EXISTS "editors delete tree versions" ON public.book_tree_versions;
CREATE POLICY "editors delete tree versions"
  ON public.book_tree_versions FOR DELETE TO authenticated
  USING (public.user_can_edit_book(book_id));

-- snapshot_book_tree: the one chokepoint that freezes book_nodes into a version row. Runs as the
-- caller (no SECURITY DEFINER) so it's bound by the same RLS as any other book_nodes/book_tree_versions
-- write — a caller who can't edit the book can't snapshot it either.
CREATE OR REPLACE FUNCTION public.snapshot_book_tree(p_book_id integer, p_label text DEFAULT NULL, p_keep_auto integer DEFAULT 30)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  v_id bigint;
  v_nodes jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(to_jsonb(n) - 'created_at' - 'updated_at' ORDER BY n.position), '[]'::jsonb)
    INTO v_nodes
  FROM public.book_nodes n
  WHERE n.book_id = p_book_id;

  INSERT INTO public.book_tree_versions (book_id, label, nodes)
  VALUES (p_book_id, p_label, v_nodes)
  RETURNING id INTO v_id;

  DELETE FROM public.book_tree_versions
  WHERE book_id = p_book_id
    AND label IS NULL
    AND id NOT IN (
      SELECT id FROM public.book_tree_versions
      WHERE book_id = p_book_id AND label IS NULL
      ORDER BY created_at DESC
      LIMIT p_keep_auto
    );

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.snapshot_book_tree(integer, text, integer) TO authenticated;
