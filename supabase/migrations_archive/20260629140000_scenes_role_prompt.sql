-- Sharpen scenes role text: explicit causal continuity from entry state + value-turn requirement.
update public.node_type_configs
set role = 'the dramatized SCENES that REALIZE this beat. Rules:
(1) CONTINUE CAUSALLY from the entry state — your first scene opens where the last planned scene left off (same world state, characters mid-consequence). Do not reset.
(2) EVERY scene turns a value (no flat ''and-then''). Set value_shift.polarity: up = ends better, down = ends worse.
(3) VARY polarity internally — the beat''s closing polarity is where the LAST scene must land, not every scene. A down-beat can open on false hope; an up-beat can dip before the turn.
(4) VARY location — if scenes_so_far lists locations already used, choose a different place unless the drama demands it.
(5) Each scene = one attempt: a character wants something, meets a specific obstacle, and either gets it or doesn''t. The outcome changes the world state for the next scene.
(6) Thread schedule is inherited automatically — do NOT re-assign threads.'
where target = 'scenes';
