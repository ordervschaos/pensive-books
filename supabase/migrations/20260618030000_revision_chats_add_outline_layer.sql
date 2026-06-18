-- Extend revision_chats.layer check constraint to include 'outline'.
-- The original constraint only allowed foundations/spine/beats; outline chat was added later.

ALTER TABLE public.revision_chats
  DROP CONSTRAINT revision_chats_layer_check;

ALTER TABLE public.revision_chats
  ADD CONSTRAINT revision_chats_layer_check
  CHECK (layer IN ('foundations', 'spine', 'beats', 'outline'));
