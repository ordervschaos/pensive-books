-- Add book_thread_anchors: multi-page promise and resolution tracking.
--
-- A thread's promise can be seeded and reinforced across many pages; its resolution can unfold
-- across many pages too. The old single setup_page_id / payoff_page_id columns can only express
-- one point per end, so we replace them with a 1:many anchors table.
--
-- Each anchor row is one notable moment:
--   role='promise'    — a page that plants or deepens the narrative setup
--   role='resolution' — a page that pays off (partially or fully) the thread
--
-- sequence orders anchors within a thread+role (0 = first, 1 = second, …).
-- Threads can have multiple resolution anchors — a promise can be "closed" more than once.
--
-- Existing setup/payoff data is migrated: setup → promise[0], payoff → resolution[0].
-- The old columns are then dropped.

CREATE TABLE IF NOT EXISTS public.book_thread_anchors (
  id          bigint generated always as identity primary key,
  thread_id   bigint  not null references public.book_threads(id) on delete cascade,
  page_id     integer references public.pages(id) on delete set null,
  role        text    not null,  -- 'promise' | 'resolution'
  sequence    smallint not null default 0,
  note        text,              -- why this page matters (AI-generated or author note)
  word_offset integer,           -- server-resolved from page id at scan time
  created_at  timestamptz not null default now(),

  CONSTRAINT book_thread_anchors_role_chk CHECK (role IN ('promise', 'resolution'))
);

-- Lookup: all anchors for a thread, in narrative order.
CREATE INDEX IF NOT EXISTS book_thread_anchors_thread_role_seq_idx
  ON public.book_thread_anchors (thread_id, role, sequence);

-- Lookup: which threads have an anchor on this page.
CREATE INDEX IF NOT EXISTS book_thread_anchors_page_id_idx
  ON public.book_thread_anchors (page_id)
  WHERE page_id IS NOT NULL;

-- ── Migrate existing single-point anchors ─────────────────────────────────────
INSERT INTO public.book_thread_anchors (thread_id, page_id, role, sequence, word_offset)
SELECT id, setup_page_id, 'promise', 0, setup_word_offset
FROM   public.book_threads
WHERE  setup_page_id IS NOT NULL;

INSERT INTO public.book_thread_anchors (thread_id, page_id, role, sequence, word_offset)
SELECT id, payoff_page_id, 'resolution', 0, payoff_word_offset
FROM   public.book_threads
WHERE  payoff_page_id IS NOT NULL;

-- ── Drop old flat anchor columns ──────────────────────────────────────────────
ALTER TABLE public.book_threads
  DROP COLUMN IF EXISTS setup_page_id,
  DROP COLUMN IF EXISTS setup_word_offset,
  DROP COLUMN IF EXISTS payoff_page_id,
  DROP COLUMN IF EXISTS payoff_word_offset;

-- ── RLS ───────────────────────────────────────────────────────────────────────
-- Access mirrors book_threads: author must be able to edit the parent book.
ALTER TABLE public.book_thread_anchors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "editors read thread anchors" ON public.book_thread_anchors;
CREATE POLICY "editors read thread anchors"
  ON public.book_thread_anchors FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.book_threads bt
      WHERE bt.id = thread_id AND public.user_can_edit_book(bt.book_id)
    )
  );

DROP POLICY IF EXISTS "editors insert thread anchors" ON public.book_thread_anchors;
CREATE POLICY "editors insert thread anchors"
  ON public.book_thread_anchors FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.book_threads bt
      WHERE bt.id = thread_id AND public.user_can_edit_book(bt.book_id)
    )
  );

DROP POLICY IF EXISTS "editors update thread anchors" ON public.book_thread_anchors;
CREATE POLICY "editors update thread anchors"
  ON public.book_thread_anchors FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.book_threads bt
      WHERE bt.id = thread_id AND public.user_can_edit_book(bt.book_id)
    )
  );

DROP POLICY IF EXISTS "editors delete thread anchors" ON public.book_thread_anchors;
CREATE POLICY "editors delete thread anchors"
  ON public.book_thread_anchors FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.book_threads bt
      WHERE bt.id = thread_id AND public.user_can_edit_book(bt.book_id)
    )
  );
