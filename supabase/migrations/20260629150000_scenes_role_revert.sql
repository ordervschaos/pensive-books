-- Revert multiline role text that broke the system prompt template
-- (the template embeds role mid-sentence; multiline → LLM outputs non-JSON → JSON.parse 500).
-- Detailed scene rules moved into slottedCtx via the priorScenes slot in dna-expand.
update public.node_type_configs
set role = 'the dramatized SCENES that REALIZE this beat. Every scene must turn a value (no flat ''and-then''). Set value_shift.polarity: up = ends better, down = ends worse. The beat''s closing polarity is where the LAST scene must land — vary internally. Thread schedule is inherited — do NOT re-assign threads.'
where target = 'scenes';
