-- The AI Calls admin list showed book/task but not WHICH node a call operated on or WHAT it was
-- doing to it (e.g. dna-expand serves logline/premise/beatsheet/scenes/contract/sketch/prose/children
-- — all logged under the same `fn`, indistinguishable in the list). Add both so a row is self-describing.
alter table public.ai_calls
  add column if not exists node_id text,
  add column if not exists operation text;

create index if not exists ai_calls_node_idx on public.ai_calls (node_id);
