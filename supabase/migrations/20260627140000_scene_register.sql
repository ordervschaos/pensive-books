-- Scene `register` — the per-scene voice knob that breaks prose monotony.
-- The book keeps ONE voice_profile (its signature); `register` is how that signature BENDS for a single scene
-- (pace, distance, intensity, sentence length). Without it every scene is handed the identical voice contract,
-- so the whole book reads in one flat register. Here we (1) add the field to the scenes generation template and
-- (2) instruct the expander to give adjacent scenes DISTINCT registers. dna-expand/eval-bridge inject the
-- chosen register into the scene's prose prompt on top of the voice profile.
update public.node_type_configs
set
  schema_json = '{ "loc": "...", "goal": "...", "conflict": "...", "outcome": "...", "register": "...", "value_shift": { "value": "...", "from": "...", "to": "...", "polarity": "up|down" } }',
  role = role || ' Give EACH scene a distinct `register` — a short phrase for how the book''s ONE voice bends here (pace, distance, intensity, sentence length; e.g. ''clipped, breathless'' / ''slow, elegiac, interior''). Adjacent scenes must NOT share a register, so the read never goes monotone.'
where target = 'scenes';
