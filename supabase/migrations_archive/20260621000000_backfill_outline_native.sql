-- One-time backfill: make existing page-native books OUTLINE-NATIVE (docs/structure-as-render.md).
--
-- The inverse of reconcile(): distill each book's current pages into books.outline. We target books
-- that have done real planning work — foundations NOT empty AND at least one live page — since those
-- have structure worth lifting into the durable plan layer. Books with empty foundations stay legacy
-- (the cold-start chat path makes a fresh book outline-native on its own).
--
-- Deterministic ids (md5 of the page/thread id) so pages.metadata.node_id and books.outline.nodes[].id
-- agree without a random source. compiled_rev = rev (= 1): the pages already match the nodes, so there's
-- no pending render and no spurious "outline ahead of pages" banner. No spine_hash (cyrb53 isn't
-- available in SQL; nothing reads it yet — a later outline save will stamp it).
--
-- Idempotent: guarded on outline IS NULL, the node_id stamp, and coalesce()'d plan_thread_id.

DO $$
DECLARE
  b        RECORD;
  v_nodes  jsonb;
  v_threads jsonb;
BEGIN
  FOR b IN
    SELECT id, foundations
    FROM   public.books
    WHERE  outline IS NULL
      AND  foundations IS NOT NULL AND foundations <> '{}'::jsonb
      AND  EXISTS (SELECT 1 FROM public.pages p WHERE p.book_id = books.id AND coalesce(p.archived, false) = false)
  LOOP
    -- 1. Stamp a stable node_id on every live page (the page↔node anchor reconcile keys on).
    UPDATE public.pages p
    SET    metadata = coalesce(p.metadata, '{}'::jsonb) || jsonb_build_object('node_id', 'n_' || substr(md5(p.id::text), 1, 9))
    WHERE  p.book_id = b.id
      AND  coalesce(p.archived, false) = false
      AND  NOT (coalesce(p.metadata, '{}'::jsonb) ? 'node_id');

    -- 2. Build the ordered node list from the pages (objective copied; tentpole placement reverse-mapped).
    SELECT coalesce(jsonb_agg(node ORDER BY page_index), '[]'::jsonb)
    INTO   v_nodes
    FROM (
      SELECT p.page_index,
        jsonb_strip_nulls(jsonb_build_object(
          'id',         p.metadata->>'node_id',
          'type',       CASE WHEN p.page_type = 'section' THEN 'section' ELSE 'scene' END,
          'title',      coalesce(p.title, ''),
          'objective',  CASE WHEN p.page_type = 'section' THEN NULL ELSE coalesce(p.metadata->>'objective', '') END,
          'delta',      CASE WHEN p.metadata ? 'planned_delta' THEN p.metadata->'planned_delta' ELSE NULL END,
          'tentpoleId', (SELECT t->>'id'
                         FROM jsonb_array_elements(coalesce(b.foundations->'tentpoles', '[]'::jsonb)) t
                         WHERE (t->>'placed_page_id') ~ '^[0-9]+$' AND (t->>'placed_page_id')::int = p.id
                         LIMIT 1)
        )) AS node
      FROM public.pages p
      WHERE p.book_id = b.id AND coalesce(p.archived, false) = false
    ) s;

    -- 3. Lift planned threads: set the durable node anchors + plan id on book_threads, then snapshot
    --    them into outline.threads. The page anchors live in book_thread_anchors (promise/resolution).
    UPDATE public.book_threads bt
    SET    plan_thread_id = coalesce(bt.plan_thread_id, 't_' || substr(md5(bt.id::text), 1, 9)),
           setup_node_id  = (SELECT p.metadata->>'node_id'
                             FROM public.book_thread_anchors a JOIN public.pages p ON p.id = a.page_id
                             WHERE a.thread_id = bt.id AND a.role = 'promise' ORDER BY a.sequence LIMIT 1),
           payoff_node_id = (SELECT p.metadata->>'node_id'
                             FROM public.book_thread_anchors a JOIN public.pages p ON p.id = a.page_id
                             WHERE a.thread_id = bt.id AND a.role = 'resolution' ORDER BY a.sequence LIMIT 1)
    WHERE  bt.book_id = b.id;

    SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'id',            bt.plan_thread_id,
             'name',          bt.name,
             'description',   coalesce(bt.description, ''),
             'setupNodeId',   bt.setup_node_id,
             'payoffNodeId',  bt.payoff_node_id,
             'targetDistance', bt.target_distance
           ))), '[]'::jsonb)
    INTO   v_threads
    FROM   public.book_threads bt
    WHERE  bt.book_id = b.id;

    -- 4. Write the outline. compiled_rev = rev → already rendered; OutlineStep goes outline-native.
    UPDATE public.books
    SET    outline = jsonb_build_object(
             'structure', '', 'nodes', v_nodes, 'threads', v_threads, 'rev', 1, 'compiled_rev', 1)
    WHERE  id = b.id;
  END LOOP;
END $$;
