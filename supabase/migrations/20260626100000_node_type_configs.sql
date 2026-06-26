-- node_type_configs: pluggable generation config per DNA node target.
-- Separates generation rules (role, craft, schema, slots) from tree structure (parent_kind, child_kind, level).
-- The edge fn (dna-expand) and bridge both read from this table instead of their hardcoded SPEC constants.
-- slots jsonb controls which context blocks are injected into the prompt for each target.

create table public.node_type_configs (
  id          serial primary key,
  target      text not null unique,   -- the expand target key: "beats", "cast", "scenes", etc.
  child_kind  text not null,          -- the NodeKind produced: "beat", "character", "scene"
  child_level int  not null,          -- level in the book_nodes tree
  parent_kind text not null,          -- expected parent kind (documentation; not enforced server-side)
  role        text not null,          -- "the BEATS inside this act" — fed into the system prompt
  count       text not null,          -- "2 to 4", "exactly 1", etc.
  schema_json text not null,          -- the JSON output template shown to Claude
  slots       jsonb not null default '{
    "voice": false,
    "entities": false,
    "threads": false,
    "tentpoles": false,
    "worldRules": false,
    "games": false,
    "preconditions": false,
    "arc": false
  }',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.node_type_configs enable row level security;

-- All authenticated users can read (edge fn uses user JWT; bridge uses service role).
create policy "authenticated read" on public.node_type_configs
  for select using (auth.role() = 'authenticated');

-- Seed: one row per expand target. Slots specify which context blocks each target actually uses.
-- Structure columns (child_kind, child_level, parent_kind) are fixed; the rest is editable.

insert into public.node_type_configs (target, child_kind, child_level, parent_kind, role, count, schema_json, slots) values

('premise', 'premise', 1, 'seed',
  'the PREMISE — genre, tone, the dramatic question, and a 5-part shape (setup → three turns → resolution)',
  'exactly 1',
  '{ "genre": ["..."], "tone": ["..."], "dramatic_question": "...", "shape": { "setup": "...", "turn1": "...", "turn2": "...", "turn3": "...", "resolution": "..." } }',
  '{"voice":false,"entities":false,"threads":false,"tentpoles":false,"worldRules":false,"games":false,"preconditions":false,"arc":false}'),

('pillar', 'pillar', 2, 'premise',
  'the PILLAR — the controlling idea the book proves and the ending it must reach',
  'exactly 1',
  '{ "controlling_idea": "...", "ending": "..." }',
  '{"voice":false,"entities":false,"threads":false,"tentpoles":false,"worldRules":false,"games":false,"preconditions":false,"arc":false}'),

('cast', 'character', 2, 'pillar',
  'the CAST — a protagonist plus key opposition/allies; each gets a want, need, wound, lie, truth, idiolect',
  '3 to 5',
  '{ "name": "...", "role": "protagonist|antagonist|ally|love_interest|minor", "want": "...", "need": "...", "wound": "...", "lie": "...", "truth": "...", "idiolect": "..." }',
  '{"voice":false,"entities":false,"threads":false,"tentpoles":false,"worldRules":false,"games":false,"preconditions":false,"arc":false}'),

('world', 'world_fact', 2, 'pillar',
  'the WORLD — the load-bearing rules. Each must be OPERABLE, not atmosphere: give a short name handle, the rule, and its MECHANISM (what it enables/forbids with clear inputs→outputs, so the climax''s win can fire it — no deus ex machina)',
  '3 to 6',
  '{ "name": "<short handle>", "rule": "...", "mechanism": "<the operation: what it enables/forbids, inputs→outputs>", "category": "..." }',
  '{"voice":false,"entities":true,"threads":false,"tentpoles":false,"worldRules":false,"games":false,"preconditions":false,"arc":false}'),

('relationships', 'relationship', 2, 'pillar',
  'the key RELATIONSHIPS (dyads) between the cast — each with a bond and a current charge/tension; reference characters BY NAME',
  '2 to 4',
  '{ "a": "<character name>", "b": "<character name>", "bond": "...", "charge": "..." }',
  '{"voice":false,"entities":true,"threads":false,"tentpoles":false,"worldRules":false,"games":false,"preconditions":false,"arc":false}'),

('set-pieces', 'tentpole', 2, 'pillar',
  'the TENTPOLE SET-PIECES — the must-happen moments the book is obligated to deliver on the page: the scenes readers came for (the genre''s core promise, the emotional peak, the key confrontations). Each is a single concrete moment — not a chapter summary, not a theme — described as what HAPPENS: who does what to whom, the stakes in the room, the specific sensation or image the reader should walk away with. These must be SCENE-specific enough to assign to a single beat, and GENRE-specific enough that omitting one would feel like a broken promise',
  '3 to 6',
  '{ "summary": "<the set-piece — what concretely happens: action, participants, stakes, the image>" }',
  '{"voice":false,"entities":true,"threads":false,"tentpoles":false,"worldRules":false,"games":false,"preconditions":false,"arc":true}'),

