-- book_nodes.last_ai_call_id: which ai_calls row wrote this node's current content — mirrors
-- pages.last_ai_call_id (20260611170000_page_call_lineage_and_artifacts.sql). Lets the tree UI's
-- node kebab ("view details") show the model, prompt, and raw completion behind a generated node,
-- not just that it came from AI. Set by the client (dnaExpand.ts) when it commits engine output
-- (logline/sketch/prose/children/beatsheet/contract); null for hand-written nodes or content
-- authored directly by the book-agent chat tool loop (not wired yet).

alter table public.book_nodes
  add column if not exists last_ai_call_id bigint references public.ai_calls(id) on delete set null;

comment on column public.book_nodes.last_ai_call_id is
  'ai_calls row whose generation last wrote this node''s content (author transparency via the tree''s view-details panel); null for hand-written nodes.';
