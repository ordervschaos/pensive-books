-- Scope back the previous migration: admins should NOT get access to
-- page_audio_blocks or flashcards. Keep only admin read on book_chats.
-- (20260603004000 added all three; these two are dropped here.)
DROP POLICY IF EXISTS "admins_can_access_any_page_audio" ON public.page_audio_blocks;
DROP POLICY IF EXISTS "admins_can_read_any_flashcards" ON public.flashcards;
