-- ai_calls.output_json: the completion's FULL content block array (Anthropic shape: text +
-- tool_use + thinking), logged verbatim at the llm.ts chokepoint. The existing `output` column is
-- a text-only projection (textFromLLM) — for a tool-using agent the most important completions
-- ARE tool calls, so a pure-tool_use turn logged as 0 chars (observed: book-agent update_vision
-- turns on the claude-local shim, whose tool replies carry no text block at all). Same principle
-- as transcript_index: record at the source, don't reconstruct. Null before 2026-07-23.
alter table public.ai_calls add column if not exists output_json jsonb;

comment on column public.ai_calls.output_json is
  'Raw completion content blocks (text/tool_use/thinking, Anthropic shape) as returned by the provider after conversion. `output` remains the text-only projection. Null on rows before 2026-07-23.';
