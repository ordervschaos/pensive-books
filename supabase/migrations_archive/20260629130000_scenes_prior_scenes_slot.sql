update public.node_type_configs
set slots = slots || '{"priorScenes": true}'::jsonb
where target = 'scenes';
