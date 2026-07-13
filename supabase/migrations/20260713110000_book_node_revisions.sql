-- book_node_revisions: a per-node, append-only audit log of book_nodes content changes, so an author can
-- see a single node's timeline, tell exactly what an AI op changed, and revert one node to an earlier state.
-- This is the fine-grained twin of book_tree_versions (whole-tree snapshots at checkpoints): that table
-- samples the whole tree occasionally; this one captures every content-changing write to every node.
--
-- Design (see the design discussion in chat / docs):
--  * Capture at the persistence chokepoint — a trigger on book_nodes — so it is source-agnostic (agent,
--    manual field edit, eval-bridge, edge fn all land here; the client never writes this table).
--  * State-based, not delta-based: each row stores the FULL content snapshot at that write. Tiny (a beat
--    is a few fields; only scene prose is KB-scale), and it makes diff (compare adjacent rows), history
--    (list rows), and revert (write an old row's content back) all trivial.
--  * Precise AI attribution: ai_call_id is set ONLY when this write is the one that (re)stamped
--    last_ai_call_id. last_ai_call_id is sticky — a manual edit after an AI edit leaves the old id in
--    place — so "did it change on THIS write" is the exact test for "was this change from that AI call".
--  * Append-only + system-written: SECURITY DEFINER trigger writes it; authenticated may only SELECT
--    (gated by book access). Revert never rewrites history — it writes book_nodes, which appends a new
--    revision (forward-moving, like book_tree_versions restore).

CREATE TABLE IF NOT EXISTS public.book_node_revisions (
  id         bigint generated always as identity primary key,
  node_id    text not null,                 -- book_nodes.id; NOT an FK — history outlives the node (deletes)
  book_id    integer not null references public.books(id) on delete cascade,
  content    jsonb not null,                -- the node's content AT this write (OLD.content for a delete)
  authoring  jsonb not null default '{}'::jsonb,
  chosen     text,
  ai_call_id bigint references public.ai_calls(id) on delete set null,  -- set iff this write stamped it
  op         text not null check (op in ('insert', 'update', 'delete')),
  created_at timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS book_node_revisions_node_idx ON public.book_node_revisions (node_id, created_at desc);
CREATE INDEX IF NOT EXISTS book_node_revisions_book_idx ON public.book_node_revisions (book_id, created_at desc);

ALTER TABLE public.book_node_revisions ENABLE ROW LEVEL SECURITY;

-- Read-only for authenticated editors of the book. No INSERT/UPDATE/DELETE policy: the audit log is
-- written exclusively by the SECURITY DEFINER trigger below and is not user-mutable (append-only).
DROP POLICY IF EXISTS "editors read node revisions" ON public.book_node_revisions;
CREATE POLICY "editors read node revisions"
  ON public.book_node_revisions FOR SELECT TO authenticated
  USING (public.user_can_edit_book(book_id));

-- The capture trigger. SECURITY DEFINER so it can append to the audit table regardless of the caller's
-- direct grants on it (users can edit book_nodes but cannot forge/alter audit rows). Prunes to the most
-- recent N content revisions per node so it never grows unbounded on its own.
CREATE OR REPLACE FUNCTION public.log_book_node_revision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_keep constant integer := 50;
  v_call bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO public.book_node_revisions (node_id, book_id, content, authoring, chosen, ai_call_id, op)
    VALUES (OLD.id, OLD.book_id, OLD.content, OLD.authoring, OLD.chosen, NULL, 'delete');
    -- (deletes aren't pruned against a live-node horizon; they age out with the book)
    RETURN OLD;
  END IF;

  -- Skip content-preserving updates (Realtime-echo re-saves, status/lock flips, position moves): the log
  -- is about CONTENT history.
  IF TG_OP = 'UPDATE' AND NEW.content IS NOT DISTINCT FROM OLD.content THEN
    RETURN NEW;
  END IF;

  v_call := CASE
    WHEN TG_OP = 'INSERT' THEN NEW.last_ai_call_id
    WHEN NEW.last_ai_call_id IS DISTINCT FROM OLD.last_ai_call_id THEN NEW.last_ai_call_id
    ELSE NULL
  END;

  INSERT INTO public.book_node_revisions (node_id, book_id, content, authoring, chosen, ai_call_id, op)
  VALUES (NEW.id, NEW.book_id, NEW.content, NEW.authoring, NEW.chosen, v_call, lower(TG_OP));

  DELETE FROM public.book_node_revisions
  WHERE node_id = NEW.id
    AND id NOT IN (
      SELECT id FROM public.book_node_revisions
      WHERE node_id = NEW.id
      ORDER BY created_at DESC, id DESC
      LIMIT v_keep
    );

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.log_book_node_revision() OWNER TO postgres;

DROP TRIGGER IF EXISTS log_book_node_revision ON public.book_nodes;
CREATE TRIGGER log_book_node_revision
  AFTER INSERT OR UPDATE OR DELETE ON public.book_nodes
  FOR EACH ROW EXECUTE FUNCTION public.log_book_node_revision();
