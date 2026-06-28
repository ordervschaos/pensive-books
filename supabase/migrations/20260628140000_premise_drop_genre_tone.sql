-- Drop genre/tone from the premise rung's generation config.
-- genre + tone are book-level CONTRACT fields living on books.brief (the MANDATE source every step reads).
-- They were also duplicated onto the premise node, but NOTHING downstream read premise.genre/tone — pure
-- duplication and a drift risk (the AI could emit a genre on premise that disagreed with the brief). The
-- premise rung now generates only what it genuinely refines: the dramatic question + the 5-part shape.
-- (Mirrors dnaSchema.ts; the dna-expand edge fn + eval-bridge read this row at runtime, so no fn redeploy.)
update public.node_type_configs
set role = 'the PREMISE — the dramatic question and a 5-part shape (setup → three turns → resolution)',
    schema_json = '{ "dramatic_question": "...", "shape": { "setup": "...", "turn1": "...", "turn2": "...", "turn3": "...", "resolution": "..." } }'
where target = 'premise';
