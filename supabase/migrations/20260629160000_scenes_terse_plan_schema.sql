-- Scenes were truncating at max_tokens: the model treated the bare "..." schema placeholders as an
-- invitation to write FULL PROSE into `conflict`/`outcome` (whole paragraphs of scene text), blowing
-- past the token budget mid-JSON → JSON.parse 500. Constrain every field to a terse PLANNING phrase so
-- a 1–3 scene plan stays small and well-formed. Scenes are a PLAN, not prose (prose is a separate pass).
update public.node_type_configs
set
  role = 'the dramatized SCENES that REALIZE this beat — as a terse PLAN, not prose. Each field is ONE short phrase or sentence; NEVER write full prose, paragraphs, or dialogue here (prose is a later pass). Every scene must turn a value (no flat ''and-then''). Set value_shift.polarity: up = ends better, down = ends worse. The beat''s closing polarity is where the LAST scene must land — vary internally. Thread schedule is inherited — do NOT re-assign threads.',
  schema_json = '{ "loc": "<location name — a few words>", "goal": "<one sentence: what the POV character is trying to get>", "conflict": "<one sentence: the specific obstacle in the way>", "outcome": "<one sentence: how it ends and what changed — NOT prose>", "register": "<a few words: the scene''s tonal color>", "value_shift": { "value": "<the value at stake, e.g. trust>", "from": "<starting state>", "to": "<ending state>", "polarity": "up|down" } }'
where target = 'scenes';