('threads', 'thread', 2, 'pillar',
  'the PROMISE REGISTRY — the open loops the book opens and must close (a planted clue, a mystery, a foreshadow, a relationship arc). Read THE ARC (the movements) and place promises that pay off across it — setups early, payoffs later',
  '4 to 7',
  '{ "name": "...", "promise": "...", "payoff": "...", "kind": "mystery|foreshadow|setup_payoff|arc" }',
  '{"voice":false,"entities":true,"threads":false,"tentpoles":false,"worldRules":false,"games":false,"preconditions":false,"arc":true}'),

('games', 'game', 2, 'pillar',
  'the GAMES — each a CONTEST with an explicit possibility space: a WIN condition AND a LOSE condition (you can''t win if you can''t lose). CRITICAL: win_condition and lose_condition are NOT narratives of what winning/losing looks like — that is the stake. They are the specific CRITERIA that must be MET for each outcome to occur: the required states, the who-must-do-what, the thing the story must ESTABLISH before the resolution fires. E.g. ''The venue is public AND witnesses are present AND the freedom paper is presented AND the room names her free'' — not ''She is named free.'' One CENTRAL game is the norm; add a second/third only if it genuinely interlocks. Name the players (the cast in this contest BY NAME) and the governing_rules (the world rules whose mechanism the win/lose fires, BY NAME). If two games interlock, add a `couples` edge: when this game is won/lost, what it does to another game (void/raise/lower/enable) — OPTIONAL, only for real interlock',
  '1 to 3',
  '{ "name": "...", "players": ["<character name>"], "win_condition": "...", "lose_condition": "...", "stake": "...", "governing_rules": ["<world rule name>"], "couples": [ { "to": "<other game name>", "when": "won|lost", "effect": "void|raise|lower|enable", "note": "..." } ], "win_requires": [ { "type": "rule|state", "what": "...", "key": "<short handle, for state preconditions>" } ] }',
  '{"voice":false,"entities":true,"threads":false,"tentpoles":false,"worldRules":true,"games":false,"preconditions":false,"arc":false}'),

('movements', 'movement', 3, 'pillar',
  'the ACTS — four movements whose turning points land near the structural-gravity marks (≈25%, 50%, 75%, 90% of the book). Each carries a goal, a turning point, a target_pct (where its turn should land, 0–1), and a value shift',
  'exactly 4',
  '{ "title": "...", "goal": "...", "turning_point": "...", "target_pct": 0.25, "value": { "name": "...", "from": "...", "to": "..." } }',
  '{"voice":false,"entities":false,"threads":false,"tentpoles":false,"worldRules":false,"games":false,"preconditions":false,"arc":false}'),

('beats', 'beat', 4, 'movement',
  'the causal BEATS inside this act; each links to the previous with therefore or but, escalating. Tag which THREADS each beat sets up / advances / pays off (reference threads BY NAME)',
  '2 to 4',
  '{ "summary": "...", "connector": "therefore" | "but", "threads": [ { "ref": "<thread name>", "role": "setup|advance|payoff" } ] }',
  '{"voice":true,"entities":true,"threads":true,"tentpoles":true,"worldRules":true,"games":true,"preconditions":true,"arc":false}'),

('scenes', 'scene', 5, 'beat',
  'the dramatized SCENES that REALIZE this beat; EVERY scene must turn a value (no flat ''and-then''). Set each scene''s value_shift.polarity (up = ends better, down = ends worse). The beat''s planned polarity is where the beat must LAND (its closing charge) — your last scene reaches it, but VARY internally (a down-beat can open on false hope; an up-beat can dip): do NOT make every scene the same polarity. The thread schedule is inherited automatically — do NOT re-assign threads',
  '1 to 3',
  '{ "loc": "...", "goal": "...", "conflict": "...", "outcome": "...", "value_shift": { "value": "...", "from": "...", "to": "...", "polarity": "up|down" } }',
  '{"voice":true,"entities":true,"threads":false,"tentpoles":false,"worldRules":false,"games":false,"preconditions":false,"arc":false}'),

('voice_profile', 'voice_profile', 2, 'pillar',
  'the VOICE PROFILE — the book''s narrative stance and prose signature. Must be OPERABLE: specific enough that any scene can be written in the same voice without drifting. Governs every word of prose. Derive it from the genre, the protagonist''s idiolect, and the emotional register of the premise',
  'exactly 1',
  '{ "pov": "first-person|third-person-limited|third-person-omniscient|second-person", "tense": "past|present", "style": "...", "constraints": ["<a rule the prose must follow — e.g. ''No adverbs'', ''Em-dash for interruption'', ''Short declarative sentences'', ''Interior monologue in italics''>"], "sample": "<a 100–150 word passage written in this exact voice — not a scene summary, actual prose>" }',
  '{"voice":false,"entities":true,"threads":false,"tentpoles":false,"worldRules":false,"games":false,"preconditions":false,"arc":false}');
