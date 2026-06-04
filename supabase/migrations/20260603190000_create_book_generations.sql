-- Create book_generations: the durable task row for the AI "generation" flows that until now
-- held their in-flight state only in React and evaporated on a refresh:
--
--   page_write / page_revise  — PageWorkshop: render or revise ONE page's prose (a proposal)
--   write_all                 — WriteAllPages: render prose for every empty objective-bearing page
--   scaffold                  — ScaffoldGenerator: propose the book's chapter/page outline
--   bible                     — BookBibleSection: draft / extract the book bible
--
-- Generalizes the existing task tables (book_evaluations 20260527000000, book_revisions
-- 20260529000000, book_thread_scans 20260602120000). Same contract: the row is the single source
-- of truth, written server-side, watched over Realtime — so closing the tab never loses work and
-- reopening resumes the loader / proposal / progress from the row.
--
-- Lifecycle (which terminals apply depends on kind):
--   pending → running → ready                 proposals (page_write/revise, scaffold, bible):
--                              ↘ applied        the author reviewed and applied it
--                              ↘ dismissed      the author discarded it
--   pending → running → done                  cascades (write_all): pages written in place, no review
--   …       → error                           any failure
--
-- Reuses user_can_edit_book(_book_id) from 20260527000000 for RLS, like book_revisions. Author-only,
-- full client CRUD: some flows are kicked from the client (dev bridge / single page); the edge
-- function and bridge write the terminal state under the service role.

CREATE TABLE IF NOT EXISTS public.book_generations (
  id              bigint generated always as identity primary key,
  book_id         integer not null references public.books(id) on delete cascade,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  kind            text not null,                      -- page_write|page_revise|write_all|scaffold|bible
  scope           text not null default 'book',       -- book | page
  target_page_id  bigint,                             -- set for page-scoped kinds

  status          text not null default 'pending',    -- pending|running|ready|applied|dismissed|done|error
  input           jsonb,                              -- request params (objective, issues, mode, …)
  result          jsonb,                              -- proposal/output (text | {structure,pages} | {text})
  progress        jsonb,                              -- cascade build state: { done, total, phase }
  error           text,
  notify_email    boolean not null default false,

  CONSTRAINT book_generations_kind_chk
    CHECK (kind IN ('page_write', 'page_revise', 'write_all', 'scaffold', 'bible')),
  CONSTRAINT book_generations_status_chk
    CHECK (status IN ('pending', 'running', 'ready', 'applied', 'dismissed', 'done', 'error'))
);

-- "latest generation for this book" (and, for the workshop, "latest for this page") — the lookup
-- the UI does on every load to resume a running task or a pending proposal.
CREATE INDEX IF NOT EXISTS book_generations_book_id_created_idx
  ON public.book_generations (book_id, created_at DESC);
CREATE INDEX IF NOT EXISTS book_generations_page_created_idx
  ON public.book_generations (target_page_id, created_at DESC)
  WHERE target_page_id IS NOT NULL;

-- Touch updated_at on every write — the watchdog (a later migration) uses it to spot a stalled
-- self-chain, and the UI uses it to tell a live task from a stale one.
CREATE OR REPLACE FUNCTION public.touch_book_generations_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS book_generations_touch_updated_at ON public.book_generations;
CREATE TRIGGER book_generations_touch_updated_at
  BEFORE UPDATE ON public.book_generations
  FOR EACH ROW EXECUTE FUNCTION public.touch_book_generations_updated_at();

-- ── RLS ───────────────────────────────────────────────────────────────────
-- Author-only, same surface as editing the book (mirrors book_revisions).
ALTER TABLE public.book_generations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "editors read generations" ON public.book_generations;
CREATE POLICY "editors read generations"
  ON public.book_generations FOR SELECT TO authenticated
  USING (public.user_can_edit_book(book_id));

DROP POLICY IF EXISTS "editors insert generations" ON public.book_generations;
CREATE POLICY "editors insert generations"
  ON public.book_generations FOR INSERT TO authenticated
  WITH CHECK (public.user_can_edit_book(book_id));

DROP POLICY IF EXISTS "editors update generations" ON public.book_generations;
CREATE POLICY "editors update generations"
  ON public.book_generations FOR UPDATE TO authenticated
  USING (public.user_can_edit_book(book_id));

DROP POLICY IF EXISTS "editors delete generations" ON public.book_generations;
CREATE POLICY "editors delete generations"
  ON public.book_generations FOR DELETE TO authenticated
  USING (public.user_can_edit_book(book_id));

-- ── Realtime ──────────────────────────────────────────────────────────────
-- So a reopened tab learns pending → running → ready/done/error without polling.
-- Guarded: ADD TABLE errors if the table is already in the publication.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'book_generations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.book_generations;
  END IF;
END $$;

-- ── book_thread_scans: allow insert-pending-first ───────────────────────────
-- scan-threads used to INSERT its row only at the END of a long synchronous Claude loop, so a
-- worker that died mid-scan persisted nothing and the client's spinner was lost on refresh. We move
-- it to the evaluate-book pattern (insert 'pending' first → run in the background → flip terminal),
-- which needs two more statuses in the CHECK. 'pending_review' stays the success terminal.
ALTER TABLE public.book_thread_scans DROP CONSTRAINT IF EXISTS book_thread_scans_status_chk;
ALTER TABLE public.book_thread_scans ADD CONSTRAINT book_thread_scans_status_chk
  CHECK (status IN ('pending', 'running', 'pending_review', 'applied', 'dismissed', 'error'));
