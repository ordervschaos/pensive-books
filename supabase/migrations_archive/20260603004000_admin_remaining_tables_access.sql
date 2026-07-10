-- Extend admin access to the three remaining owner/per-user feature tables.
--
-- page_audio_blocks is book *content* (page narration) — owner/editor already have
-- it, so routing through the now-admin-aware user_can_edit_book() only adds admins,
-- giving them full owner-equivalent CRUD. book_id is resolved via the pages join
-- (the table keys on page_id).
DROP POLICY IF EXISTS "admins_can_access_any_page_audio" ON public.page_audio_blocks;
CREATE POLICY "admins_can_access_any_page_audio"
  ON public.page_audio_blocks
  FOR ALL
  TO authenticated
  USING (
    public.user_can_edit_book(
      (SELECT p.book_id FROM public.pages p WHERE p.id = page_audio_blocks.page_id)
    )
  )
  WITH CHECK (
    public.user_can_edit_book(
      (SELECT p.book_id FROM public.pages p WHERE p.id = page_audio_blocks.page_id)
    )
  );

-- flashcards and book_chats are PER-USER private data (user_id = auth.uid()): there's
-- no owner view to replicate, so user_can_edit_book is the wrong predicate (it would
-- also expose this data to book owners/editors). Grant admins read-only cross-user
-- access for moderation/inspection; owners/editors stay limited to their own rows.
DROP POLICY IF EXISTS "admins_can_read_any_flashcards" ON public.flashcards;
CREATE POLICY "admins_can_read_any_flashcards"
  ON public.flashcards
  FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "admins_can_read_any_book_chat" ON public.book_chats;
CREATE POLICY "admins_can_read_any_book_chat"
  ON public.book_chats
  FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid()));
