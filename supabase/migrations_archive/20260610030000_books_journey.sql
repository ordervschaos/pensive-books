-- books.journey — the guided-build approval ledger.
--
-- The post-creation flow is a blocked "game-like" ladder: brief → spine → outline → voice → beats →
-- draft prose. Each step must be VERIFIED (the author clicks "Approve & continue") before the next
-- unlocks. "The artifact exists" isn't the same as "the author signed off", so the approvals are real
-- persisted state — a cleared level stays cleared across refreshes. Shape: { brief, spine, outline,
-- voice, beats, draft } each an ISO timestamp set on approval (absent = not yet cleared).
--
-- RLS already governs books; this is just another column, editable by whoever can edit the book.
ALTER TABLE public.books ADD COLUMN IF NOT EXISTS journey jsonb NOT NULL DEFAULT '{}'::jsonb;
