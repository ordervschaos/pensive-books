-- Premise generation now derives a priced dramatic question and internal emotional shape
-- from the brief + accepted logline. The edge fn has a special prompt for this target;
-- keep the stored config aligned for admin/fallback visibility.
update public.node_type_configs
set role = 'the PREMISE — a priced dramatic question plus a 3-5 movement internal emotional shape derived from the brief and accepted logline',
    count = '1',
    schema_json = '{ "dramatic_question": "Can the protagonist pursue the stated want without paying the specific price?", "shape": { "name": "2-4 word emotional trajectory", "movements": ["3-5 internal want/need movements that escalate and surface the brief''s most original element"], "ending_feel": "up|down|bittersweet" } }'
where target = 'premise';
