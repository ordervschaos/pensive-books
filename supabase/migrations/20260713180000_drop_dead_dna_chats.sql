-- dna_chats backed the per-stage DNA reviser (dna-chat edge fn + lib/dnaChat.ts's sendDnaMessage/
-- applyDnaProposal/clearDnaProposal/startNewDnaSession/resumeDnaSession), superseded by the single
-- AgentRail/book-agent thread. Confirmed zero live callers client-side and the dna-chat edge fn was
-- already deleted + undeployed. Had 15 historical rows at drop time (checked before running this).
drop trigger if exists "dna_chats_touch_updated_at" on "public"."dna_chats";
drop table if exists "public"."dna_chats";
drop function if exists "public"."touch_dna_chats_updated_at"();
